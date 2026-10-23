"""Bring the database to the latest Alembic revision; the only way the schema changes."""
import logging
import shutil
from datetime import datetime
from pathlib import Path

from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy.engine import make_url

from alembic import command
from app.core.config import BACKEND_DIR, settings
from app.core.db import engine

logger = logging.getLogger("atm.migrations")


def _alembic_config() -> Config:
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    # Keep the app's logging configuration; alembic.ini's would replace it.
    config.attributes["configure_logger"] = False
    return config


def _backup_sqlite_file() -> None:
    url = make_url(settings.database_url)
    if url.get_backend_name() != "sqlite" or not url.database:
        return
    path = Path(url.database)
    if not path.exists() or path.stat().st_size == 0:
        return
    backup = path.with_name(f"{path.name}.before-migration-{datetime.now():%Y%m%d-%H%M%S}")
    shutil.copy2(path, backup)
    logger.info("Backed up %s to %s before migrating", path, backup)


def upgrade_database() -> None:
    """Apply pending migrations. An existing SQLite file is copied next to itself first."""
    config = _alembic_config()
    head = ScriptDirectory.from_config(config).get_current_head()
    with engine.connect() as connection:
        current = MigrationContext.configure(connection).get_current_revision()
    if current == head:
        return
    _backup_sqlite_file()
    command.upgrade(config, "head")
    logger.info("Database migrated from %s to %s", current or "(no revision)", head)
