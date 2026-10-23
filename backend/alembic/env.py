"""Alembic environment: migrates the database configured for the app (ATM_DATABASE_URL / ATM_DATABASE_PATH)."""
import os
import sys
from logging.config import fileConfig

from sqlalchemy import create_engine, pool

from alembic import context

# Make the backend folder importable when alembic runs from the command line.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.config import settings  # noqa: E402
from app.core.db import Base, import_all_models  # noqa: E402

config = context.config
# The app runs migrations at startup and keeps its own logging; the command line uses alembic.ini's.
if config.config_file_name is not None and config.attributes.get("configure_logger", True):
    fileConfig(config.config_file_name)

import_all_models()
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=settings.database_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def _run(connection) -> None:
    # Batch mode lets ALTER-style operations work on SQLite.
    context.configure(connection=connection, target_metadata=target_metadata, render_as_batch=True)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    # Tests pass their own connection; otherwise migrate the app's database.
    connection = config.attributes.get("connection")
    if connection is not None:
        _run(connection)
        return
    with create_engine(settings.database_url, poolclass=pool.NullPool).connect() as own_connection:
        _run(own_connection)


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
