"""Add the GitHub repository URL column to projects."""

import os
import sqlite3


def migrate():
    """Add projects.github_repo_url when it is missing."""
    db_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "unifiedwork.db",
    )

    print(f"Migrating database: {db_path}")

    conn = sqlite3.connect(db_path)
    try:
        columns = {
            column[1]
            for column in conn.execute("PRAGMA table_info(projects)").fetchall()
        }

        if "github_repo_url" in columns:
            print("github_repo_url column already exists. No migration needed.")
            return

        conn.execute(
            "ALTER TABLE projects ADD COLUMN github_repo_url VARCHAR(512)"
        )
        conn.commit()
        print("Added projects.github_repo_url.")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    migrate()