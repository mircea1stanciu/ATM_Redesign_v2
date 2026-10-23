"""
Migration: Add source and collection columns to test_runs table
Date: 2026-07-03
Description: Adds `source` ('local' | 'github_actions') and `collection` (the
collection/suite name that was executed) columns to test_runs so the Analytics
and Dashboard pages can distinguish and filter runs triggered locally vs. via
a dispatched GitHub Actions workflow.
"""

import os
import sqlite3
import sys

# Add parent directory to path to import database module
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def migrate():
    """Add source/collection columns to test_runs table."""
    db_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'unifiedwork.db')

    print(f"Migrating database: {db_path}")

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    try:
        cursor.execute("PRAGMA table_info(test_runs)")
        columns = [col[1] for col in cursor.fetchall()]

        if 'source' in columns and 'collection' in columns:
            print("✓ source/collection columns already exist. No migration needed.")
            return

        if 'source' not in columns:
            print("Adding source column...")
            cursor.execute("ALTER TABLE test_runs ADD COLUMN source VARCHAR(30) NOT NULL DEFAULT 'local'")
            print("✓ Added source column")

        if 'collection' not in columns:
            print("Adding collection column...")
            cursor.execute("ALTER TABLE test_runs ADD COLUMN collection VARCHAR(255)")
            print("✓ Added collection column")

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
