"""Publishing reports to Confluence: each project's parent page and the history of publications (phase 10).

Revision ID: 0007_report_publications
"""
import sqlalchemy as sa

from alembic import op

revision = "0007_report_publications"
down_revision = "0006_suites_environments"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("projects") as batch:
        batch.add_column(sa.Column("confluence_parent_page_id", sa.String(64), nullable=True))
    op.create_table(
        "report_publications",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("run_id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("page_id", sa.String(64), nullable=True),
        sa.Column("page_url", sa.String(1024), nullable=True),
        sa.Column("page_version", sa.Integer(), nullable=True),
        sa.Column("attachment", sa.String(255), nullable=True),
        sa.Column("error", sa.String(1000), nullable=True),
        sa.Column("published_by_id", sa.Integer(), nullable=True),
        sa.Column("published_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["run_id"], ["analytics_runs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["published_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_report_publications_id", "report_publications", ["id"])
    op.create_index("ix_report_publications_run_id", "report_publications", ["run_id"])
    op.create_index("ix_report_publications_project_id", "report_publications", ["project_id"])


def downgrade() -> None:
    op.drop_table("report_publications")
    with op.batch_alter_table("projects") as batch:
        batch.drop_column("confluence_parent_page_id")
