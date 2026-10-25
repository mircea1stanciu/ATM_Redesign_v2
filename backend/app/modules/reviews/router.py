"""Reviews area: open pull requests of the user's projects, one pull request, comments, reviews, AI suggestions."""
import hashlib
import json
import re
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.permissions import ensure, has_permission, require, visible_project_ids
from app.modules.identity.models import User
from app.modules.notifications.service import notify, reviewers
from app.modules.projects.models import AnalyticsRun, AnalyticsSuite, Project
from app.modules.reporting import allure
from app.modules.reviews import github
from app.modules.reviews.models import PullRequest, PullRequestComment, PullRequestReview
from app.modules.work.models import WorkItem

router = APIRouter(prefix="/api/reviews", tags=["Reviews"])

MAX_AI_DIFF_CHARS = 60_000
MAX_AI_SUGGESTIONS = 10
MAX_REVIEWER_OPTIONS = 300
# GitHub login of each token (tokens are per user and project); filled on first use.
_logins: dict[str, str] = {}


async def github_login(repo: github.Repo) -> str:
    key = hashlib.sha256(f"{repo.api_base}|{repo.token}".encode()).hexdigest()
    if key not in _logins:
        me = await github.call(repo, "GET", "/user", root=True)
        _logins[key] = str((me or {}).get("login") or "")
    return _logins[key]


def _project(db: Session, project_id: int) -> Project:
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found.")
    return project


def _person(item: Optional[dict]) -> str:
    return str((item or {}).get("login") or "ghost")


def _team(item: Optional[dict]) -> str:
    return str((item or {}).get("slug") or (item or {}).get("name") or "")


def _summary(project: Project, pr: dict, waiting: bool) -> dict:
    return {
        "project_id": project.id,
        "project": project.name,
        "number": pr["number"],
        "title": pr.get("title") or "",
        "author": _person(pr.get("user")),
        "head": (pr.get("head") or {}).get("ref") or "",
        "base": (pr.get("base") or {}).get("ref") or "",
        "url": pr.get("html_url"),
        "draft": bool(pr.get("draft")),
        "created_at": pr.get("created_at"),
        "updated_at": pr.get("updated_at"),
        "requested_reviewers": [_person(r) for r in pr.get("requested_reviewers") or []],
        "requested_teams": [_team(t) for t in pr.get("requested_teams") or []],
        "waiting_for_me": waiting,
    }


def _waiting(db: Session, user: User, project: Project, pr: dict, login: str,
             opened_in_atm: dict[int, PullRequest], reviewed: set[int]) -> bool:
    """Requested from me on GitHub, or opened in ATM with me among its reviewers and not reviewed by me yet."""
    if _person(pr.get("user")) == login:
        return False
    if login and login in {_person(r) for r in pr.get("requested_reviewers") or []}:
        return True
    record = opened_in_atm.get(pr["number"])
    if not record or record.author_id == user.id or pr["number"] in reviewed:
        return False
    author = db.query(User).filter(User.id == record.author_id).first() if record.author_id else None
    return author is not None and user.id in reviewers(db, project.id, author)


@router.get("/pulls")
async def list_pulls(scope: Literal["mine", "all"] = "mine", current_user: User = Depends(require("pr.view")),
                     db: Session = Depends(get_db)):
    """Open pull requests of the user's projects: those waiting for the user's review, or all of them."""
    visible = visible_project_ids(db, current_user)
    query = db.query(Project).filter(Project.is_archived.isnot(True), Project.github_repo_url.isnot(None))
    if visible is not None:
        query = query.filter(Project.id.in_(visible))
    items, missing_token, errors = [], [], []
    for project in query.order_by(Project.name).all():
        if not (project.github_repo_url or "").strip():
            continue
        try:
            repo = github.repo_for(project, current_user)
            pulls = await github.call(repo, "GET", "/pulls", params={"state": "open", "per_page": 100})
            login = await github_login(repo)
        except HTTPException as exc:
            if exc.status_code == 400 and "No GitHub token" in str(exc.detail):
                missing_token.append(project.name)
            else:
                errors.append({"project": project.name, "detail": exc.detail})
            continue
        opened = {pr.number: pr for pr in db.query(PullRequest).filter(PullRequest.project_id == project.id)}
        reviewed = {n for (n,) in db.query(PullRequestReview.number).filter(
            PullRequestReview.project_id == project.id, PullRequestReview.reviewer_id == current_user.id)}
        for pr in pulls or []:
            waiting = _waiting(db, current_user, project, pr, login, opened, reviewed)
            if scope == "all" or waiting:
                items.append(_summary(project, pr, waiting))
    items.sort(key=lambda item: item["updated_at"] or "", reverse=True)
    return {"items": items, "missing_token": missing_token, "errors": errors}


