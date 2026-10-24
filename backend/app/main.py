"""The ATM backend: one FastAPI application that mounts every module's router."""
import asyncio
import logging
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.core.config import BACKEND_DIR, settings
from app.core.db import SessionLocal
from app.core.migrations import upgrade_database
from app.core.permissions import PermissionDenied
from app.core.rate_limit import limiter
from app.modules.identity.router import router as identity_router
from app.modules.identity.service import get_default_organization, seed_dev_admin
from app.modules.identity.users_router import router as users_router
from app.modules.learning.community_router import router as community_router
from app.modules.projects.router import router as projects_router
from app.modules.reporting.router import router as reporting_router
from app.modules.settings.account_router import router as account_settings_router
from app.modules.settings.router import router as connections_router
from app.modules.testing.devices_router import router as devices_router
from app.modules.testing.router import router as testing_router
from app.modules.testing.router import runs_router
from app.modules.testing.runs import resume_orphaned_manual_runs
from app.modules.testing.scheduler import scheduler_loop
from app.modules.testing.suites_router import router as suites_router
from app.modules.work.router import router as work_router
from app.modules.work.tasks_router import router as tasks_router
from app.modules.work.test_manager_router import router as test_manager_router
from app.modules.work.zephyr_planner_router import router as zephyr_planner_router
from app.modules.workspace.assistant_router import router as assistant_router
from app.modules.workspace.router import router as workspace_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[logging.FileHandler(BACKEND_DIR / "auth_audit.log"), logging.StreamHandler()],
)

FRONTEND_DIST = BACKEND_DIR.parent / "frontend" / "dist"

app = FastAPI(
    title="ATM API",
    description="AutomationTestManager: run, review and report automated tests.",
    version="3.0.0",
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)  # type: ignore[arg-type]


@app.exception_handler(PermissionDenied)
async def permission_denied_handler(request: Request, exc: PermissionDenied):
    return JSONResponse(status_code=403, content={"detail": exc.detail, "code": "permission_denied"})

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline';"
    )
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
    return response


app.include_router(identity_router, tags=["Identity"])
app.include_router(users_router)
app.include_router(projects_router)
app.include_router(workspace_router)
app.include_router(testing_router)
app.include_router(reporting_router)
app.include_router(suites_router)
app.include_router(runs_router)
app.include_router(assistant_router)
# Account settings (security, preferences, filters, Confluence) are matched before the connection settings.
app.include_router(account_settings_router, prefix="/api")
app.include_router(connections_router, prefix="/api/settings", tags=["Settings"])
app.include_router(devices_router, prefix="/api/devices", tags=["Devices"])
app.include_router(test_manager_router, prefix="/api/test-manager", tags=["Work"])
app.include_router(tasks_router, prefix="/api/tasks", tags=["Work"])
app.include_router(zephyr_planner_router, prefix="/api/zephyr-planner", tags=["Work"])
app.include_router(work_router)
app.include_router(community_router, prefix="/api/community", tags=["Learning"])


@app.get("/api/health", tags=["Health"])
async def health_check():
    return {"status": "healthy", "timestamp": datetime.now().isoformat()}


def prepare_database() -> None:
    """Apply pending migrations, then make sure the default organization (and dev admin) exist."""
    upgrade_database()
    db = SessionLocal()
    try:
        get_default_organization(db)
        seed_dev_admin(db)
    finally:
        db.close()


_background_tasks: set[asyncio.Task] = set()


@app.on_event("startup")
async def startup_event():
    """Prepare the database, re-attach executions started before a restart and start the suite scheduler."""
    prepare_database()
    try:
        await resume_orphaned_manual_runs()
    except Exception as exc:
        print(f"❌ Failed to resume running executions: {exc}")
    if settings.ATM_SCHEDULER_ENABLED:
        task = asyncio.create_task(scheduler_loop())
        _background_tasks.add(task)  # keep a reference: the loop must not be garbage collected


@app.on_event("shutdown")
async def shutdown_event():
    for task in _background_tasks:
        task.cancel()


# Serve the built React app (Docker image). Registered last so it never shadows an API route.
if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_spa(full_path: str):
        if full_path == "api" or full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not Found")
        file = (FRONTEND_DIST / full_path).resolve()
        if file.is_file() and Path(FRONTEND_DIST.resolve()) in file.parents:
            return FileResponse(file)
        return FileResponse(FRONTEND_DIST / "index.html")
