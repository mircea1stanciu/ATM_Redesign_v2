"""Suites with test type, target, environment and schedule; project environments; run trigger (phase 08).

Revision ID: 0006_suites_environments
"""
import sqlalchemy as sa

from alembic import op

revision = "0006_suites_environments"
down_revision = "0005_work_items"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "test_environments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("variables", sa.JSON(), nullable=False),
        sa.Column("bruno_environment", sa.String(100), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("project_id", "name", name="uq_test_environment_name"),
    )
    op.create_index("ix_test_environments_id", "test_environments", ["id"])
    op.create_index("ix_test_environments_project_id", "test_environments", ["project_id"])

    with op.batch_alter_table("analytics_suites") as batch:
        batch.add_column(sa.Column("test_type", sa.String(20), server_default="functional", nullable=False))
        batch.add_column(sa.Column("target", sa.String(512), nullable=True))
        batch.add_column(sa.Column("environment_id", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("ci_workflow", sa.String(255), nullable=True))
        batch.add_column(sa.Column("schedule_user_id", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("last_scheduled_at", sa.DateTime(), nullable=True))
        batch.create_foreign_key("fk_analytics_suites_environment_id", "test_environments", ["environment_id"], ["id"],
                                 ondelete="SET NULL")
        batch.create_foreign_key("fk_analytics_suites_schedule_user_id", "users", ["schedule_user_id"], ["id"],
                                 ondelete="SET NULL")

    with op.batch_alter_table("analytics_runs") as batch:
        batch.add_column(sa.Column("environment_id", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("trigger", sa.String(20), server_default="manual", nullable=False))
        batch.create_foreign_key("fk_analytics_runs_environment_id", "test_environments", ["environment_id"], ["id"],
                                 ondelete="SET NULL")


def downgrade() -> None:
    with op.batch_alter_table("analytics_runs") as batch:
        batch.drop_constraint("fk_analytics_runs_environment_id", type_="foreignkey")
        batch.drop_column("trigger")
        batch.drop_column("environment_id")
    with op.batch_alter_table("analytics_suites") as batch:
        batch.drop_constraint("fk_analytics_suites_schedule_user_id", type_="foreignkey")
        batch.drop_constraint("fk_analytics_suites_environment_id", type_="foreignkey")
        for column in ("last_scheduled_at", "schedule_user_id", "ci_workflow", "environment_id", "target",
                       "test_type"):
            batch.drop_column(column)
    op.drop_table("test_environments")
