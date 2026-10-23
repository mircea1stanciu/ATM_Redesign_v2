"""add_assigned_lead_to_users

Revision ID: c3d4e5f6a7b8
Revises: a1b2c3d4e5f6
Create Date: 2026-05-03 00:00:00.000000

"""
from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = 'c3d4e5f6a7b8'
down_revision: Union[str, None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('assigned_lead_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        'fk_users_assigned_lead_id_users',
        'users',
        'users',
        ['assigned_lead_id'],
        ['id'],
        ondelete='SET NULL',
    )


def downgrade() -> None:
    op.drop_constraint('fk_users_assigned_lead_id_users', 'users', type_='foreignkey')
    op.drop_column('users', 'assigned_lead_id')
