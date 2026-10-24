"""Database engine settings."""
from sqlalchemy import text

from app.core.db import engine


def test_sqlite_runs_in_wal_mode_with_a_busy_timeout():
    # Runs write their results while the UI reads: WAL keeps readers from blocking the writer.
    with engine.connect() as connection:
        assert connection.execute(text("PRAGMA journal_mode")).scalar() == "wal"
        assert connection.execute(text("PRAGMA busy_timeout")).scalar() == 30000
