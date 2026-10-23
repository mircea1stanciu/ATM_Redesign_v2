"""
Test Manager endpoints — sprint-based and test-cases views using Jira REST API.

These endpoints use the standard Jira REST API (/rest/api/2, /rest/agile/1.0)
which fully supports PAT Bearer authentication on Jira Server/DC.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.db import get_db
from app.core.permissions import LEAD_ROLES, require
from app.modules.identity.models import User, UserRole
from app.modules.settings.connections import get_secret
from app.services.automation_tracker import VALID_STATUSES, AutomationTracker
from app.services.test_manager_service import TestManagerService

router = APIRouter()

# Everyone below lead uses their lead's Jira base URL.
_USER_OR_VIEWER = {role for role in UserRole if role not in LEAD_ROLES}


def _read_user_setting(user, key: str):
    user_settings = user.settings_json or {}
    return user_settings.get(key)


async def _resolve_jira_auth(current_user, db: Session) -> tuple[str, str]:
    """Resolve (base_url, token) the same way the Settings → Jira endpoints do:
    base_url comes from the assigned Lead's config for Automation
    Users/Viewers (or the user's own config for Leads/Admins), and the token
    always belongs to the current user. Falls back to the legacy global
    JIRA_TOKEN/JIRA_MCP_BASE_URL env vars only if the per-user configuration
    is missing, so existing setups keep working."""
    config_source_user = current_user
    assigned_lead_id = getattr(current_user, 'assigned_lead_id', None)
    if current_user.role in _USER_OR_VIEWER and assigned_lead_id:
        stmt = select(User).where(User.id == assigned_lead_id)
        result = db.execute(stmt)
        lead = result.scalar_one_or_none()
        if lead:
            config_source_user = lead

    config_data = config_source_user.settings_json or {}

    base_url = config_data.get("jira_mcp_base_url") or settings.JIRA_MCP_BASE_URL
    token = get_secret(current_user, "jira") or settings.JIRA_TOKEN
    return base_url, token


def _enforce_jira_project_scope(user, project_key: str) -> None:
    if user.role in LEAD_ROLES:
        return

    allowed_project_key = _read_user_setting(user, "jira_project_key")
    if not allowed_project_key:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No Jira project assigned for your account",
        )

    if project_key.strip().upper() != str(allowed_project_key).strip().upper():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have access to this Jira project",
        )


# ── Schemas ────────────────────────────────────────────────────────────────────

class SprintTestStats(BaseModel):
    id: int
    name: str
    state: str
    startDate: str
    endDate: str
    boardId: int
    boardName: str
    totalTests: int
    byStatus: dict[str, int]


class SprintsResponse(BaseModel):
    project_key: str
    sprints: list[SprintTestStats]
    total: int


class TestIssue(BaseModel):
    key: str
    summary: str
    status: str
    issueType: str
    assignee: str
    components: list[str]
    updated: str
    url: str


class SprintIssuesResponse(BaseModel):
    sprint_id: int
    project_key: str
    issues: list[TestIssue]
    total: int


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("/sprints/{project_key}", response_model=SprintsResponse)
async def get_test_sprints(
    project_key: str,
    state: str = "active",
    current_user=Depends(require("work.view")),
    db: Session = Depends(get_db),
):
    """
    List sprints for a Jira project with Testing/Dev-Testing issue statistics.

    - **state**: comma-separated sprint states to include (active, future, closed).
      Defaults to 'active'.
    """
    base_url, token = await _resolve_jira_auth(current_user, db)

    if not token or not base_url:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Jira token or base URL not configured. Set them in Settings → Jira.",
        )

    _enforce_jira_project_scope(current_user, project_key)

    try:
        svc = TestManagerService(base_url, token)
        sprints = await svc.get_sprints_with_stats(
            project_key=project_key,
            state=state,
            max_sprints=20,
        )
        return SprintsResponse(
            project_key=project_key,
            sprints=[SprintTestStats(**s) for s in sprints],
            total=len(sprints),
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to fetch sprint data from Jira: {str(e)}",
        )


@router.get("/sprints/{sprint_id}/issues/{project_key}", response_model=SprintIssuesResponse)
async def get_sprint_test_issues(
    sprint_id: int,
    project_key: str,
    current_user=Depends(require("work.view")),
    db: Session = Depends(get_db),
):
    """List Testing/Dev-Testing issues for a specific sprint."""
    base_url, token = await _resolve_jira_auth(current_user, db)

    if not token or not base_url:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Jira token or base URL not configured.",
        )

    _enforce_jira_project_scope(current_user, project_key)

    try:
        svc = TestManagerService(base_url, token)
        issues = await svc.get_sprint_issues(sprint_id, project_key)
        return SprintIssuesResponse(
            sprint_id=sprint_id,
            project_key=project_key,
            issues=[TestIssue(**i) for i in issues],
            total=len(issues),
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to fetch sprint issues from Jira: {str(e)}",
        )


# ── Test Cases ─────────────────────────────────────────────────────────────────

class TestCase(BaseModel):
    key: str
    summary: str
    jiraStatus: str
    issueType: str
    components: list[str]
    updated: str
    assignee: str
    url: str
    automationStatus: str  # pending | to_automate | automated | manual


class TestCasesResponse(BaseModel):
    project_key: str
    cases: list[TestCase]
    total: int
    total_jira: int


class TestCaseStatsResponse(BaseModel):
    project_key: str
    total_jira: int
    loaded: int
    pending: int
    to_automate: int
    automated: int
    manual: int


class AutomationStatusUpdate(BaseModel):
    status: str  # pending | to_automate | automated | manual


class AutomationUpdateResponse(BaseModel):
    jira_key: str
    project_key: str
    status: str


class StoryItem(BaseModel):
    key: str
    summary: str
    created: str
    team: str
    status: str
    issueType: str
    url: str


class EpicItem(BaseModel):
    key: str
    summary: str
    created: str
    year: str
    team: str
    url: str
    stories: list[StoryItem]


class EpicStoriesResponse(BaseModel):
    project_key: str
    epics: list[EpicItem]
    total: int


@router.get("/cases/{project_key}/stats", response_model=TestCaseStatsResponse)
async def get_test_case_stats(
    project_key: str,
    current_user=Depends(require("work.view")),
    db: Session = Depends(get_db),
):
    """Return automation coverage statistics for all test cases in a project."""
    base_url, token = await _resolve_jira_auth(current_user, db)
    if not token or not base_url:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="Jira not configured.")

    _enforce_jira_project_scope(current_user, project_key)
    try:
        svc = TestManagerService(base_url, token)
        issues, total_jira = await svc.get_all_test_cases(project_key)

        tracker = AutomationTracker(settings.ARTIFACTS_DIR)
        tracking = tracker.load(project_key)
        loaded_keys = {i['key'] for i in issues}

        to_automate = sum(1 for k, v in tracking.items()
                          if k in loaded_keys and v.get('status') == 'to_automate')
        automated = sum(1 for k, v in tracking.items()
                        if k in loaded_keys and v.get('status') == 'automated')
        manual = sum(1 for k, v in tracking.items()
                     if k in loaded_keys and v.get('status') == 'manual')
        pending = len(loaded_keys) - (to_automate + automated + manual)

        return TestCaseStatsResponse(
            project_key=project_key,
            total_jira=total_jira,
            loaded=len(issues),
            pending=max(0, pending),
            to_automate=to_automate,
            automated=automated,
            manual=manual,
        )
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(e))


@router.get("/cases/{project_key}", response_model=TestCasesResponse)
async def get_test_cases(
    project_key: str,
    automation_status: str = "all",
    search: str = "",
    current_user=Depends(require("work.view")),
    db: Session = Depends(get_db),
):
    """
    List test cases for a project with their automation status overlay.

    - **automation_status**: all | pending | to_automate | automated | manual
    - **search**: filter by issue key or summary text (case-insensitive)
    """
    base_url, token = await _resolve_jira_auth(current_user, db)
    if not token or not base_url:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="Jira not configured.")

    _enforce_jira_project_scope(current_user, project_key)
    if automation_status not in ("all", *VALID_STATUSES):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail=f"Invalid automation_status '{automation_status}'.")
    try:
        svc = TestManagerService(base_url, token)
        issues, total_jira = await svc.get_all_test_cases(project_key)

        tracker = AutomationTracker(settings.ARTIFACTS_DIR)
        tracking = tracker.load(project_key)

        # Overlay automation status
        cases: list[TestCase] = []
        for issue in issues:
            key = issue['key']
            auto_status = tracking.get(key, {}).get('status', 'pending')
            cases.append(TestCase(**issue, automationStatus=auto_status))

        # Filter by automation status
        if automation_status != 'all':
            cases = [c for c in cases if c.automationStatus == automation_status]

        # Filter by search text
        if search.strip():
            q = search.strip().lower()
            cases = [c for c in cases
                     if q in c.key.lower() or q in c.summary.lower()]

        return TestCasesResponse(
            project_key=project_key,
            cases=cases,
            total=len(cases),
            total_jira=total_jira,
        )
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(e))


@router.patch("/cases/{project_key}/{jira_key}/automation",
              response_model=AutomationUpdateResponse)
async def update_test_case_automation(
    project_key: str,
    jira_key: str,
    body: AutomationStatusUpdate,
    user=Depends(require("jira.write")),
):
    """Set the automation status of a test case (stored locally, not in Jira)."""
    if body.status not in VALID_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid status '{body.status}'. Use: {', '.join(sorted(VALID_STATUSES))}",
        )

    _enforce_jira_project_scope(user, project_key)
    try:
        tracker = AutomationTracker(settings.ARTIFACTS_DIR)
        updated_by = getattr(user, 'email', '') or getattr(user, 'username', '')
        tracker.update(project_key, jira_key, body.status, updated_by)
        return AutomationUpdateResponse(
            jira_key=jira_key,
            project_key=project_key,
            status=body.status,
        )
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.get("/epics/{project_key}", response_model=EpicStoriesResponse)
async def get_epics_with_stories(
    project_key: str,
    search: str = "",
    refresh: bool = False,
    current_user=Depends(require("work.view")),
    db: Session = Depends(get_db),
):
    """Return Epics (created DESC) and their child stories for a project.
    
    - **refresh**: Force cache refresh (default: False)
    """
    base_url, token = await _resolve_jira_auth(current_user, db)
    if not token or not base_url:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Jira token or base URL not configured.",
        )

    _enforce_jira_project_scope(current_user, project_key)

    try:
        svc = TestManagerService(base_url, token)
        epics, _total_epics = await svc.get_epics_with_stories(project_key, force_refresh=refresh)

        if search.strip():
            q = search.strip().lower()
            filtered: list[dict] = []
            for epic in epics:
                epic_match = q in epic['key'].lower() or q in epic['summary'].lower()
                story_matches = [
                    s for s in epic['stories']
                    if q in s['key'].lower() or q in s['summary'].lower()
                ]
                if epic_match:
                    filtered.append(epic)
                elif story_matches:
                    e = dict(epic)
                    e['stories'] = story_matches
                    filtered.append(e)
            epics = filtered

        return EpicStoriesResponse(
            project_key=project_key,
            epics=[EpicItem(**e) for e in epics],
            total=len(epics),
        )
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(e))