def _comment(item: dict) -> dict:
    return {
        "id": item.get("id"),
        "path": item.get("path"),
        "line": item.get("line") if item.get("line") is not None else item.get("original_line"),
        "side": item.get("side") or "RIGHT",
        "start_line": item.get("start_line"),
        "body": item.get("body") or "",
        "author": _person(item.get("user")),
        "created_at": item.get("created_at"),
        "in_reply_to_id": item.get("in_reply_to_id"),
        "outdated": item.get("line") is None and item.get("position") is None,
    }


async def _optional(repo: github.Repo, path: str) -> list:
    try:
        return await github.pages(repo, path)
    except HTTPException:
        return []


def _atm_runs(db: Session, project_id: int, branch: str) -> list[dict]:
    rows = (db.query(AnalyticsRun, AnalyticsSuite).join(AnalyticsSuite, AnalyticsSuite.id == AnalyticsRun.suite_id)
            .filter(AnalyticsSuite.project_id == project_id, AnalyticsRun.branch == branch)
            .order_by(AnalyticsRun.created_at.desc(), AnalyticsRun.id.desc()).limit(10).all())
    return [{"id": f"manual-{run.id}", "name": run.name or suite.name, "suite": suite.name, "status": run.status,
             "passed": run.passed_tests, "failed": run.failed_tests,
             "created_at": run.created_at.isoformat() if run.created_at else None,
             "report": (allure.run_report_dir(project_id, suite.id, run.id) / "allure-report" / "index.html").is_file()}
            for run, suite in rows]


@router.get("/projects/{project_id}/pulls/{number}")
async def get_pull(project_id: int, number: int,
                   current_user: User = Depends(require("pr.view", project_from="project_id")),
                   db: Session = Depends(get_db)):
    """One pull request: files with their patches, line comments, the conversation, checks, ATM runs, the story."""
    project = _project(db, project_id)
    repo = github.repo_for(project, current_user)
    pr = await github.call(repo, "GET", f"/pulls/{number}")
    files = await github.pages(repo, f"/pulls/{number}/files")
    line_comments = await _optional(repo, f"/pulls/{number}/comments")
    issue_comments = await _optional(repo, f"/issues/{number}/comments")
    reviews = await _optional(repo, f"/pulls/{number}/reviews")
    head = pr.get("head") or {}
    try:
        checks = (await github.call(repo, "GET", f"/commits/{head.get('sha')}/check-runs") or {}).get("check_runs", [])
    except HTTPException:
        checks = []
    login = await github_login(repo)
    conversation = [{"kind": "comment", "id": c.get("id"), "author": _person(c.get("user")),
                     "body": c.get("body") or "", "state": None, "created_at": c.get("created_at")}
                    for c in issue_comments]
    conversation += [{"kind": "review", "id": r.get("id"), "author": _person(r.get("user")),
                      "body": r.get("body") or "", "state": r.get("state"), "created_at": r.get("submitted_at")}
                     for r in reviews if r.get("state") != "PENDING"]
    conversation.sort(key=lambda item: item["created_at"] or "")
    branch = head.get("ref") or ""
    item = (db.query(WorkItem).filter(WorkItem.project_id == project_id, WorkItem.branch == branch).first()
            if branch else None)
    author = _person(pr.get("user"))
    return {
        "project_id": project.id,
        "project": project.name,
        "number": pr["number"],
        "title": pr.get("title") or "",
        "body": pr.get("body") or "",
        "state": "merged" if pr.get("merged") else pr.get("state"),
        "draft": bool(pr.get("draft")),
        "url": pr.get("html_url"),
        "author": author,
        "head": branch,
        "base": (pr.get("base") or {}).get("ref") or "",
        "head_sha": head.get("sha"),
        "created_at": pr.get("created_at"),
        "requested_reviewers": [_person(r) for r in pr.get("requested_reviewers") or []],
        "requested_teams": [_team(t) for t in pr.get("requested_teams") or []],
        "files": [{"filename": f.get("filename"), "previous_filename": f.get("previous_filename"),
                   "status": f.get("status"), "additions": f.get("additions", 0), "deletions": f.get("deletions", 0),
                   "patch": f.get("patch")} for f in files],
        "comments": [_comment(c) for c in line_comments],
        "conversation": conversation,
        "checks": [{"name": c.get("name"), "status": c.get("status"), "conclusion": c.get("conclusion"),
                    "url": c.get("html_url")} for c in checks],
        "runs": _atm_runs(db, project.id, branch) if branch else [],
        "work_item": {"key": item.external_key, "title": item.title, "url": item.url, "status": item.status}
        if item else None,
        "me": {"login": login, "is_author": bool(login) and login == author,
               "can_comment": has_permission(current_user, "pr.comment"),
               "can_request_reviewers": has_permission(current_user, "pr.create"),
               "can_review": has_permission(current_user, "pr.review")},
    }


