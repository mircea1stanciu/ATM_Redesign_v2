"""Phase 15: project-based users and viewers start without projects; leads assign them.

The phase 04 upgrade made every migrated project-based user and viewer a member of every project, so nobody lost
access. This removes exactly those memberships: no ``added_by_user_id`` and added at the moment recorded in
``role_migration_log``. Memberships a lead or super admin gave (they carry ``added_by_user_id``) stay.

Revision ID: 0012_no_automatic_memberships
"""
import sqlalchemy as sa

from alembic import op

revision = "0012_no_automatic_memberships"
down_revision = "0011_readiness_audit"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.get_bind().execute(sa.text(
        "DELETE FROM project_members WHERE added_by_user_id IS NULL "
        "AND added_at IN (SELECT migrated_at FROM role_migration_log)"))


def downgrade() -> None:
    # The removed memberships cannot be told apart from never-given ones; leads assign projects again.
    pass
