"""Deployments, the service map, environment checks and notifications (phase 11).

Revision ID: 0008_deployments_notifications
"""
import sqlalchemy as sa

from alembic import op

revision = "0008_deployments_notifications"
down_revision = "0007_report_publications"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("projects") as batch:
        batch.add_column(sa.Column("teams_webhook", sa.String(1024), nullable=True))
    with op.batch_alter_table("analytics_runs") as batch:
        batch.add_column(sa.Column("started_by_id", sa.Integer(), nullable=True))
        batch.create_foreign_key("fk_analytics_runs_started_by_id", "users", ["started_by_id"], ["id"],
                                 ondelete="SET NULL")
    op.create_table(
        "services",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("description", sa.String(500), nullable=True),
        sa.Column("webhook_secret", sa.String(512), nullable=False),
        sa.Column("created_by_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )
    op.create_table(
        "service_projects",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("service_id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("smoke_suite_id", sa.Integer(), nullable=True),
        sa.Column("check_user_id", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["service_id"], ["services.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["smoke_suite_id"], ["analytics_suites.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["check_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("service_id", "project_id", name="uq_service_project"),
    )
    op.create_index("ix_service_projects_service_id", "service_projects", ["service_id"])
    op.create_index("ix_service_projects_project_id", "service_projects", ["project_id"])
    op.create_table(
        "deployments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("service_id", sa.Integer(), nullable=False),
        sa.Column("version", sa.String(100), nullable=False),
        sa.Column("environment", sa.String(100), nullable=False),
        sa.Column("source", sa.String(255), nullable=True),
        sa.Column("commit_sha", sa.String(64), nullable=True),
        sa.Column("url", sa.String(1024), nullable=True),
        sa.Column("notes", sa.String(2000), nullable=True),
        sa.Column("delivery_id", sa.String(100), nullable=True),
        sa.Column("deployed_at", sa.DateTime(), nullable=False),
        sa.Column("received_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["service_id"], ["services.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("service_id", "delivery_id", name="uq_deployment_delivery"),
    )
    op.create_index("ix_deployments_service_id", "deployments", ["service_id"])
    op.create_index("ix_deployments_deployed_at", "deployments", ["deployed_at"])
    op.create_table(
        "deployment_checks",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("deployment_id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("suite_id", sa.Integer(), nullable=True),
        sa.Column("run_id", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("detail", sa.String(500), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["deployment_id"], ["deployments.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["suite_id"], ["analytics_suites.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["run_id"], ["analytics_runs.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_deployment_checks_deployment_id", "deployment_checks", ["deployment_id"])
    op.create_index("ix_deployment_checks_run_id", "deployment_checks", ["run_id"])
    op.create_table(
        "notifications",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(30), nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("body", sa.String(1000), nullable=True),
        sa.Column("link", sa.String(1024), nullable=True),
        sa.Column("project_id", sa.Integer(), nullable=True),
        sa.Column("deployment_id", sa.Integer(), nullable=True),
        sa.Column("read_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["deployment_id"], ["deployments.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_notifications_user_created", "notifications", ["user_id", "created_at"])
    op.create_index("ix_notifications_deployment_id", "notifications", ["deployment_id"])
    op.create_table(
        "notification_subscriptions",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("muted_kinds", sa.JSON(), nullable=False),
        sa.Column("muted_project_ids", sa.JSON(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id"),
    )


def downgrade() -> None:
    op.drop_table("notification_subscriptions")
    op.drop_table("notifications")
    op.drop_table("deployment_checks")
    op.drop_table("deployments")
    op.drop_table("service_projects")
    op.drop_table("services")
    with op.batch_alter_table("analytics_runs") as batch:
        batch.drop_constraint("fk_analytics_runs_started_by_id", type_="foreignkey")
        batch.drop_column("started_by_id")
    with op.batch_alter_table("projects") as batch:
        batch.drop_column("teams_webhook")
