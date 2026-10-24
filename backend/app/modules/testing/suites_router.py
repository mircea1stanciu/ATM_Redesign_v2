"""Suites (test type, target, environment, schedule), project environments, and running a suite (phase 08)."""
import re
from datetime import datetime
from pathlib import Path
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.permissions import can_manage_suite, ensure, permission_denied, require
from app.modules.identity.models import User
from app.modules.projects.checkouts import checkout_path
from app.modules.projects.models import AllureReport, AnalyticsRun, AnalyticsSuite, TestEnvironment
from app.modules.projects.service import get_project_or_404
from app.modules.testing import cron
from app.modules.testing import secrets as environment_secrets
from app.modules.testing.runs import AnalyticsRunExecuteRequest, _analytics_run_response, _start_framework_run

router = APIRouter(prefix="/api", tags=["Testing"])

TEST_TYPES = ("functional", "regression", "smoke", "api", "ui", "mobile", "performance")
TestType = Literal["functional", "regression", "smoke", "api", "ui", "mobile", "performance"]
DEFAULT_SUITE_NAME = "Default Suite"
VARIABLE_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,63}$")
WORKFLOW_FILE = re.compile(r"^[\w.-]+\.ya?ml$|^\d+$")


def suite_response(db: Session, suite: AnalyticsSuite) -> dict:
    last = (db.query(AnalyticsRun).filter(AnalyticsRun.suite_id == suite.id)
            .order_by(AnalyticsRun.created_at.desc(), AnalyticsRun.id.desc()).first())
    return {
        "id": str(suite.id),
        "project_id": str(suite.project_id),
        "name": suite.name,
        "tags": suite.tags or [],
        "test_type": suite.test_type or "functional",
        "target": suite.target,
        "environment_id": str(suite.environment_id) if suite.environment_id else None,
        "ci_workflow": suite.ci_workflow,
        "cron_expression": suite.cron_expression,
        "active": suite.active,
        "created_by_user_id": str(suite.created_by_user_id) if suite.created_by_user_id else None,
        "created_at": suite.created_at.isoformat() if suite.created_at else None,
        "archived_at": suite.archived_at.isoformat() if suite.archived_at else None,
        "last_run": {"id": f"manual-{last.id}", "status": last.status, "trigger": last.trigger,
                     "created_at": last.created_at.isoformat() if last.created_at else None} if last else None,
    }


def _suite(db: Session, suite_id: int) -> AnalyticsSuite:
    suite = db.query(AnalyticsSuite).filter(AnalyticsSuite.id == suite_id).first()
    if not suite:
        raise HTTPException(status_code=404, detail="Suite not found.")
    return suite


def _environment(db: Session, project_id: int, environment_id: Optional[int]) -> Optional[TestEnvironment]:
    if environment_id is None:
        return None
    environment = db.query(TestEnvironment).filter(TestEnvironment.id == environment_id).first()
    if not environment or environment.project_id != project_id:
        raise HTTPException(status_code=400, detail="That environment is not one of this project's.")
    return environment


def _check_cron(expression: Optional[str]) -> Optional[str]:
    expression = (expression or "").strip()
    if not expression:
        return None
    try:
        cron.parse(expression)
    except cron.CronError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return expression


def _check_workflow(name: Optional[str]) -> Optional[str]:
    name = (name or "").strip()
    if name and not WORKFLOW_FILE.match(name):
        raise HTTPException(status_code=400, detail="The workflow is a file name like 'tests.yml' (or its id).")
    return name or None


# ── Suites ────────────────────────────────────────────────────────────────────


@router.get("/suites/projects/{project_id}")
async def list_suites(project_id: int, archived: bool = False,
                      current_user: User = Depends(require("run.view", project_from="project_id")),
                      db: Session = Depends(get_db)):
    """The project's suites (or, with ``archived``, its archived ones); imported Allure results show as a virtual
    suite for the Analytics view."""
    get_project_or_404(db, project_id)
    query = db.query(AnalyticsSuite).filter(AnalyticsSuite.project_id == project_id)
    query = query.filter(AnalyticsSuite.archived_at.isnot(None) if archived else AnalyticsSuite.archived_at.is_(None))
    suites = query.order_by(AnalyticsSuite.created_at.desc()).all()
    response = [suite_response(db, suite) for suite in suites]
    if not archived and db.query(AllureReport.id).filter(AllureReport.project_id == project_id).first():
        response.insert(0, {
            "id": f"allure-suite-{project_id}", "project_id": str(project_id), "name": "Allure Reports",
            "tags": ["allure"], "test_type": "functional", "target": None, "environment_id": None,
            "ci_workflow": None, "cron_expression": None, "active": True, "created_by_user_id": None,
            "created_at": datetime.utcnow().isoformat(), "last_run": None,
        })
    return response


class SuiteCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    tags: list[str] = Field(default_factory=list, max_length=20)
    active: bool = True
    test_type: TestType = "functional"
    # A target id from GET /api/projects/{id}/local/frameworks, e.g. "pytest@.|file|tests/test_login.py".
    target: Optional[str] = Field(default=None, max_length=512)
    environment_id: Optional[int] = None
    cron_expression: Optional[str] = Field(default=None, max_length=100)
    ci_workflow: Optional[str] = Field(default=None, max_length=255)


@router.post("/suites/projects/{project_id}/suites")
async def create_suite(project_id: int, payload: SuiteCreate,
                       current_user: User = Depends(require("suite.manage", project_from="project_id")),
                       db: Session = Depends(get_db)):
    get_project_or_404(db, project_id)
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Suite name is required.")
    _environment(db, project_id, payload.environment_id)
    schedule = _check_cron(payload.cron_expression)
    suite = AnalyticsSuite(
        project_id=project_id, name=name, tags=[t.strip() for t in payload.tags if t.strip()], active=payload.active,
        test_type=payload.test_type, target=(payload.target or "").strip() or None,
        environment_id=payload.environment_id, ci_workflow=_check_workflow(payload.ci_workflow),
        cron_expression=schedule, schedule_user_id=current_user.id if schedule else None,
        created_by_user_id=current_user.id,
    )
    db.add(suite)
    db.commit()
    db.refresh(suite)
    return suite_response(db, suite)


class SuiteUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=255)
    tags: Optional[list[str]] = None
    active: Optional[bool] = None
    test_type: Optional[TestType] = None
    target: Optional[str] = Field(default=None, max_length=512)
    environment_id: Optional[int] = None
    cron_expression: Optional[str] = Field(default=None, max_length=100)
    ci_workflow: Optional[str] = Field(default=None, max_length=255)


def _ensure_manage(db: Session, user: User, suite: AnalyticsSuite) -> None:
    ensure(db, user, "suite.manage", suite.project_id)
    if not can_manage_suite(user, suite):
        raise permission_denied("Automation users change only the suites they created.")


@router.patch("/suites/{suite_id}")
async def update_suite(suite_id: int, payload: SuiteUpdate,
                       current_user: User = Depends(require("suite.manage", project_from="suite_id")),
                       db: Session = Depends(get_db)):
    suite = _suite(db, suite_id)
    _ensure_manage(db, current_user, suite)
    fields = payload.model_fields_set
    if "name" in fields and payload.name is not None:
        if not payload.name.strip():
            raise HTTPException(status_code=400, detail="Suite name is required.")
        suite.name = payload.name.strip()
    if "tags" in fields and payload.tags is not None:
        suite.tags = [t.strip() for t in payload.tags if t.strip()]
    if "active" in fields and payload.active is not None:
        suite.active = payload.active
    if "test_type" in fields and payload.test_type is not None:
        suite.test_type = payload.test_type
    if "target" in fields:
        suite.target = (payload.target or "").strip() or None
    if "environment_id" in fields:
        _environment(db, suite.project_id, payload.environment_id)
        suite.environment_id = payload.environment_id
    if "ci_workflow" in fields:
        suite.ci_workflow = _check_workflow(payload.ci_workflow)
    if "cron_expression" in fields:
        schedule = _check_cron(payload.cron_expression)
        if schedule != suite.cron_expression:
            # The schedule runs as the person who set it, in their checkout.
            suite.cron_expression = schedule
            suite.schedule_user_id = current_user.id if schedule else None
            suite.last_scheduled_at = None
    db.commit()
    db.refresh(suite)
    return suite_response(db, suite)


@router.post("/suites/{suite_id}/archive")
async def archive_suite(suite_id: int, current_user: User = Depends(require("suite.manage", project_from="suite_id")),
                        db: Session = Depends(get_db)):
    """Archive the suite (phase 17): its runs and reports stay, it leaves the lists and its schedule stops."""
    suite = _suite(db, suite_id)
    _ensure_manage(db, current_user, suite)
    if suite.archived_at is None:
        suite.archived_at, suite.archived_by_id = datetime.utcnow(), current_user.id
        db.commit()
    return suite_response(db, suite)


@router.post("/suites/{suite_id}/restore")
async def restore_suite(suite_id: int, current_user: User = Depends(require("suite.manage", project_from="suite_id")),
                        db: Session = Depends(get_db)):
    suite = _suite(db, suite_id)
    _ensure_manage(db, current_user, suite)
    suite.archived_at, suite.archived_by_id = None, None
    db.commit()
    return suite_response(db, suite)


