"""Move personal tokens from users.settings_json into the encrypted user_connections table.

Moved: GitHub, Jira and Confluence tokens, per-project GitHub tokens, the Zephyr session cookie and the AI
assistant settings (API keys, OAuth tokens). They are encrypted with the key from ATM_SECRET_KEY (or derived
from SECRET_KEY) and removed from settings_json.

Revision ID: 0003_user_connections
"""
import json
from datetime import datetime

import sqlalchemy as sa

from alembic import op
from app.core.crypto import decrypt, encrypt

revision = "0003_user_connections"
down_revision = "0002_drop_removed_features"
branch_labels = None
depends_on = None

TOKEN_KEYS = {
    "github_token": "github",
    "jira_token": "jira",
    "confluence_token": "confluence",
    "zephyr_session_cookie": "zephyr_session",
}

users = sa.table("users", sa.column("id", sa.Integer), sa.column("settings_json", sa.JSON))
connections = sa.table(
    "user_connections",
    sa.column("user_id", sa.Integer),
    sa.column("kind", sa.String),
    sa.column("ref", sa.String),
    sa.column("secret", sa.Text),
    sa.column("created_at", sa.DateTime),
    sa.column("updated_at", sa.DateTime),
)


def upgrade() -> None:
    op.create_table(
        "user_connections",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=40), nullable=False),
        sa.Column("ref", sa.String(length=64), nullable=False),
        sa.Column("secret", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "kind", "ref", name="uq_user_connection"),
    )
    op.create_index("ix_user_connections_user_id", "user_connections", ["user_id"], unique=False)

    bind = op.get_bind()
    now = datetime.utcnow()
    for user_id, settings in bind.execute(sa.select(users.c.id, users.c.settings_json)).all():
        if isinstance(settings, str):  # SQLite JSON read through a plain column
            settings = json.loads(settings or "{}")
        if not isinstance(settings, dict):
            continue
        rows = []
        for key, kind in TOKEN_KEYS.items():
            if settings.get(key):
                rows.append((kind, "", str(settings[key])))
        project_tokens = settings.get("project_github_tokens")
        if isinstance(project_tokens, dict):
            rows += [("github_project", str(ref), str(token)) for ref, token in project_tokens.items() if token]
        if isinstance(settings.get("ai_assistant"), dict) and settings["ai_assistant"]:
            rows.append(("ai_assistant", "", json.dumps(settings["ai_assistant"])))
        if not rows:
            continue
        bind.execute(connections.insert(), [
            {"user_id": user_id, "kind": kind, "ref": ref, "secret": encrypt(value),
             "created_at": now, "updated_at": now}
            for kind, ref, value in rows
        ])
        remaining = {k: v for k, v in settings.items()
                     if k not in TOKEN_KEYS and k not in ("project_github_tokens", "ai_assistant")}
        bind.execute(users.update().where(users.c.id == user_id).values(settings_json=remaining))


def downgrade() -> None:
    bind = op.get_bind()
    by_user: dict[int, dict] = {}
    for user_id, kind, ref, secret in bind.execute(
        sa.select(connections.c.user_id, connections.c.kind, connections.c.ref, connections.c.secret)
    ).all():
        value = decrypt(secret)
        moved = by_user.setdefault(user_id, {})
        if kind == "github_project":
            moved.setdefault("project_github_tokens", {})[ref] = value
        elif kind == "ai_assistant":
            moved["ai_assistant"] = json.loads(value)
        else:
            key = next(k for k, v in TOKEN_KEYS.items() if v == kind)
            moved[key] = value
    for user_id, moved in by_user.items():
        current = bind.execute(sa.select(users.c.settings_json).where(users.c.id == user_id)).scalar()
        if isinstance(current, str):
            current = json.loads(current or "{}")
        bind.execute(users.update().where(users.c.id == user_id).values(settings_json={**(current or {}), **moved}))
    op.drop_index("ix_user_connections_user_id", table_name="user_connections")
    op.drop_table("user_connections")
