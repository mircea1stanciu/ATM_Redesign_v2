"""Counting each use of the AI (assistant messages, tutor questions, AI reviews) for readiness evidence (phase 22).

Revision ID: 0019_ai_usage
"""
import sqlalchemy as sa

from alembic import op

revision = "0019_ai_usage"
down_revision = "0018_learning_community"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ai_usage",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_ai_usage_user_kind", "ai_usage", ["user_id", "kind"])


def downgrade() -> None:
    op.drop_table("ai_usage")
