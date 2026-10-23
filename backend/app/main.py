from contextlib import asynccontextmanager
from pathlib import Path

# Use the OS-native certificate trust store (macOS Keychain / Windows Cert
# Store / Linux openssl) for all outbound TLS connections (httpx, etc.)
# instead of the bundled `certifi` CA list. This is required on corporate
# networks that intercept public HTTPS traffic (e.g. github.com) with a
# TLS-inspecting proxy (Zscaler, etc.) whose root CA is trusted by the OS
# but not by certifi, which otherwise causes CERTIFICATE_VERIFY_FAILED
# errors when calling out to GitHub/Jira from Settings > Test Connection.
# import truststore
# truststore.inject_into_ssl()
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.core.config import settings

FRONTEND_DIST = Path(__file__).parent.parent.parent / "frontend" / "dist"
# Phase 4-5 profile/settings/billing endpoints ported from the legacy backend.
# These use the synchronous ``core.database`` session and coexist with the async
# ``app`` routers (FastAPI runs sync dependencies in a threadpool). The native
# app integrations router is intentionally NOT used: it targets app.models
# tables (plural names) that don't exist in the live DB; the ported router
# targets the core.database tables (singular names) that do.
from api import auth_profile_routes, settings_routes
from app.api.v1.endpoints import auth, badges, projects, reports, runs, suites, webhooks
from app.api.v1.endpoints import community as community_router
from app.api.v1.endpoints import devices as devices_router
from app.api.v1.endpoints import settings as settings_router
from app.api.v1.endpoints import tasks as tasks_router
from app.api.v1.endpoints import test_manager as test_manager_router
from app.api.v1.endpoints import zephyr_planner as zephyr_planner_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    # shutdown


app = FastAPI(
    title="AutomationTestManager (ATM) API",
    version="1.0.0",
    description=(
        "REST API pentru **AutomationTestManager** — platformă de management şi execuţie "
        "a testelor automate.\n\n"
        "## Autentificare\n"
        "Foloseşte **Bearer JWT** obţinut de la `/api/v1/auth/login`.\n\n"
        "## Webhook-uri\n"
        "Endpoint-urile `/api/v1/webhooks/github/{project_id}` şi "
        "`/api/v1/webhooks/gitlab/{project_id}` permit declanşarea automată "
        "a rulărilor la push/PR — nu necesită autentificare, dar verifică semnătura HMAC.\n\n"
        "## Badge-uri\n"
        "Endpoint-ul `/api/v1/badge/project/{project_id}` returnează un SVG "
        "cu statusul ultimului run — poate fi inclus direct în README."
    ),
    openapi_tags=[
        {"name": "auth",      "description": "Autentificare şi managementul utilizatorilor"},
        {"name": "projects",  "description": "Proiecte şi configuraţii"},
        {"name": "suites",    "description": "Suite de teste şi scheduler"},
        {"name": "runs",      "description": "Rulări de teste şi rezultate"},
        {"name": "reports",   "description": "Rapoarte şi statistici"},
        {"name": "webhooks",  "description": "Webhook-uri GitHub / GitLab (public, verificat HMAC)"},
        {"name": "badges",    "description": "Badge-uri SVG pentru status run (public)"},
    ],
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router,      prefix="/api/v1/auth",      tags=["auth"])
app.include_router(projects.router,  prefix="/api/v1/projects",  tags=["projects"])
# Legacy compatibility aliases used by the frontend when it talks to the v1
# backend while still expecting the older /api/* route contract.
app.include_router(projects.router,  prefix="/api/projects",    tags=["projects-compat"])
app.include_router(suites.router,    prefix="/api/v1/suites",    tags=["suites"])
app.include_router(runs.router,      prefix="/api/v1/runs",      tags=["runs"])
app.include_router(reports.router,   prefix="/api/v1/reports",   tags=["reports"])
app.include_router(webhooks.router,  prefix="/api/v1/webhooks",  tags=["webhooks"])
app.include_router(badges.router,          prefix="/api/v1/badge",     tags=["badges"])
app.include_router(settings_router.router,     prefix="/api/v1/settings",      tags=["settings"])
app.include_router(settings_router.router,     prefix="/api/settings",         tags=["settings-compat"])
app.include_router(test_manager_router.router, prefix="/api/v1/test-manager", tags=["test-manager"])
app.include_router(tasks_router.router,        prefix="/api/v1/tasks",        tags=["tasks"])
app.include_router(zephyr_planner_router.router, prefix="/api/v1/zephyr-planner", tags=["zephyr-planner"])
app.include_router(community_router.router,    prefix="/api/v1/community",    tags=["community"])
app.include_router(devices_router.router,      prefix="/api/v1/devices",      tags=["devices"])
app.include_router(devices_router.router,      prefix="/api/devices",         tags=["devices-compat"])

# Phase 4-5 ported routers (sync core.database). Mounted under /api/v1 to match
# the frontend contract: profile management, security/preferences/privacy
# settings, and data/integrations/subscription/billing.
app.include_router(auth_profile_routes.router, prefix="/api/v1/auth", tags=["profile"])
app.include_router(settings_routes.router,     prefix="/api/v1")


@app.get("/health")
async def health_check():
    return {"status": "ok", "version": "0.1.0"}


# ── Serve React SPA ──────────────────────────────────────────────────────────
if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_spa(full_path: str):
        file = FRONTEND_DIST / full_path
        if file.is_file():
            return FileResponse(file)
        return FileResponse(FRONTEND_DIST / "index.html")
