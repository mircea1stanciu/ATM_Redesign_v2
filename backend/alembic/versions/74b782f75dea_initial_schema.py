"""initial_schema

Revision ID: 74b782f75dea
Revises: 
Create Date: 2026-05-01 00:00:00.000000

"""
from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '74b782f75dea'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # users
    op.create_table(
        'users',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('email', sa.String(255), nullable=False),
        sa.Column('hashed_password', sa.String(255), nullable=False),
        sa.Column('full_name', sa.String(255), nullable=True),
        sa.Column('role', sa.Enum('admin', 'developer', 'viewer', name='userrole'), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_users_email', 'users', ['email'], unique=True)

    # projects
    op.create_table(
        'projects',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('git_repo_url', sa.String(512), nullable=False),
        sa.Column('git_provider', sa.Enum('github', 'gitlab', 'bitbucket', name='gitprovider'), nullable=True),
        sa.Column('default_branch', sa.String(255), nullable=True),
        sa.Column('framework', sa.String(100), nullable=True),
        sa.Column('config_json', postgresql.JSON(astext_type=sa.Text()), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )

    # test_suites
    op.create_table(
        'test_suites',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('project_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('tags', postgresql.JSON(astext_type=sa.Text()), nullable=True),
        sa.Column('cron_expression', sa.String(100), nullable=True),
        sa.Column('active', sa.Boolean(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )

    # test_runs
    op.create_table(
        'test_runs',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('suite_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('status', sa.Enum('pending', 'running', 'passed', 'failed', 'error', 'cancelled',
                                    name='runstatus'), nullable=False),
        sa.Column('branch', sa.String(255), nullable=True),
        sa.Column('commit_sha', sa.String(40), nullable=True),
        sa.Column('triggered_by', sa.String(255), nullable=True),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('total_tests', sa.Integer(), nullable=True),
        sa.Column('passed_tests', sa.Integer(), nullable=True),
        sa.Column('failed_tests', sa.Integer(), nullable=True),
        sa.Column('skipped_tests', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['suite_id'], ['test_suites.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )

    # test_results
    op.create_table(
        'test_results',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('run_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('test_name', sa.String(512), nullable=False),
        sa.Column('class_name', sa.String(512), nullable=True),
        sa.Column('status', sa.Enum('passed', 'failed', 'skipped', 'error', name='teststatus'),
                  nullable=False),
        sa.Column('duration_ms', sa.Float(), nullable=True),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('stack_trace', sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(['run_id'], ['test_runs.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )

    # artifacts
    op.create_table(
        'artifacts',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('run_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('file_path', sa.String(1024), nullable=False),
        sa.Column('file_type', sa.String(50), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['run_id'], ['test_runs.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )


def downgrade() -> None:
    op.drop_table('artifacts')
    op.drop_table('test_results')
    op.drop_table('test_runs')
    op.drop_table('test_suites')
    op.drop_table('projects')
    op.drop_index('ix_users_email', table_name='users')
    op.drop_table('users')

    op.execute("DROP TYPE IF EXISTS teststatus")
    op.execute("DROP TYPE IF EXISTS runstatus")
    op.execute("DROP TYPE IF EXISTS userrole")
    op.execute("DROP TYPE IF EXISTS gitprovider")