class CommentPayload(BaseModel):
    body: str = Field(min_length=1, max_length=65_000)


@router.post("/projects/{project_id}/pulls/{number}/comments", status_code=201)
async def add_comment(project_id: int, number: int, payload: CommentPayload,
                      current_user: User = Depends(require("pr.comment", project_from="project_id")),
                      db: Session = Depends(get_db)):
    """A comment in the pull request's conversation."""
    repo = github.repo_for(_project(db, project_id), current_user)
    created = await github.call(repo, "POST", f"/issues/{number}/comments", json={"body": payload.body.strip()})
    return {"id": (created or {}).get("id")}


class LineComment(BaseModel):
    path: str = Field(min_length=1, max_length=1000)
    line: int = Field(ge=1)
    side: Literal["LEFT", "RIGHT"] = "RIGHT"
    start_line: Optional[int] = Field(default=None, ge=1)
    body: str = Field(min_length=1, max_length=65_000)
    suggested_by_ai: bool = False


class ReviewPayload(BaseModel):
    event: Literal["COMMENT", "APPROVE", "REQUEST_CHANGES"]
    body: str = Field(default="", max_length=65_000)
    # Phase 20: line comments are posted at once (POST .../line-comments); this list stays for API clients.
    comments: list[LineComment] = Field(default_factory=list, max_length=100)


EVENT_WORDS = {"APPROVE": "approved", "REQUEST_CHANGES": "asked for changes to", "COMMENT": "commented on"}


def _notify_author(db: Session, project: Project, number: int, title: str, reviewer: User, event: str) -> None:
    """Tell the author in ATM: known when the pull request was opened from ATM."""
    record = db.query(PullRequest).filter(PullRequest.project_id == project.id, PullRequest.number == number).first()
    if not record or not record.author_id or record.author_id == reviewer.id:
        return
    name = reviewer.full_name or reviewer.username
    notify(db, [record.author_id], "review", f"{name} {EVENT_WORDS[event]} your pull request: {title}",
           f"{project.name} · #{number}", f"/reviews/{project.id}/{number}", project_id=project.id)


async def _check_lines(repo: github.Repo, number: int, comments: list[LineComment]) -> None:
    """GitHub accepts line comments only on lines shown in the pull request's diff: say which one is not."""
    patches = {f.get("filename"): f.get("patch") for f in await github.pages(repo, f"/pulls/{number}/files")}
    for comment in comments:
        if comment.path not in patches:
            raise HTTPException(status_code=400, detail=f"{comment.path} is not changed in this pull request.")
        allowed = github.commentable_lines(patches[comment.path])
        for line in filter(None, (comment.start_line, comment.line)):
            if (comment.side, line) not in allowed:
                raise HTTPException(status_code=400, detail=f"Line {line} of {comment.path} is not part of the diff.")


def _github_line_comment(comment: LineComment) -> dict:
    return {k: v for k, v in {"path": comment.path, "line": comment.line, "side": comment.side,
                              "start_line": comment.start_line,
                              "start_side": comment.side if comment.start_line else None,
                              "body": comment.body}.items() if v is not None}


@router.post("/projects/{project_id}/pulls/{number}/line-comments", status_code=201)
async def add_line_comment(project_id: int, number: int, payload: LineComment,
                           current_user: User = Depends(require("pr.comment", project_from="project_id")),
                           db: Session = Depends(get_db)):
    """A comment on a line of the diff, posted to GitHub at once (phase 20); the review summary comes separately."""
    project = _project(db, project_id)
    repo = github.repo_for(project, current_user)
    pr = await github.call(repo, "GET", f"/pulls/{number}")
    await _check_lines(repo, number, [payload])
    created = await github.call(repo, "POST", f"/pulls/{number}/comments",
                                json={"commit_id": (pr.get("head") or {}).get("sha"),
                                      **_github_line_comment(payload)})
    db.add(PullRequestComment(project_id=project.id, number=number, author_id=current_user.id,
                              github_comment_id=(created or {}).get("id"), suggested_by_ai=payload.suggested_by_ai))
    db.commit()
    return _comment(created or {})


