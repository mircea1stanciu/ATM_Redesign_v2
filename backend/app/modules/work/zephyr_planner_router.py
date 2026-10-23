"""Zephyr Automation Planner endpoints.

Exposes:

* ``GET  /folders/{project_key}``        — folder / cycle tree for a Zephyr project.
* ``GET  /cases/{project_key}``          — manual test cases (optionally scoped
                                           to a folder), with steps inline.
* ``GET  /targets``                      — projects that have a local repo path
                                           the current user is allowed to see.
* ``POST /generate``                     — generate automation files for the
                                           selected test cases into a chosen
                                           local directory.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import get_current_user
from app.modules.identity.models import UserRole
from app.modules.projects.checkouts import checkout_path, managed_checkouts_dir
from app.modules.projects.models import Project
from app.modules.work.test_manager_router import _enforce_jira_project_scope, _resolve_jira_auth
from app.services.automation_generator_service import (
    GenerationRequest,
    detect_framework,
    generate_automation,
    list_bruno_reference_folders,
)
from app.services.zephyr_service import (
    ZephyrAuthError,
    ZephyrPermissionError,
    ZephyrService,
    ZephyrTransientError,
)

router = APIRouter()

_ALLOW_ABSOLUTE_TARGET_PATH_ROLES = {"admin", "super_admin", "org_admin", "automation_lead"}


# ── Schemas ─────────────────────────────────────────────────────────────────


class ZephyrFolder(BaseModel):
    id: str
    name: str
    parent_id: str | None = None
    kind: str = "folder"  # "folder" | "cycle"
    count: int = 0  # cumulative test-case count (as shown in Zephyr)


class ZephyrFoldersResponse(BaseModel):
    project_key: str
    folders: list[ZephyrFolder]
    total: int


class ZephyrStep(BaseModel):
    index: int
    description: str = ""
    test_data: str = ""
    expected_result: str = ""


class ZephyrManualCase(BaseModel):
    key: str
    name: str
    status: str = ""
    priority: str = ""
    folder: str = ""
    story_task_id: str = ""
    story_task_status: str = ""
    story_task_team: str = ""
    precondition: str = ""
    objective: str = ""
    steps: list[ZephyrStep] = Field(default_factory=list)
    source: str = "unknown"


class ZephyrCasesResponse(BaseModel):
    project_key: str
    folder_id: str | None = None
    cases: list[ZephyrManualCase]
    total: int


class TargetProject(BaseModel):
    project_id: str
    project_name: str
    local_repo_path: str
    detected_framework: str


class TargetsResponse(BaseModel):
    projects: list[TargetProject]
    total: int


class GenerateStep(BaseModel):
    index: int = 1
    description: str = ""
    test_data: str = ""
    expected_result: str = ""


class GenerateCase(BaseModel):
    key: str
    name: str = ""
    status: str = ""
    priority: str = ""
    folder: str = ""
    precondition: str = ""
    objective: str = ""
    source: str = ""
    steps: list[GenerateStep] = Field(default_factory=list)


class GenerateRequestBody(BaseModel):
    # Exactly one of project_id / target_path must be provided.
    project_id: str | None = None
    target_path: str | None = None
    framework: str = "auto"
    output_subpath: str = "generated-automation"
    reference_folder: str = ""
    cases: list[GenerateCase]


class GenerateResponse(BaseModel):
    framework: str
    target_dir: str
    output_dir: str
    created_files: list[str]
    skipped_cases: list[dict[str, str]]
    warnings: list[str]


# ── Helpers ─────────────────────────────────────────────────────────────────


def _read_zephyr_session_cookie(current_user) -> str:
    """The Jira web-session cookie the user pasted from their browser, used to
    talk to legacy Zephyr Squad plugins that reject PAT/Bearer auth. Stored
    per-user (it's tied to that person's authenticated session)."""
    data = current_user.settings_json or {}
    return str(data.get("zephyr_session_cookie") or "").strip()


def _role(user) -> str:
    r = user.role
    return r.value if hasattr(r, 'value') else str(r)


def _get_project(db: Session, project_id: str | int) -> Project:
    try:
        pid = int(project_id)
    except (TypeError, ValueError):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    project = db.query(Project).filter(Project.id == pid).first()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project


def _enforce_view_project(project: Project, user) -> None:
    if user.role != UserRole.SUPER_ADMIN and user.organization_id != project.organization_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You cannot view this project.")


def _http_502_from_zephyr(exc: Exception) -> HTTPException:
    if isinstance(exc, ZephyrTransientError):
        # Transient/retryable — e.g. a timeout or 5xx from Jira for this
        # specific request. Distinct from ZephyrAuthError so the frontend
        # doesn't mistake it for a permanent auth/PAT-rejection problem.
        return HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))
    if isinstance(exc, ZephyrAuthError):
        return HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))
    if isinstance(exc, ZephyrPermissionError):
        return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    return HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail=f"Zephyr call failed: {exc}",
    )


async def _resolve_target_dir(
    project_id: str | None,
    target_path: str | None,
    current_user,
    db: Session,
) -> Path:
    """Shared project_id/target_path -> local directory resolution used by both
    ``/generate`` and ``/reference-folders`` so a custom absolute path or an
    existing project's local repo behave identically in both places."""
    if target_path:
        if _role(current_user) not in _ALLOW_ABSOLUTE_TARGET_PATH_ROLES:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="target_path override is allowed only for lead/admin roles.",
            )

        target_dir = Path(target_path).expanduser()
        if not target_dir.is_absolute():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="target_path must be an absolute path.",
            )
        target_dir = target_dir.resolve()

        allowed_base = managed_checkouts_dir()
        try:
            target_dir.relative_to(allowed_base)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"target_path must be under '{allowed_base}'.",
            )

        return target_dir
    if not project_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Provide either project_id or target_path.",
        )
    project = _get_project(db, project_id)
    _enforce_view_project(project, current_user)
    return checkout_path(current_user, project.id)


