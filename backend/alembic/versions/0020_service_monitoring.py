"""Monitor service repositories and their provider portals.

Revision ID: 0020_service_monitoring
"""
import sqlalchemy as sa

from alembic import op

revision = "0020_service_monitoring"
down_revision = "0019_ai_usage"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("services") as batch:
        batch.add_column(sa.Column("repository_url", sa.String(1024), nullable=True))
        batch.add_column(sa.Column("main_branch", sa.String(255), nullable=False, server_default="main"))
        batch.add_column(sa.Column("check_portal_url", sa.String(1024), nullable=True))

    op.create_table(
        "service_merges",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("service_id", sa.Integer(), nullable=False),
        sa.Column("delivery_id", sa.String(100), nullable=False),
        sa.Column("pull_request_number", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("url", sa.String(1024), nullable=False),
        sa.Column("commit_sha", sa.String(64), nullable=True),
        sa.Column("merged_at", sa.DateTime(), nullable=False),
        sa.Column("received_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["service_id"], ["services.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("service_id", "delivery_id", name="uq_service_merge_delivery"),
    )
    op.create_index("ix_service_merges_service_id", "service_merges", ["service_id"])


def downgrade() -> None:
    op.drop_table("service_merges")
    with op.batch_alter_table("services") as batch:
        batch.drop_column("check_portal_url")
        batch.drop_column("main_branch")
        batch.drop_column("repository_url")
