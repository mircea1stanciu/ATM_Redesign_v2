"""The Work area: Jira/Confluence inbox, work items and their board, "start work", trace links and Jira write-back."""
from typing import Literal, NoReturn, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.permissions import can_see_project, ensure, has_permission, permission_denied, require
from app.modules.identity.models import User
from app.modules.projects.checkouts import checkout_path, require_checkout, service_project
from app.modules.projects.models import AnalyticsSuite, BranchOwner, Project
from app.modules.work import service
from app.modules.work.integrations import (
    IntegrationError,
    JiraClient,
    confluence_connection,
    jira_connection,
)
from app.modules.work.models import SavedFilter, TraceLink, WorkItem

router = APIRouter(prefix="/api/projects/{project_id}/work", tags=["Work"])

VIEW = require("work.view", project_from="project_id")
START = require("work.start", project_from="project_id")
JIRA_WRITE = require("jira.write", project_from="project_id")


def _project(db: Session, project_id: int) -> Project:
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found.")
    return project


def _raise(exc: IntegrationError) -> NoReturn:
    raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


def _item(db: Session, project_id: int, item_id: int) -> WorkItem:
    item = db.query(WorkItem).filter(WorkItem.id == item_id, WorkItem.project_id == project_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Work item not found.")
    return item


def _serialize(db: Session, item: WorkItem) -> dict:
    assignee = db.query(User).filter(User.id == item.assignee_id).first() if item.assignee_id else None
    return service.serialize_item(item, assignee_name=(assignee.full_name or assignee.username) if assignee else None)


def _may_change(user: User, item: WorkItem) -> None:
    """The assignee changes their own item; people with work.assign change any item of the project."""
    if item.assignee_id == user.id or has_permission(user, "work.assign"):
        return
    raise permission_denied("Only the person working on this item, or a senior or lead, can change it.")


# ── Inbox ─────────────────────────────────────────────────────────────────────


@router.get("/jira/filters")
async def get_jira_filters(project_id: int, current_user: User = Depends(VIEW), db: Session = Depends(get_db)):
    try:
        return await service.jira_filters(jira_connection(db, current_user), _project(db, project_id))
    except IntegrationError as exc:
        _raise(exc)


@router.get("/jira/issues")
async def list_jira_issues(
    project_id: int,
    q: str = "",
    status: str = Query("", description="One status, or several separated by commas"),
    issue_type: str = Query("", alias="type", description="Types separated by commas; 'stories' = the story types"),
    assignee: Literal["", "me", "unassigned"] = "",
    sprint: str = Query("", pattern=r"^(|current|\d+)$"),
    label: str = Query("", description="One label, or several separated by commas"),
    jql: str = Query("", max_length=2000, description="An advanced JQL clause added to the filters"),
    cursor: int = Query(0, ge=0),
    current_user: User = Depends(VIEW),
    db: Session = Depends(get_db),
):
    try:
        return await service.jira_inbox(
            db, jira_connection(db, current_user), _project(db, project_id), cursor=cursor, q=q, status=status,
            issue_type=issue_type, assignee=assignee, sprint=sprint, label=label, jql=jql)
    except IntegrationError as exc:
        _raise(exc)


@router.get("/jira/sprints")
async def list_jira_sprints(project_id: int, current_user: User = Depends(VIEW), db: Session = Depends(get_db)):
    """Sprints of the project's Jira boards: active, future, and the last closed ones (empty without Jira Software)."""
    try:
        return await service.jira_sprints(jira_connection(db, current_user), _project(db, project_id))
    except IntegrationError as exc:
        _raise(exc)


FILTER_KEYS = ("q", "type", "status", "assignee", "sprint", "label", "jql")


class SavedFilterPayload(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    filters: dict[str, str]
    is_default: bool = False


def _saved_filter_response(saved: SavedFilter) -> dict:
    return {"id": saved.id, "name": saved.name, "filters": saved.filters, "is_default": saved.is_default}


@router.get("/saved-filters")
async def list_saved_filters(project_id: int, current_user: User = Depends(VIEW), db: Session = Depends(get_db)):
    """My saved inbox filters for this project; the default one first."""
    rows = (db.query(SavedFilter).filter(SavedFilter.user_id == current_user.id, SavedFilter.project_id == project_id)
            .order_by(SavedFilter.is_default.desc(), SavedFilter.name).all())
    return [_saved_filter_response(row) for row in rows]


@router.put("/saved-filters")
async def save_filter(project_id: int, payload: SavedFilterPayload, current_user: User = Depends(VIEW),
                      db: Session = Depends(get_db)):
    """Save the current filters under a name (the same name replaces it); optionally the inbox's default."""
    unknown = sorted(set(payload.filters) - set(FILTER_KEYS))
    if unknown:
        raise HTTPException(status_code=400, detail=f"Unknown filter: {', '.join(unknown)}.")
    filters = {k: v.strip()[:2000] for k, v in payload.filters.items() if v and v.strip()}
    name = payload.name.strip()
    saved = db.query(SavedFilter).filter(SavedFilter.user_id == current_user.id, SavedFilter.project_id == project_id,
                                         SavedFilter.name == name).first()
    if not saved:
        saved = SavedFilter(user_id=current_user.id, project_id=project_id, name=name)
        db.add(saved)
    if payload.is_default:
        db.query(SavedFilter).filter(SavedFilter.user_id == current_user.id, SavedFilter.project_id == project_id,
                                     SavedFilter.name != name).update({"is_default": False})
    saved.filters, saved.is_default = filters, payload.is_default
    db.commit()
    return _saved_filter_response(saved)


@router.delete("/saved-filters/{filter_id}")
async def delete_saved_filter(project_id: int, filter_id: int, current_user: User = Depends(VIEW),
                              db: Session = Depends(get_db)):
    deleted = db.query(SavedFilter).filter(SavedFilter.id == filter_id, SavedFilter.user_id == current_user.id,
                                           SavedFilter.project_id == project_id).delete()
    db.commit()
    if not deleted:
        raise HTTPException(status_code=404, detail="Saved filter not found.")
    return {"deleted": filter_id}


@router.get("/jira/issues/{key}")
async def get_jira_issue(project_id: int, key: str, current_user: User = Depends(VIEW),
                         db: Session = Depends(get_db)):
    try:
        return await service.jira_issue(db, jira_connection(db, current_user), _project(db, project_id), key)
    except IntegrationError as exc:
        _raise(exc)


@router.get("/confluence/pages")
async def list_confluence_pages(project_id: int, q: str = "", cursor: int = Query(0, ge=0),
                                current_user: User = Depends(VIEW), db: Session = Depends(get_db)):
    try:
        return await service.confluence_inbox(
            db, confluence_connection(db, current_user), _project(db, project_id), q=q, cursor=cursor)
    except IntegrationError as exc:
        _raise(exc)


@router.get("/confluence/pages/{page_id}")
async def get_confluence_page(project_id: int, page_id: str, current_user: User = Depends(VIEW),
                              db: Session = Depends(get_db)):
    try:
        return await service.confluence_page(
            db, confluence_connection(db, current_user), _project(db, project_id), page_id)
    except IntegrationError as exc:
        _raise(exc)


@router.get("/suggestions")
async def get_test_suggestions(project_id: int, key: str, title: str = "", current_user: User = Depends(VIEW),
                               db: Session = Depends(get_db)):
    """What to add or change for a story: matching test files in the user's checkout, and the project's suites."""
    path = checkout_path(current_user, project_id)
    repo = path if (path / ".git").exists() else None
    suites = db.query(AnalyticsSuite).filter(AnalyticsSuite.project_id == project_id).order_by(AnalyticsSuite.name)
    return {
        "has_checkout": repo is not None,
        "test_files": service.suggest_test_files(repo, key, title),
        "suites": [{"id": str(suite.id), "name": suite.name} for suite in suites.all()],
    }


# ── Work items ────────────────────────────────────────────────────────────────


@router.get("/items")
async def list_work_items(project_id: int, current_user: User = Depends(VIEW), db: Session = Depends(get_db)):
    items = db.query(WorkItem).filter(WorkItem.project_id == project_id).order_by(WorkItem.updated_at.desc()).all()
    return {"items": [_serialize(db, item) for item in items]}


@router.get("/items/{item_id}")
async def get_work_item(project_id: int, item_id: int, current_user: User = Depends(VIEW),
                        db: Session = Depends(get_db)):
    return _serialize(db, _item(db, project_id, item_id))


class TestChoice(BaseModel):
    type: Literal["test_file", "suite"]
    ref: str = Field(min_length=1, max_length=1024)
    label: Optional[str] = Field(default=None, max_length=500)


class WorkItemCreate(BaseModel):
    source: Literal["jira", "confluence"]
    external_key: str = Field(min_length=1, max_length=64)
    # False adds the story to the board ("to do"); true starts work: branch, assignee, workspace.
    start: bool = True
    branch: Optional[str] = Field(default=None, max_length=200)
    tests: list[TestChoice] = Field(default_factory=list, max_length=50)
    comment_in_jira: bool = False
    assignee_id: Optional[int] = None


async def _start_branch(db: Session, user: User, project_id: int, branch: str) -> str:
    """Create the branch from the default branch in the user's checkout (or switch to it if it exists). The branch
    owner is added to the session; the caller commits."""
    from app.services.local_repo_service import LocalRepoError, LocalRepoService

    ensure(db, user, "code.push", project_id)
    repo = require_checkout(user, project_id)
    view = service_project(project_id, repo)
    try:
        status = await LocalRepoService.create_branch(view, branch, await LocalRepoService.default_branch(view))
    except LocalRepoError as exc:
        if "already exists" not in str(exc):
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        try:
            status = await LocalRepoService.checkout(view, branch)
        except LocalRepoError as checkout_error:
            raise HTTPException(status_code=400, detail=str(checkout_error)) from checkout_error
    current = status.get("current_branch") or branch
    if not db.query(BranchOwner).filter(BranchOwner.project_id == project_id, BranchOwner.branch == current).first():
        db.add(BranchOwner(project_id=project_id, branch=current, user_id=user.id))
    return current


@router.post("/items", status_code=201)
async def create_or_start_work_item(
    project_id: int,
    payload: WorkItemCreate,
    current_user: User = Depends(START),
    db: Session = Depends(get_db),
):
    """Add a story or page to the board, or start work on it: work item, branch feature/KEY-short-name, and the
    chosen tests as trace links. Optionally comments on the Jira issue that work started."""
    project = _project(db, project_id)
    try:
        if payload.source == "jira":
            connection = jira_connection(db, current_user)
            detail = await service.jira_issue(db, connection, project, payload.external_key)
        else:
            connection = confluence_connection(db, current_user)
            detail = await service.confluence_page(db, connection, project, payload.external_key)
    except IntegrationError as exc:
        _raise(exc)

    key = detail["key"]
    item = db.query(WorkItem).filter(WorkItem.project_id == project_id, WorkItem.source == payload.source,
                                     WorkItem.external_key == key).first()

    assignee: Optional[User] = None
    if payload.assignee_id is not None and payload.assignee_id != current_user.id:
        ensure(db, current_user, "work.assign", project_id)
        assignee = db.query(User).filter(User.id == payload.assignee_id).first()
        if not assignee or not can_see_project(db, assignee, project_id):
            raise HTTPException(status_code=400, detail="That person cannot see this project.")

    # Git first, the database after: a write transaction must not stay open while git runs (SQLite has one writer).
    branch: Optional[str] = None
    if payload.start:
        if item is not None and item.assignee_id not in (None, current_user.id):
            _may_change(current_user, item)
        branch = (payload.branch or service.branch_name(key, detail["title"])).strip()
        if not service.BRANCH_PATTERN.match(branch):
            raise HTTPException(status_code=400, detail=f"'{branch}' is not a valid branch name.")
        branch = await _start_branch(db, current_user, project_id, branch)

    if item is None:
        item = WorkItem(project_id=project_id, source=payload.source, external_key=key, kind=detail["kind"],
                        title=detail["title"][:500], url=detail.get("url"), status="todo",
                        created_by_id=current_user.id)
        db.add(item)
        db.flush()
    else:
        item.title = detail["title"][:500]
        item.url = detail.get("url")
    item.context_json = service.context_snapshot(detail)
    if assignee is not None:
        item.assignee_id = assignee.id
    if branch is not None:
        item.branch = branch
        item.assignee_id = current_user.id
        if item.status == "todo":
            item.status = "in_progress"
        for choice in payload.tests:
            service.add_link(db, item, choice.type, choice.ref, choice.label)
    db.commit()
    db.refresh(item)

    warning = None
    if payload.start and payload.comment_in_jira and payload.source == "jira":
        if not has_permission(current_user, "jira.write"):
            warning = "Work started; your role does not write to Jira, so no comment was added."
        else:
            try:
                await JiraClient(connection).request("POST", f"/issue/{key}/comment", json={
                    "body": f"Work started in ATM by {current_user.full_name or current_user.username} "
                            f"on branch {item.branch}."})
            except IntegrationError as exc:
                warning = f"Work started, but the Jira comment failed: {exc.detail}"
    return {**_serialize(db, item), "warning": warning}


class WorkItemUpdate(BaseModel):
    status: Optional[Literal["todo", "in_progress", "in_review", "done"]] = None
    assignee_id: Optional[int] = None


@router.patch("/items/{item_id}")
async def update_work_item(
    project_id: int,
    item_id: int,
    payload: WorkItemUpdate,
    current_user: User = Depends(START),
    db: Session = Depends(get_db),
):
    item = _item(db, project_id, item_id)
    fields = payload.model_fields_set
    if "assignee_id" in fields and payload.assignee_id != item.assignee_id:
        if payload.assignee_id == current_user.id and item.assignee_id is None:
            pass  # Anyone who can start work may take an unassigned item.
        else:
            ensure(db, current_user, "work.assign", project_id)
        if payload.assignee_id is not None:
            assignee = db.query(User).filter(User.id == payload.assignee_id).first()
            if not assignee or not can_see_project(db, assignee, project_id):
                raise HTTPException(status_code=400, detail="That person cannot see this project.")
        item.assignee_id = payload.assignee_id
    if payload.status is not None and payload.status != item.status:
        _may_change(current_user, item)
        item.status = payload.status
    db.commit()
    db.refresh(item)
    return _serialize(db, item)


@router.delete("/items/{item_id}")
async def delete_work_item(project_id: int, item_id: int, current_user: User = Depends(START),
                           db: Session = Depends(get_db)):
    item = _item(db, project_id, item_id)
    _may_change(current_user, item)
    db.delete(item)
    db.commit()
    return {"deleted": True}


class TraceLinkCreate(BaseModel):
    target_type: Literal["test_file", "suite", "run", "pull_request"]
    target_ref: str = Field(min_length=1, max_length=1024)
    label: Optional[str] = Field(default=None, max_length=500)


@router.post("/items/{item_id}/links", status_code=201)
async def add_trace_link(project_id: int, item_id: int, payload: TraceLinkCreate,
                         current_user: User = Depends(START), db: Session = Depends(get_db)):
    item = _item(db, project_id, item_id)
    _may_change(current_user, item)
    service.add_link(db, item, payload.target_type, payload.target_ref.strip(), payload.label)
    db.commit()
    db.refresh(item)
    return _serialize(db, item)


@router.delete("/items/{item_id}/links/{link_id}")
async def remove_trace_link(project_id: int, item_id: int, link_id: int, current_user: User = Depends(START),
                            db: Session = Depends(get_db)):
    item = _item(db, project_id, item_id)
    _may_change(current_user, item)
    link = db.query(TraceLink).filter(TraceLink.id == link_id, TraceLink.work_item_id == item.id).first()
    if not link:
        raise HTTPException(status_code=404, detail="Link not found.")
    db.delete(link)
    db.commit()
    db.refresh(item)
    return _serialize(db, item)


# ── Jira write-back ───────────────────────────────────────────────────────────


def _jira_item(db: Session, project_id: int, item_id: int) -> WorkItem:
    item = _item(db, project_id, item_id)
    if item.source != "jira":
        raise HTTPException(status_code=400, detail="This work item is a Confluence page, not a Jira issue.")
    return item


@router.get("/items/{item_id}/jira/transitions")
async def get_jira_transitions(project_id: int, item_id: int, current_user: User = Depends(JIRA_WRITE),
                               db: Session = Depends(get_db)):
    """The status changes Jira allows for this issue and this user."""
    item = _jira_item(db, project_id, item_id)
    try:
        data = await JiraClient(jira_connection(db, current_user)).request(
            "GET", f"/issue/{item.external_key}/transitions")
    except IntegrationError as exc:
        _raise(exc)
    return {"transitions": [
        {"id": str(t.get("id")), "name": t.get("name"), "to": (t.get("to") or {}).get("name")}
        for t in (data or {}).get("transitions") or []
    ]}


class TransitionRequest(BaseModel):
    transition_id: str = Field(min_length=1, max_length=32)


@router.post("/items/{item_id}/jira/transition")
async def transition_jira_issue(project_id: int, item_id: int, payload: TransitionRequest,
                                current_user: User = Depends(JIRA_WRITE), db: Session = Depends(get_db)):
    item = _jira_item(db, project_id, item_id)
    try:
        await JiraClient(jira_connection(db, current_user)).request(
            "POST", f"/issue/{item.external_key}/transitions", json={"transition": {"id": payload.transition_id}})
    except IntegrationError as exc:
        _raise(exc)
    return {"ok": True}


class CommentRequest(BaseModel):
    body: str = Field(min_length=1, max_length=10000)


@router.post("/items/{item_id}/jira/comment")
async def comment_on_jira_issue(project_id: int, item_id: int, payload: CommentRequest,
                                current_user: User = Depends(JIRA_WRITE), db: Session = Depends(get_db)):
    item = _jira_item(db, project_id, item_id)
    try:
        await JiraClient(jira_connection(db, current_user)).request(
            "POST", f"/issue/{item.external_key}/comment", json={"body": payload.body.strip()})
    except IntegrationError as exc:
        _raise(exc)
    return {"ok": True}


class RemoteLinkRequest(BaseModel):
    url: str = Field(min_length=1, max_length=1024, pattern=r"^https?://")
    title: str = Field(min_length=1, max_length=255)


@router.post("/items/{item_id}/jira/link")
async def link_on_jira_issue(project_id: int, item_id: int, payload: RemoteLinkRequest,
                             current_user: User = Depends(JIRA_WRITE), db: Session = Depends(get_db)):
    """Adds a web link (for example the pull request) to the Jira issue."""
    item = _jira_item(db, project_id, item_id)
    try:
        await JiraClient(jira_connection(db, current_user)).request(
            "POST", f"/issue/{item.external_key}/remotelink",
            json={"globalId": f"atm:{payload.url}", "object": {"url": payload.url, "title": payload.title}})
    except IntegrationError as exc:
        _raise(exc)
    return {"ok": True}
