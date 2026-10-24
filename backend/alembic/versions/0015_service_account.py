"""The project's ATM service account for scheduled runs (phase 18).

Revision ID: 0015_service_account
"""
import sqlalchemy as sa

from alembic import op

revision = "0015_service_account"
down_revision = "0014_secrets_archive"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("projects") as batch:
        batch.add_column(sa.Column("service_github_token", sa.String(1024), nullable=True))
        batch.add_column(sa.Column("service_configured_by_id", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("service_synced_at", sa.DateTime(), nullable=True))
        batch.add_column(sa.Column("service_error", sa.String(500), nullable=True))
        batch.create_foreign_key("fk_projects_service_configured_by_id", "users", ["service_configured_by_id"], ["id"],
                                 ondelete="SET NULL")


def downgrade() -> None:
    with op.batch_alter_table("projects") as batch:
        batch.drop_constraint("fk_projects_service_configured_by_id", type_="foreignkey")
        batch.drop_column("service_error")
        batch.drop_column("service_synced_at")
        batch.drop_column("service_configured_by_id")
        batch.drop_column("service_github_token")