# ── Endpoints ───────────────────────────────────────────────────────────────


@router.get("/folders/{project_key}", response_model=ZephyrFoldersResponse)
async def list_folders(
    project_key: str,
    case_status: str | None = None,
    case_team: str | None = None,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return Zephyr folders (or, when folders aren't configured, cycles).

    When ``case_status`` and/or ``case_team`` is given, each folder's ``count``
    reflects only test cases matching that status (and the linked story/task's
    team) cumulatively over its subtree, and folders with no matching case are
    hidden — scoping the folder tree the same way as the Manual Test Cases
    panel.
    """
    base_url, token = await _resolve_jira_auth(current_user, db)
    if not base_url or not token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Jira base URL or token missing. Configure them in Settings → Jira.",
        )
    _enforce_jira_project_scope(current_user, project_key)

    session_cookie = _read_zephyr_session_cookie(current_user)
    try:
        zephyr = ZephyrService(base_url, token, session_cookie=session_cookie)
        folders = await zephyr.get_folders(project_key, status=case_status, team=case_team)
    except Exception as exc:  # includes ZephyrAuthError / ZephyrPermissionError
        raise _http_502_from_zephyr(exc)

    return ZephyrFoldersResponse(
        project_key=project_key,
        folders=[ZephyrFolder(**f) for f in folders],
        total=len(folders),
    )


@router.get("/cases/{project_key}", response_model=ZephyrCasesResponse)
async def list_cases(
    project_key: str,
    folder_id: str | None = None,
    case_status: str | None = None,
    case_team: str | None = None,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return manual test cases with their steps for the given project/folder."""
    base_url, token = await _resolve_jira_auth(current_user, db)
    if not base_url or not token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Jira base URL or token missing. Configure them in Settings → Jira.",
        )
    _enforce_jira_project_scope(current_user, project_key)

    session_cookie = _read_zephyr_session_cookie(current_user)
    try:
        zephyr = ZephyrService(base_url, token, session_cookie=session_cookie)
        cases = await zephyr.get_test_cases(project_key, folder_id, case_status, case_team)
    except Exception as exc:
        raise _http_502_from_zephyr(exc)

    return ZephyrCasesResponse(
        project_key=project_key,
        folder_id=folder_id,
        cases=[ZephyrManualCase(**c) for c in cases],
        total=len(cases),
    )


class ZephyrStatusOption(BaseModel):
    name: str
    color: str = ""
    is_default: bool = False
    is_archived: bool = False


class ZephyrStatusesResponse(BaseModel):
    project_key: str
    statuses: list[ZephyrStatusOption]
    total: int


class UpdateCaseStatusBody(BaseModel):
    status: str


class UpdateCaseStatusResponse(BaseModel):
    key: str
    status: str


@router.get("/statuses/{project_key}", response_model=ZephyrStatusesResponse)
async def list_case_statuses(
    project_key: str,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return the project's configured Zephyr test-case statuses (for the
    status dropdown in the Manual Test Cases panel)."""
    base_url, token = await _resolve_jira_auth(current_user, db)
    if not base_url or not token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Jira base URL or token missing. Configure them in Settings → Jira.",
        )
    _enforce_jira_project_scope(current_user, project_key)

    session_cookie = _read_zephyr_session_cookie(current_user)
    try:
        zephyr = ZephyrService(base_url, token, session_cookie=session_cookie)
        statuses = await zephyr.get_test_case_statuses(project_key)
    except Exception as exc:
        raise _http_502_from_zephyr(exc)

    return ZephyrStatusesResponse(
        project_key=project_key,
        statuses=[ZephyrStatusOption(**s) for s in statuses],
        total=len(statuses),
    )


class ZephyrTeamsResponse(BaseModel):
    project_key: str
    teams: list[str]
    total: int


@router.get("/teams/{project_key}", response_model=ZephyrTeamsResponse)
async def list_teams(
    project_key: str,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return the project's team names (its Jira components) for the Team
    filter dropdown, independent of the currently selected folder."""
    base_url, token = await _resolve_jira_auth(current_user, db)
    if not base_url or not token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Jira base URL or token missing. Configure them in Settings → Jira.",
        )
    _enforce_jira_project_scope(current_user, project_key)

    session_cookie = _read_zephyr_session_cookie(current_user)
    try:
        zephyr = ZephyrService(base_url, token, session_cookie=session_cookie)
        teams = await zephyr.get_project_teams(project_key)
    except Exception as exc:
        raise _http_502_from_zephyr(exc)

    return ZephyrTeamsResponse(
        project_key=project_key,
        teams=teams,
        total=len(teams),
    )


