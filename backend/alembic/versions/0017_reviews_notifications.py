"""Personal e-mail and Teams notifications, the SMTP server, line comments posted at once (phase 20).

Revision ID: 0017_reviews_notifications
"""
import sqlalchemy as sa

from alembic import op

revision = "0017_reviews_notifications"
down_revision = "0016_report_sharing"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("notification_subscriptions") as batch:
        batch.add_column(sa.Column("email_kinds", sa.JSON(), nullable=False, server_default="[]"))
        batch.add_column(sa.Column("teams_kinds", sa.JSON(), nullable=False, server_default="[]"))
        batch.add_column(sa.Column("teams_webhook", sa.Text(), nullable=True))
    op.create_table(
        "mail_server",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("host", sa.String(255), nullable=False),
        sa.Column("port", sa.Integer(), nullable=False),
        sa.Column("security", sa.String(10), nullable=False),
        sa.Column("username", sa.String(255), nullable=True),
        sa.Column("password", sa.Text(), nullable=True),
        sa.Column("sender", sa.String(255), nullable=False),
        sa.Column("updated_by_id", sa.Integer(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["updated_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "pr_line_comments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("author_id", sa.Integer(), nullable=True),
        sa.Column("github_comment_id", sa.Integer(), nullable=True),
        sa.Column("suggested_by_ai", sa.Boolean(), nullable=False),
        sa.Column("review_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["author_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["review_id"], ["pr_reviews.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_pr_line_comments_project_id", "pr_line_comments", ["project_id"])
    op.create_index("ix_pr_line_comments_author_id", "pr_line_comments", ["author_id"])


def downgrade() -> None:
    op.drop_table("pr_line_comments")
    op.drop_table("mail_server")
    with op.batch_alter_table("notification_subscriptions") as batch:
        batch.drop_column("teams_webhook")
        batch.drop_column("teams_kinds")
        batch.drop_column("email_kinds")