@router.post("/projects/{project_id}/pulls/{number}/reviews", status_code=201)
async def submit_review(project_id: int, number: int, payload: ReviewPayload,
                        current_user: User = Depends(require("pr.comment", project_from="project_id")),
                        db: Session = Depends(get_db)):
    """Submit a review: Comment, or (Seniors and leads) Approve / Request changes. The line comments the reviewer
    posted since their last review count into this one."""
    if payload.event != "COMMENT":
        ensure(db, current_user, "pr.review", project_id)
    if payload.event in ("COMMENT", "REQUEST_CHANGES") and not payload.body.strip() and not payload.comments:
        raise HTTPException(status_code=400, detail="Write a comment first.")
    project = _project(db, project_id)
    repo = github.repo_for(project, current_user)
    pr = await github.call(repo, "GET", f"/pulls/{number}")
    if payload.comments:
        await _check_lines(repo, number, payload.comments)
    body: dict = {"event": payload.event, "commit_id": (pr.get("head") or {}).get("sha"), "body": payload.body.strip(),
                  "comments": [_github_line_comment(c) for c in payload.comments]}
    created = await github.call(repo, "POST", f"/pulls/{number}/reviews", json=body)
    posted = db.query(PullRequestComment).filter(PullRequestComment.project_id == project.id,
                                                 PullRequestComment.number == number,
                                                 PullRequestComment.author_id == current_user.id,
                                                 PullRequestComment.review_id.is_(None)).all()
    review = PullRequestReview(project_id=project.id, number=number, reviewer_id=current_user.id, event=payload.event,
                               comments=len(payload.comments) + len(posted),
                               ai_suggestions=sum(1 for c in payload.comments if c.suggested_by_ai)
                               + sum(1 for c in posted if c.suggested_by_ai),
                               github_review_id=(created or {}).get("id"))
    db.add(review)
    db.flush()
    for comment in posted:
        comment.review_id = review.id
    db.commit()
    _notify_author(db, project, number, pr.get("title") or "", current_user, payload.event)
    return {"id": (created or {}).get("id"), "state": (created or {}).get("state")}


@router.get("/projects/{project_id}/reviewer-options")
async def reviewer_options(project_id: int,
                           current_user: User = Depends(require("pr.create", project_from="project_id")),
                           db: Session = Depends(get_db)):
    """Whom a pull request can ask for a review on GitHub: the repository's collaborators (not oneself) and the
    organisation's teams with access to it. A user-owned repository has no teams."""
    repo = github.repo_for(_project(db, project_id), current_user)
    login = await github_login(repo)
    try:
        people = await github.pages(repo, "/collaborators", limit=MAX_REVIEWER_OPTIONS)
        people_error = None
    except HTTPException as exc:
        people, people_error = [], str(exc.detail)
    teams = await _optional(repo, "/teams")
    return {
        "people": [{"login": _person(p), "avatar_url": p.get("avatar_url")}
                   for p in people if _person(p) != login][:MAX_REVIEWER_OPTIONS],
        "teams": [{"slug": _team(t), "name": t.get("name") or _team(t)} for t in teams if _team(t)],
        "me": login,
        "people_error": people_error,
    }


class ReviewerRequest(BaseModel):
    reviewers: list[str] = Field(default_factory=list, max_length=15)
    team_reviewers: list[str] = Field(default_factory=list, max_length=15)


async def request_reviewers(repo: github.Repo, number: int, people: list[str], teams: list[str]) -> list[str]:
    """Ask GitHub for the reviews; returns the people GitHub now lists as requested."""
    people = [p.strip() for p in people if p.strip()]
    teams = [t.strip() for t in teams if t.strip()]
    if not people and not teams:
        return []
    answer = await github.call(repo, "POST", f"/pulls/{number}/requested_reviewers",
                               json={"reviewers": people, "team_reviewers": teams})
    return [_person(r) for r in (answer or {}).get("requested_reviewers") or []]


@router.post("/projects/{project_id}/pulls/{number}/requested-reviewers")
async def add_reviewers(project_id: int, number: int, payload: ReviewerRequest,
                        current_user: User = Depends(require("pr.create", project_from="project_id")),
                        db: Session = Depends(get_db)):
    """Ask more people or teams for a review of an open pull request (on GitHub)."""
    if not payload.reviewers and not payload.team_reviewers:
        raise HTTPException(status_code=400, detail="Choose at least one reviewer.")
    repo = github.repo_for(_project(db, project_id), current_user)
    await request_reviewers(repo, number, payload.reviewers, payload.team_reviewers)
    pr = await github.call(repo, "GET", f"/pulls/{number}")
    return {"requested_reviewers": [_person(r) for r in pr.get("requested_reviewers") or []],
            "requested_teams": [_team(t) for t in pr.get("requested_teams") or []]}