@router.patch("/cases/{project_key}/{case_key}/status", response_model=UpdateCaseStatusResponse)
async def update_case_status(
    project_key: str,
    case_key: str,
    body: UpdateCaseStatusBody,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update a single test case's status directly in Zephyr (TM4J)."""
    base_url, token = await _resolve_jira_auth(current_user, db)
    if not base_url or not token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Jira base URL or token missing. Configure them in Settings → Jira.",
        )
    _enforce_jira_project_scope(current_user, project_key)

    if not body.status.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Status is required.")

    session_cookie = _read_zephyr_session_cookie(current_user)
    try:
        zephyr = ZephyrService(base_url, token, session_cookie=session_cookie)
        await zephyr.update_test_case_status(case_key, body.status)
    except Exception as exc:
        raise _http_502_from_zephyr(exc)

    return UpdateCaseStatusResponse(key=case_key, status=body.status)


@router.get("/targets", response_model=TargetsResponse)
async def list_targets(
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return every project the user can view that has a resolvable local repo.

    The list is intentionally dynamic — the UI populates a dropdown from here so
    the user isn't tied to a single hard-coded local collection.
    """
    projects = (
        db.query(Project)
        .filter(Project.organization_id == current_user.organization_id, Project.is_archived.is_(False))
        .all()
    )

    out: list[TargetProject] = []
    for project in projects:
        try:
            _enforce_view_project(project, current_user)
        except HTTPException:
            continue

        local_path = checkout_path(current_user, project.id)
        if not local_path.exists():
            # Still surface the intended path so the user can decide to import
            # or fall back to a manual absolute-path override.
            continue

        try:
            framework = detect_framework(Path(str(local_path)))
        except Exception:
            framework = "generic"

        out.append(
            TargetProject(
                project_id=str(project.id),
                project_name=str(project.name),
                local_repo_path=str(local_path),
                detected_framework=framework,
            )
        )

    return TargetsResponse(projects=out, total=len(out))


class ReferenceFolder(BaseModel):
    id: str
    name: str
    parent_id: str | None = None
    bru_count: int = 0
    bru_files: list[str] = Field(default_factory=list)


class ReferenceFoldersResponse(BaseModel):
    target_dir: str
    folders: list[ReferenceFolder]
    total: int


@router.get("/reference-folders", response_model=ReferenceFoldersResponse)
async def list_reference_folders(
    project_id: str | None = None,
    target_path: str | None = None,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List local folders containing existing ``.bru`` requests ("collections")
    under the chosen target, so the user can pick one to reuse as a reference
    when generating automation for a Zephyr test case.
    """
    target_dir = await _resolve_target_dir(project_id, target_path, current_user, db)
    if not target_dir.exists() or not target_dir.is_dir():
        return ReferenceFoldersResponse(target_dir=str(target_dir), folders=[], total=0)

    folders = list_bruno_reference_folders(target_dir)
    return ReferenceFoldersResponse(
        target_dir=str(target_dir),
        folders=[ReferenceFolder(**f) for f in folders],
        total=len(folders),
    )


@router.post("/generate", response_model=GenerateResponse)
async def generate(
    body: GenerateRequestBody,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Generate automation script files for the selected test cases.

    Either ``project_id`` (a project the user can view, whose ``local_repo_path``
    is used as the target) or ``target_path`` (an absolute filesystem path
    override) must be provided. The path selection is fully dynamic and does
    not require any prior "import" flow.
    """
    if not body.cases:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one test case is required.",
        )
    if not body.project_id and not body.target_path:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Provide either project_id or target_path.",
        )

    target_dir: Path
    if body.target_path:
        target_dir = Path(body.target_path).expanduser()
        if not target_dir.is_absolute():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="target_path must be an absolute path.",
            )
    else:
        assert body.project_id  # for type checker
        project = _get_project(db, body.project_id)
        _enforce_view_project(project, current_user)
        target_dir = checkout_path(current_user, project.id)

    cases_payload: list[dict[str, Any]] = [c.dict() for c in body.cases]
    for case in cases_payload:
        # Normalise "steps" key naming so the generator can rely on it.
        case["steps"] = [
            {
                "index": s.get("index") or i,
                "description": s.get("description", ""),
                "test_data": s.get("test_data", ""),
                "expected_result": s.get("expected_result", ""),
            }
            for i, s in enumerate(case.get("steps", []), 1)
        ]

    try:
        outcome = generate_automation(
            GenerationRequest(
                target_dir=target_dir,
                output_subpath=body.output_subpath or "generated-automation",
                cases=cases_payload,
                framework=body.framework or "auto",
                reference_folder=body.reference_folder or "",
            )
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    except NotADirectoryError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    return GenerateResponse(
        framework=outcome.framework,
        target_dir=outcome.target_dir,
        output_dir=outcome.output_dir,
        created_files=outcome.created_files,
        skipped_cases=outcome.skipped_cases,
        warnings=outcome.warnings,
    )


# ── Session cookie (workaround for legacy Zephyr Squad rejecting PAT) ─────────


class SessionCookieResponse(BaseModel):
    cookie_set: bool
    preview: str = ""


class SessionCookieUpdate(BaseModel):
    session_cookie: str = ""


@router.get("/session-cookie", response_model=SessionCookieResponse)
async def get_session_cookie(current_user=Depends(get_current_user)):
    """Report whether a Zephyr session cookie is stored (never returns the raw value)."""
    cookie = _read_zephyr_session_cookie(current_user)
    preview = ""
    if cookie:
        tail = cookie[-4:] if len(cookie) >= 4 else cookie
        preview = f"…{tail}"
    return SessionCookieResponse(cookie_set=bool(cookie), preview=preview)


@router.patch("/session-cookie", response_model=SessionCookieResponse)
async def set_session_cookie(
    payload: SessionCookieUpdate,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Store (or clear) the Jira web-session cookie used for Zephyr Squad calls.

    The cookie is copied by the user from their already-authenticated browser
    (which has passed SSO/2FA) and is the only auth the legacy Zephyr plugin
    accepts. It is kept per-user and can be cleared by sending an empty value.
    """
    data = dict(current_user.settings_json or {})
    cookie = (payload.session_cookie or "").strip()
    if cookie:
        data["zephyr_session_cookie"] = cookie
    else:
        data.pop("zephyr_session_cookie", None)
    current_user.settings_json = data
    db.commit()
    db.refresh(current_user)

    stored = _read_zephyr_session_cookie(current_user)
    preview = ""
    if stored:
        tail = stored[-4:] if len(stored) >= 4 else stored
        preview = f"…{tail}"
    return SessionCookieResponse(cookie_set=bool(stored), preview=preview)
