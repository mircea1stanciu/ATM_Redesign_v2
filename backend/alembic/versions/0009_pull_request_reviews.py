"""Pull requests opened from ATM and reviews submitted through ATM (phase 12).

Revision ID: 0009_pull_request_reviews
"""
import sqlalchemy as sa

from alembic import op

revision = "0009_pull_request_reviews"
down_revision = "0008_deployments_notifications"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "pull_requests",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("url", sa.String(1024), nullable=True),
        sa.Column("head", sa.String(255), nullable=False),
        sa.Column("base", sa.String(255), nullable=False),
        sa.Column("author_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["author_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("project_id", "number", name="uq_pull_request_number"),
    )
    op.create_index("ix_pull_requests_project_id", "pull_requests", ["project_id"])
    op.create_index("ix_pull_requests_author_id", "pull_requests", ["author_id"])
    op.create_table(
        "pr_reviews",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("reviewer_id", sa.Integer(), nullable=True),
        sa.Column("event", sa.String(20), nullable=False),
        sa.Column("comments", sa.Integer(), nullable=False),
        sa.Column("ai_suggestions", sa.Integer(), nullable=False),
        sa.Column("github_review_id", sa.Integer(), nullable=True),
        sa.Column("submitted_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["reviewer_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_pr_reviews_project_id", "pr_reviews", ["project_id"])
    op.create_index("ix_pr_reviews_reviewer_id", "pr_reviews", ["reviewer_id"])


def downgrade() -> None:
    op.drop_table("pr_reviews")
    op.drop_table("pull_requests")
