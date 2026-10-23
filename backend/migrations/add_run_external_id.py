"""
Migration: Add external_id column to test_runs table
Date: 2026-07-03
Description: Adds `external_id` (e.g. a GitHub Actions run id) to test_runs so
runs fetched/synced from GitHub Actions can be de-duplicated on repeated syncs.
"""

import os
import sqlite3
import sys

# Add parent directory to path to import database module
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def migrate():
    """Add external_id column (+ index) to test_runs table."""
    db_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'unifiedwork.db')

    print(f"Migrating database: {db_path}")

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    try:
        cursor.execute("PRAGMA table_info(test_runs)")
        columns = [col[1] for col in cursor.fetchall()]

        if 'external_id' in columns:
            print("✓ external_id column already exists. No migration needed.")
            return

        print("Adding external_id column...")
        cursor.execute("ALTER TABLE test_runs ADD COLUMN external_id VARCHAR(100)")
        cursor.execute("CREATE INDEX IF NOT EXISTS ix_test_runs_external_id ON test_runs (external_id)")
        print("✓ Added external_id column + index")

        conn.commit()
        print("\n✅ Migration completed successfully!")

    except Exception as e:
        conn.rollback()
        print(f"\n❌ Migration failed: {e}")
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    migrate()
