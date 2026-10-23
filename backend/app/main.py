"""The ATM backend: one FastAPI application that mounts every module's router."""
import logging
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from sqlalchemy import inspect, text

from api import ai_routes, project_routes, settings_routes
from app.core.config import BACKEND_DIR, settings
from app.core.db import Base, SessionLocal, engine, import_all_models
from app.core.rate_limit import limiter
from app.modules.identity.router import router as identity_router
from app.modules.identity.service import get_default_organization, seed_dev_admin
from app.modules.settings.router import router as connections_router
from app.modules.testing.devices_router import router as devices_router

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
app.include_router(project_routes.router)
app.include_router(project_routes.analytics_router)
app.include_router(ai_routes.router)
# Account settings (security, preferences, filters, Confluence) are matched before the connection settings.
app.include_router(settings_routes.router, prefix="/api")
app.include_router(connections_router, prefix="/api/settings", tags=["Settings"])
app.include_router(devices_router, prefix="/api/devices", tags=["Devices"])


@app.get("/api/health", tags=["Health"])
async def health_check():
    return {"status": "healthy", "timestamp": datetime.now().isoformat()}


def _init_db() -> None:
    import_all_models()
    Base.metadata.create_all(bind=engine)
    inspector = inspect(engine)
    if "analytics_runs" in inspector.get_table_names():
        run_columns = {column["name"] for column in inspector.get_columns("analytics_runs")}
        added = {
            "logs_json": "JSON NOT NULL DEFAULT '[]'",
            "collection_path": "VARCHAR(512)",
            "environment": "VARCHAR(255)",
            "results_json": "JSON NOT NULL DEFAULT '[]'",
            "name": "VARCHAR(255)",
            "details_json": "JSON",
        }
        with engine.begin() as connection:
            for column, ddl in added.items():
                if column not in run_columns:
                    connection.execute(text(f"ALTER TABLE analytics_runs ADD COLUMN {column} {ddl}"))
    db = SessionLocal()
    try:
        get_default_organization(db)
        seed_dev_admin(db)
    finally:
        db.close()


@app.on_event("startup")
async def startup_event():
    """Prepare the database and re-attach long-running executions started before a restart."""
    _init_db()
    try:
        await project_routes.resume_orphaned_manual_runs()
    except Exception as exc:
        print(f"❌ Failed to resume running executions: {exc}")


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
