"""Work items, trace links, and each project's Jira project and Confluence space (phase 06).

Revision ID: 0005_work_items
"""
import sqlalchemy as sa

from alembic import op

revision = "0005_work_items"
down_revision = "0004_roles_and_scope"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("projects") as batch:
        batch.add_column(sa.Column("jira_project_key", sa.String(50), nullable=True))
        batch.add_column(sa.Column("confluence_space_key", sa.String(100), nullable=True))

    op.create_table(
        "work_items",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("source", sa.String(16), nullable=False),
        sa.Column("external_key", sa.String(64), nullable=False),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("url", sa.String(1024), nullable=True),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("assignee_id", sa.Integer(), nullable=True),
        sa.Column("branch", sa.String(255), nullable=True),
        sa.Column("context_json", sa.JSON(), nullable=True),
        sa.Column("created_by_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["assignee_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("project_id", "source", "external_key", name="uq_work_item_source"),
    )
    op.create_index("ix_work_items_project_id", "work_items", ["project_id"])
    op.create_index("ix_work_items_assignee_id", "work_items", ["assignee_id"])

    op.create_table(
        "trace_links",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("work_item_id", sa.Integer(), nullable=False),
        sa.Column("target_type", sa.String(32), nullable=False),
        sa.Column("target_ref", sa.String(1024), nullable=False),
        sa.Column("label", sa.String(500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["work_item_id"], ["work_items.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("work_item_id", "target_type", "target_ref", name="uq_trace_link"),
    )
    op.create_index("ix_trace_links_work_item_id", "trace_links", ["work_item_id"])


def downgrade() -> None:
    op.drop_table("trace_links")
    op.drop_table("work_items")
    with op.batch_alter_table("projects") as batch:
        batch.drop_column("confluence_space_key")
        batch.drop_column("jira_project_key")
