"""The single database engine, session factory and declarative Base of the app."""
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.core.config import settings

_connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
engine = create_engine(settings.database_url, connect_args=_connect_args, pool_pre_ping=True)
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
    from app.modules.identity import models as _identity  # noqa: F401
    from app.modules.projects import models as _projects  # noqa: F401
