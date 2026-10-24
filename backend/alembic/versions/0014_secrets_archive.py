"""Secret environment variables and archived suites (phase 17).

Revision ID: 0014_secrets_archive
"""
import sqlalchemy as sa

from alembic import op

revision = "0014_secrets_archive"
down_revision = "0013_saved_filters"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("test_environments") as batch:
        batch.add_column(sa.Column("secrets", sa.Text(), nullable=True))
    with op.batch_alter_table("analytics_suites") as batch:
        batch.add_column(sa.Column("archived_at", sa.DateTime(), nullable=True))
        batch.add_column(sa.Column("archived_by_id", sa.Integer(), nullable=True))
        batch.create_foreign_key("fk_analytics_suites_archived_by_id", "users", ["archived_by_id"], ["id"],
                                 ondelete="SET NULL")


def downgrade() -> None:
    with op.batch_alter_table("analytics_suites") as batch:
        batch.drop_constraint("fk_analytics_suites_archived_by_id", type_="foreignkey")
        batch.drop_column("archived_by_id")
        batch.drop_column("archived_at")
    with op.batch_alter_table("test_environments") as batch:
        batch.drop_column("secrets")
