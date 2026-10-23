"""update_user_roles

Revision ID: a1b2c3d4e5f6
Revises: 74b782f75dea
Create Date: 2026-05-02 00:00:00.000000

"""
from collections.abc import Sequence
from typing import Union

from alembic import op

revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = '74b782f75dea'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Step 1: Add new enum values (must be committed before use in PostgreSQL)
    op.execute("ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'automation_lead'")
    op.execute("ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'automation_user'")
    # Commit so new enum values are visible in the same session
    op.execute("COMMIT")
    # Step 2: Migrate old 'developer' rows to 'automation_user'
    op.execute("UPDATE users SET role = 'automation_user' WHERE role = 'developer'")


def downgrade() -> None:
    # Revert automation_user/lead back to developer
    op.execute("UPDATE users SET role = 'developer' WHERE role IN ('automation_user', 'automation_lead')")
    # Note: PostgreSQL does not support removing enum values without recreating the type.
    # A full downgrade would require recreating the enum; skipping for brevity.