AI_SYSTEM = (
    "You review pull requests of test automation code: tests, page objects, API collections and CI files. Point out "
    "real problems only: missing or weak assertions, tests that cannot fail, flaky waits and sleeps, hard-coded data "
    "or secrets, duplicated code, unclear names, missing clean-up. Answer with JSON only: an array of at most "
    f"{MAX_AI_SUGGESTIONS} objects {{\"path\": string, \"line\": number, \"body\": string}}. \"line\" is a number "
    "from the left column of the numbered diff (a line of the new version). Each body is a short, polite review "
    "comment that says what to change and why. If nothing needs a comment, answer []."
)


def _ai_prompt(pr: dict, files: list[dict]) -> str:
    parts = [f"Review this pull request.\nTitle: {pr.get('title') or ''}\nDescription: {pr.get('body') or '(none)'}\n"]
    size = len(parts[0])
    for f in files:
        if not f.get("patch"):
            continue
        block = f"File: {f.get('filename')} ({f.get('status')})\n```diff\n{github.numbered_patch(f['patch'])}\n```\n"
        if size + len(block) > MAX_AI_DIFF_CHARS:
            parts.append("(The remaining files were left out: the diff is too long.)")
            break
        parts.append(block)
        size += len(block)
    return "\n".join(parts)


def _parse_suggestions(text: str) -> list:
    candidates = [text.strip()]
    fenced = re.search(r"```(?:json)?\s*(\[.*?\])\s*```", text, re.S)
    if fenced:
        candidates.append(fenced.group(1))
    if "[" in text and "]" in text:
        candidates.append(text[text.index("["):text.rindex("]") + 1])
    for candidate in candidates:
        try:
            value = json.loads(candidate)
        except ValueError:
            continue
        if isinstance(value, list):
            return value
    raise HTTPException(status_code=502, detail="The AI answer was not a list of review comments. Try again.")


@router.post("/projects/{project_id}/pulls/{number}/ai-review")
async def ai_review(project_id: int, number: int,
                    current_user: User = Depends(require("pr.review", project_from="project_id")),
                    db: Session = Depends(get_db)):
    """Suggested line comments from the user's AI assistant; nothing is posted until the reviewer picks them."""
    from app.modules.workspace.assistant_router import _active_config
    from app.services import ai_provider_service as providers

    ensure(db, current_user, "ai.use")
    project = _project(db, project_id)
    repo = github.repo_for(project, current_user)
    pr = await github.call(repo, "GET", f"/pulls/{number}")
    files = await github.pages(repo, f"/pulls/{number}/files")
    config = await _active_config(current_user, db)
    chunks = []
    try:
        messages = [{"role": "user", "content": _ai_prompt(pr, files)}]
        async for chunk in providers.stream_chat(config, AI_SYSTEM, messages):
            chunks.append(chunk)
    except providers.AIError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
    patches = {f.get("filename"): f.get("patch") for f in files}
    suggestions, dropped = [], 0
    for raw in _parse_suggestions("".join(chunks))[:MAX_AI_SUGGESTIONS * 2]:
        path = raw.get("path") if isinstance(raw, dict) else None
        line = raw.get("line") if isinstance(raw, dict) else None
        body = str(raw.get("body") or "").strip() if isinstance(raw, dict) else ""
        if (path in patches and isinstance(line, int) and body
                and ("RIGHT", line) in github.commentable_lines(patches[path])):
            suggestions.append({"path": path, "line": line, "side": "RIGHT", "body": body[:2000]})
        else:
            dropped += 1  # not on a line of the diff: GitHub would refuse it
    return {"suggestions": suggestions[:MAX_AI_SUGGESTIONS], "dropped": dropped}


def record_opened(db: Session, project_id: int, number: int, title: str, url: str, head: str, base: str,
                  author: User) -> None:
    """Remember a pull request opened from ATM (its author is notified of reviews; reviewers see it waiting)."""
    if not number:
        return
    if not db.query(PullRequest).filter(PullRequest.project_id == project_id, PullRequest.number == number).first():
        db.add(PullRequest(project_id=project_id, number=number, title=title[:500], url=url, head=head, base=base,
                           author_id=author.id))
        db.commit()