@router.delete("/suites/{suite_id}")
async def delete_suite(suite_id: int, current_user: User = Depends(require("suite.delete", project_from="suite_id")),
                       db: Session = Depends(get_db)):
    """Permanently delete an archived suite and its runs (Leads and Super Admins)."""
    suite = _suite(db, suite_id)
    if suite.archived_at is None:
        raise HTTPException(status_code=400, detail="Archive the suite first; only archived suites are deleted.")
    deleted_runs = db.query(AnalyticsRun).filter(AnalyticsRun.suite_id == suite.id).delete()
    db.delete(suite)
    db.commit()
    return {"deleted": True, "deleted_runs": deleted_runs}


@router.post("/suites/projects/{project_id}/default-suite")
async def get_or_create_default_suite(project_id: int,
                                      current_user: User = Depends(require("run.execute", project_from="project_id")),
                                      db: Session = Depends(get_db)):
    """The suite ad-hoc runs are filed under: the project's first suite, or a new "Default Suite". Anyone who may run
    tests may use it (creating other suites needs suite.manage)."""
    get_project_or_404(db, project_id)
    suite = (db.query(AnalyticsSuite).filter(AnalyticsSuite.project_id == project_id,
                                             AnalyticsSuite.archived_at.is_(None))
             .order_by(AnalyticsSuite.id).first())
    if suite is None:
        suite = AnalyticsSuite(project_id=project_id, name=DEFAULT_SUITE_NAME, tags=[], active=True,
                               created_by_user_id=current_user.id)
        db.add(suite)
        db.commit()
        db.refresh(suite)
    return suite_response(db, suite)


class SuiteRunRequest(BaseModel):
    environment_id: Optional[int] = None
    where: Literal["local", "actions"] = "local"
    branch: Optional[str] = Field(default=None, max_length=255)


async def start_suite_run(db: Session, user: Optional[User], suite: AnalyticsSuite, environment_id: Optional[int],
                          trigger: str = "manual", branch: Optional[str] = None,
                          repo_path: Optional[Path] = None) -> AnalyticsRun:
    """Create a run of the suite and start it in the user's checkout (also used by the scheduler). Without a user, it
    runs in ``repo_path`` as ATM itself: the project's service account (phase 18)."""
    if suite.archived_at is not None:
        raise HTTPException(status_code=400, detail="This suite is archived. Restore it to run it.")
    if not suite.target:
        raise HTTPException(status_code=400, detail="Choose what the suite runs (its target) first.")
    if repo_path is None:
        if user is None:
            raise HTTPException(status_code=400, detail="A run needs a person or the project's service account.")
        repo_path = checkout_path(user, suite.project_id)
    if not (repo_path / ".git").exists():
        raise HTTPException(status_code=400, detail="No local checkout linked for this project.")
    _environment(db, suite.project_id, environment_id)
    triggered_by = user.email if user and trigger == "manual" else trigger
    run = AnalyticsRun(suite_id=suite.id, branch=branch, triggered_by=triggered_by, name=suite.name, trigger=trigger,
                       started_by_id=user.id if user else None)
    db.add(run)
    db.commit()
    db.refresh(run)
    payload = AnalyticsRunExecuteRequest(run_type="framework", framework_target=suite.target,
                                         environment_id=environment_id)
    try:
        await _start_framework_run(run, f"manual-{run.id}", repo_path, payload, user, db)
    except HTTPException:
        # Not started (the target is gone, the runner is missing…): no pending run is left behind.
        db.delete(run)
        db.commit()
        raise
    db.refresh(run)
    return run


@router.post("/suites/{suite_id}/runs")
async def run_suite(suite_id: int, payload: SuiteRunRequest = SuiteRunRequest(),
                    current_user: User = Depends(require("run.execute", project_from="suite_id")),
                    db: Session = Depends(get_db)):
    """Run a suite here (in the user's checkout) or on GitHub Actions (its workflow)."""
    suite = _suite(db, suite_id)
    if suite.archived_at is not None:
        raise HTTPException(status_code=400, detail="This suite is archived. Restore it to run it.")
    environment_id = payload.environment_id if payload.environment_id is not None else suite.environment_id
    if payload.where == "actions":
        from app.modules.testing.router import WorkflowDispatchRequest, dispatch_project_github_workflow

        ensure(db, current_user, "run.execute.ci", suite.project_id)
        if not suite.ci_workflow:
            raise HTTPException(status_code=400, detail="This suite has no GitHub Actions workflow.")
        result = await dispatch_project_github_workflow(
            suite.project_id, WorkflowDispatchRequest(workflow_id=suite.ci_workflow, ref=payload.branch or "main"),
            current_user, db)
        return {"where": "actions", **result}
    run = await start_suite_run(db, current_user, suite, environment_id, branch=payload.branch)
    return {"where": "local", "run": _analytics_run_response(run)}


# ── Environments ──────────────────────────────────────────────────────────────


