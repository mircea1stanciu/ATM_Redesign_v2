"""Report share links and automatic Confluence publishing (phase 19).

Revision ID: 0016_report_sharing
"""
import sqlalchemy as sa

from alembic import op

revision = "0016_report_sharing"
down_revision = "0015_service_account"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "report_share_links",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("token", sa.String(64), nullable=False),
        sa.Column("run_id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("created_by_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("views", sa.Integer(), nullable=False),
        sa.Column("last_viewed_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["run_id"], ["analytics_runs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token"),
    )
    op.create_index("ix_report_share_links_run_id", "report_share_links", ["run_id"])
    op.create_index("ix_report_share_links_project_id", "report_share_links", ["project_id"])
    with op.batch_alter_table("analytics_suites") as batch:
        batch.add_column(sa.Column("auto_publish_by_id", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("auto_publish_origin", sa.String(255), nullable=True))
        batch.create_foreign_key("fk_analytics_suites_auto_publish_by_id", "users", ["auto_publish_by_id"], ["id"],
                                 ondelete="SET NULL")


def downgrade() -> None:
    with op.batch_alter_table("analytics_suites") as batch:
        batch.drop_constraint("fk_analytics_suites_auto_publish_by_id", type_="foreignkey")
        batch.drop_column("auto_publish_origin")
        batch.drop_column("auto_publish_by_id")
    op.drop_table("report_share_links")
