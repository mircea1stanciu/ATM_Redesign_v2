"""Drop the tables of features removed in phase 02 and of the abandoned second data model.

Only the tables named here are dropped, and only when they exist; any other table is left alone. The app backs up
an existing SQLite file before it applies migrations (see app/core/migrations.py).

Revision ID: 0002_drop_removed_features
"""
import sqlalchemy as sa

from alembic import op

revision = "0002_drop_removed_features"
down_revision = "0001_baseline"
branch_labels = None
depends_on = None

REMOVED_TABLES = [
    # Office booking
    "desk_bookings", "desk_islands", "island_bookings", "meeting_room_bookings", "meeting_room_islands",
    "meeting_rooms", "office_desks", "office_settings", "parking_bookings", "parking_spaces",
    # Billing and subscriptions
    "billing_invoice", "billing_invoices", "payment_method", "payment_methods", "subscription", "subscriptions",
    "user_subscriptions",
    # Messaging and the UnifiedWork chat agents
    "chat_sessions", "conversation_participants", "conversations", "message_reactions", "messages",
    "user_presence",
    # Mock settings
    "data_export", "data_exports", "integration", "integrations", "privacy_settings", "webhook", "webhooks",
    # The internal Jira clone
    "issue_activities", "issue_attachments", "issue_comments", "issue_watchers", "issues", "sprints",
    # The abandoned second data model (UUID ids)
    "artifacts", "test_results", "test_runs", "test_suites", "projects_legacy_backup",
]


def upgrade() -> None:
    existing = set(sa.inspect(op.get_bind()).get_table_names())
    for name in REMOVED_TABLES:
        if name in existing:
            op.drop_table(name)


def downgrade() -> None:
    raise NotImplementedError("Dropped tables cannot be restored; use the backup made before the upgrade.")
