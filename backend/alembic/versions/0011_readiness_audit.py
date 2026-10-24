"""Readiness requests and decisions, and the audit log (phase 14).

Revision ID: 0011_readiness_audit
"""
import sqlalchemy as sa

from alembic import op

revision = "0011_readiness_audit"
down_revision = "0010_learning"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "readiness_requests",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("requested_by_id", sa.Integer(), nullable=True),
        sa.Column("note", sa.String(2000), nullable=True),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("decision", sa.String(20), nullable=True),
        sa.Column("from_role", sa.String(40), nullable=True),
        sa.Column("to_role", sa.String(40), nullable=True),
        sa.Column("decision_note", sa.String(2000), nullable=True),
        sa.Column("decided_by_id", sa.Integer(), nullable=True),
        sa.Column("requested_at", sa.DateTime(), nullable=False),
        sa.Column("decided_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["requested_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["decided_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_readiness_requests_user_id", "readiness_requests", ["user_id"])
    op.create_table(
        "audit_log",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("action", sa.String(40), nullable=False),
        sa.Column("actor_id", sa.Integer(), nullable=True),
        sa.Column("subject_user_id", sa.Integer(), nullable=True),
        sa.Column("project_id", sa.Integer(), nullable=True),
        sa.Column("summary", sa.String(500), nullable=False),
        sa.Column("details", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["actor_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["subject_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    for column in ("action", "actor_id", "subject_user_id", "project_id", "created_at"):
        op.create_index(f"ix_audit_log_{column}", "audit_log", [column])


def downgrade() -> None:
    op.drop_table("audit_log")
    op.drop_table("readiness_requests")
