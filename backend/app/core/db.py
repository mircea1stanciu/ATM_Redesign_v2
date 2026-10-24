"""The single database engine, session factory and declarative Base of the app."""
from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.core.config import settings

_SQLITE = settings.database_url.startswith("sqlite")
# SQLite waits up to 30 s for another writer instead of failing at once with "database is locked".
_connect_args = {"check_same_thread": False, "timeout": 30} if _SQLITE else {}
# Requests keep their connection while they wait for GitHub, Jira or a test-framework scan, so the pool is larger than
# SQLAlchemy's default (5 + 10 overflow); ATM_DB_POOL_SIZE / ATM_DB_MAX_OVERFLOW tune it.
engine = create_engine(settings.database_url, connect_args=_connect_args, pool_pre_ping=True,
                       pool_size=settings.ATM_DB_POOL_SIZE, max_overflow=settings.ATM_DB_MAX_OVERFLOW)

if _SQLITE:
    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(dbapi_connection, _record):
        # WAL lets requests read while a run writes its results; one writer at a time still applies.
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.close()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def import_all_models() -> None:
    """Register every module's tables on Base.metadata (used by schema creation and Alembic)."""
    from app.modules.deployments import models as _deployments  # noqa: F401
    from app.modules.identity import models as _identity  # noqa: F401
    from app.modules.learning import models as _learning  # noqa: F401
    from app.modules.notifications import models as _notifications  # noqa: F401
    from app.modules.projects import models as _projects  # noqa: F401
    from app.modules.settings import models as _settings  # noqa: F401
    from app.modules.work import models as _work  # noqa: F401
