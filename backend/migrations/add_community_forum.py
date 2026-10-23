"""
Migration: Add Community Forum Tables

Creates tables for the per-community discussion forum:
  - forum_posts       : discussion threads scoped to a community
  - forum_comments    : threaded comments on posts
  - forum_attachments : files attached to posts/comments
  - forum_reactions   : likes/reactions on posts/comments

Idempotent: safe to run multiple times (CREATE TABLE IF NOT EXISTS).
"""
import os
import sqlite3

# Project root (two levels up from migrations/)
project_root = os.path.dirname(os.path.dirname(__file__))
db_file = os.path.join(project_root, "unifiedwork.db")
print(f"📂 Using database file: {db_file}")


def migrate():
    print("🔄 Starting migration to add community forum tables...")

    conn = sqlite3.connect(db_file)
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS forum_posts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                organization_id INTEGER,
                community_id VARCHAR(50) NOT NULL,
                author_id INTEGER,
                title VARCHAR(300) NOT NULL,
                body TEXT NOT NULL DEFAULT '',
                tags JSON,
                is_pinned BOOLEAN DEFAULT 0 NOT NULL,
                is_locked BOOLEAN DEFAULT 0 NOT NULL,
                is_deleted BOOLEAN DEFAULT 0 NOT NULL,
                view_count INTEGER DEFAULT 0 NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
                FOREIGN KEY (organization_id) REFERENCES organizations(id),
                FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL
            )
            """
        )
        cursor.execute("CREATE INDEX IF NOT EXISTS ix_forum_posts_community_id ON forum_posts(community_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS ix_forum_posts_author_id ON forum_posts(author_id)")
        print("✅ Created forum_posts table")

        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS forum_comments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                post_id INTEGER NOT NULL,
                parent_comment_id INTEGER,
                author_id INTEGER,
                body TEXT NOT NULL DEFAULT '',
                is_deleted BOOLEAN DEFAULT 0 NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
                FOREIGN KEY (post_id) REFERENCES forum_posts(id) ON DELETE CASCADE,
                FOREIGN KEY (parent_comment_id) REFERENCES forum_comments(id) ON DELETE CASCADE,
                FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL
            )
            """
        )
        cursor.execute("CREATE INDEX IF NOT EXISTS ix_forum_comments_post_id ON forum_comments(post_id)")
        print("✅ Created forum_comments table")

        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS forum_attachments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                post_id INTEGER,
                comment_id INTEGER,
                uploader_id INTEGER,
                file_name VARCHAR NOT NULL,
                original_name VARCHAR NOT NULL,
                file_type VARCHAR,
                file_size INTEGER,
                kind VARCHAR(20) DEFAULT 'document' NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
                FOREIGN KEY (post_id) REFERENCES forum_posts(id) ON DELETE CASCADE,
                FOREIGN KEY (comment_id) REFERENCES forum_comments(id) ON DELETE CASCADE,
                FOREIGN KEY (uploader_id) REFERENCES users(id) ON DELETE SET NULL
            )
            """
        )
        cursor.execute("CREATE INDEX IF NOT EXISTS ix_forum_attachments_post_id ON forum_attachments(post_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS ix_forum_attachments_comment_id ON forum_attachments(comment_id)")
        print("✅ Created forum_attachments table")

        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS forum_reactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                post_id INTEGER,
                comment_id INTEGER,
                user_id INTEGER NOT NULL,
                reaction VARCHAR(20) DEFAULT 'like' NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
                FOREIGN KEY (post_id) REFERENCES forum_posts(id) ON DELETE CASCADE,
                FOREIGN KEY (comment_id) REFERENCES forum_comments(id) ON DELETE CASCADE,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                UNIQUE(user_id, post_id, comment_id, reaction)
            )
            """
        )
        cursor.execute("CREATE INDEX IF NOT EXISTS ix_forum_reactions_post_id ON forum_reactions(post_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS ix_forum_reactions_comment_id ON forum_reactions(comment_id)")
        print("✅ Created forum_reactions table")

        conn.commit()
        print("🎉 Community forum migration complete.")
    finally:
        conn.close()


if __name__ == "__main__":
    migrate()
