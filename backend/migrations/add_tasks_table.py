"""
Database migration: Add Task Management table
Run this script to add the `tasks` table used by the "Task Management"
sub-page under Jira Management.
"""

import sqlite3
import sys
from pathlib import Path

# Add parent directory to path (consistent with sibling migration scripts)
sys.path.append(str(Path(__file__).parent.parent))


def migrate():
    """Add tasks table to database"""
    try:
        print("🔄 Starting Task Management migration...")

        db_path = Path(__file__).parent.parent / "unifiedwork.db"
        conn = sqlite3.connect(str(db_path))
        cursor = conn.cursor()

        print("  Creating tasks table...")
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                team_name VARCHAR(255) NOT NULL,
                title VARCHAR(255) NOT NULL,
                description TEXT,
                status VARCHAR(20) NOT NULL DEFAULT 'todo',
                assignee_id INTEGER,
                created_by_id INTEGER,
                created_at DATETIME,
                updated_at DATETIME,
                FOREIGN KEY (assignee_id) REFERENCES users(id) ON DELETE SET NULL,
                FOREIGN KEY (created_by_id) REFERENCES users(id) ON DELETE SET NULL
            )
        ''')
        cursor.execute('CREATE INDEX IF NOT EXISTS ix_tasks_team_name ON tasks (team_name)')

        conn.commit()
        conn.close()
        print("✅ Task Management migration complete.")
    except Exception as e:
        print(f"❌ Migration failed: {e}")
        raise


if __name__ == "__main__":
    migrate()