def environment_response(environment: TestEnvironment) -> dict:
    return {
        "id": str(environment.id),
        "project_id": str(environment.project_id),
        "name": environment.name,
        "variables": environment.variables or {},
        # Only the names: secret values never leave the server (phase 17).
        "secret_names": sorted(environment_secrets.read(environment)),
        "bruno_environment": environment.bruno_environment,
    }


class EnvironmentPayload(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    # Plain settings such as BASE_URL, shown to everyone in the project.
    variables: dict[str, str] = Field(default_factory=dict, max_length=100)
    # Secret variables (passwords, tokens): a value sets one, an empty value or null removes it, names left out stay.
    secrets: dict[str, Optional[str]] = Field(default_factory=dict, max_length=100)
    bruno_environment: Optional[str] = Field(default=None, max_length=100)


def _check_variable(key: str, value: Optional[str]) -> None:
    if not VARIABLE_NAME.match(key):
        raise HTTPException(status_code=400, detail=f"'{key}' is not a valid variable name (letters, digits, _).")
    if value is not None and len(value) > 2000:
        raise HTTPException(status_code=400, detail=f"The value of {key} is too long.")


def _clean_environment(payload: EnvironmentPayload) -> tuple[str, dict[str, str], Optional[str]]:
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="An environment needs a name.")
    for key, value in [*payload.variables.items(), *payload.secrets.items()]:
        _check_variable(key, value)
    return name, dict(payload.variables), (payload.bruno_environment or "").strip() or None


def _save_secrets(environment: TestEnvironment, variables: dict[str, str], changes: dict[str, Optional[str]]) -> None:
    secrets = environment_secrets.apply_changes(environment_secrets.read(environment), changes)
    both = sorted(set(secrets) & set(variables))
    if both:
        raise HTTPException(status_code=400, detail=f"{', '.join(both)} is both a variable and a secret.")
    environment_secrets.write(environment, secrets)


@router.get("/projects/{project_id}/environments")
async def list_environments(project_id: int,
                            current_user: User = Depends(require("run.view", project_from="project_id")),
                            db: Session = Depends(get_db)):
    get_project_or_404(db, project_id)
    environments = db.query(TestEnvironment).filter(TestEnvironment.project_id == project_id) \
        .order_by(TestEnvironment.name).all()
    return [environment_response(e) for e in environments]


@router.post("/projects/{project_id}/environments", status_code=201)
async def create_environment(project_id: int, payload: EnvironmentPayload,
                             current_user: User = Depends(require("environment.manage", project_from="project_id")),
                             db: Session = Depends(get_db)):
    get_project_or_404(db, project_id)
    name, variables, bruno = _clean_environment(payload)
    if db.query(TestEnvironment).filter(TestEnvironment.project_id == project_id, TestEnvironment.name == name).first():
        raise HTTPException(status_code=400, detail=f"The project already has an environment called '{name}'.")
    environment = TestEnvironment(project_id=project_id, name=name, variables=variables, bruno_environment=bruno)
    _save_secrets(environment, variables, payload.secrets)
    db.add(environment)
    db.commit()
    db.refresh(environment)
    return environment_response(environment)


def _project_environment(db: Session, project_id: int, environment_id: int) -> TestEnvironment:
    environment = db.query(TestEnvironment).filter(TestEnvironment.id == environment_id,
                                                   TestEnvironment.project_id == project_id).first()
    if not environment:
        raise HTTPException(status_code=404, detail="Environment not found.")
    return environment


@router.put("/projects/{project_id}/environments/{environment_id}")
async def update_environment(project_id: int, environment_id: int, payload: EnvironmentPayload,
                             current_user: User = Depends(require("environment.manage", project_from="project_id")),
                             db: Session = Depends(get_db)):
    environment = _project_environment(db, project_id, environment_id)
    name, variables, bruno = _clean_environment(payload)
    clash = db.query(TestEnvironment).filter(TestEnvironment.project_id == project_id, TestEnvironment.name == name,
                                             TestEnvironment.id != environment.id).first()
    if clash:
        raise HTTPException(status_code=400, detail=f"The project already has an environment called '{name}'.")
    _save_secrets(environment, variables, payload.secrets)
    environment.name, environment.variables, environment.bruno_environment = name, variables, bruno
    db.commit()
    db.refresh(environment)
    return environment_response(environment)


@router.delete("/projects/{project_id}/environments/{environment_id}")
async def delete_environment(project_id: int, environment_id: int,
                             current_user: User = Depends(require("environment.manage", project_from="project_id")),
                             db: Session = Depends(get_db)):
    """Suites and runs that used it keep running without an environment."""
    environment = _project_environment(db, project_id, environment_id)
    db.query(AnalyticsSuite).filter(AnalyticsSuite.environment_id == environment.id).update({"environment_id": None})
    db.query(AnalyticsRun).filter(AnalyticsRun.environment_id == environment.id).update({"environment_id": None})
    db.delete(environment)
    db.commit()
    return {"deleted": True}
