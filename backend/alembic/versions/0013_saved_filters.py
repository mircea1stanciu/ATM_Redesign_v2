"""Saved inbox filters per user and project (phase 16).

Revision ID: 0013_saved_filters
"""
import sqlalchemy as sa

from alembic import op

revision = "0013_saved_filters"
down_revision = "0012_no_automatic_memberships"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "saved_filters",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("filters", sa.JSON(), nullable=False),
        sa.Column("is_default", sa.Boolean(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "project_id", "name", name="uq_saved_filter_name"),
    )
    op.create_index("ix_saved_filters_user_id", "saved_filters", ["user_id"])
    op.create_index("ix_saved_filters_project_id", "saved_filters", ["project_id"])


def downgrade() -> None:
    op.drop_table("saved_filters")
