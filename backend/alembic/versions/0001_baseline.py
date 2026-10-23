"""Baseline: the tables the app uses today, on SQLite and Postgres.

Creates them on a new database. On an existing database (which had no alembic_version table) it adopts the
schema: missing tables are created, missing columns are added as nullable, missing indexes are created.
Existing data is never changed.

Revision ID: 0001_baseline
"""
import sqlalchemy as sa

from alembic import op

revision = "0001_baseline"
down_revision = None
branch_labels = None
depends_on = None


def _define_tables(metadata: sa.MetaData) -> None:
    """The schema as of this revision (frozen: later model changes need their own revisions)."""
    sa.Table(
        'organizations',
        metadata,
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('slug', sa.String(), nullable=False),
        sa.Column('domain', sa.String(), nullable=True),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('access_token', sa.String(), nullable=False),
        sa.Column('subscription_plan', sa.Enum('FREE', 'SMALL_BUSINESS', 'ENTERPRISE', name='subscriptionplan'), nullable=False),
        sa.Column('max_users', sa.Integer(), nullable=True),
        sa.Column('max_chat_sessions', sa.Integer(), nullable=True),
        sa.Column('logo_url', sa.String(), nullable=True),
        sa.Column('primary_color', sa.String(), nullable=True),
        sa.Column('secondary_color', sa.String(), nullable=True),
        sa.Column('openai_api_key', sa.String(), nullable=True),
        sa.Column('anthropic_api_key', sa.String(), nullable=True),
        sa.Column('preferred_llm', sa.String(), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('domain')
    )
    sa.Table(
        'users',
        metadata,
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('username', sa.String(), nullable=False),
        sa.Column('email', sa.String(), nullable=False),
        sa.Column('hashed_password', sa.String(), nullable=False),
        sa.Column('full_name', sa.String(), nullable=True),
        sa.Column('role', sa.Enum('SUPER_ADMIN', 'ADMIN', 'ORG_ADMIN', 'COMMUNITY_LEAD', 'AUTOMATION_LEAD', 'AUTOMATION_USER', 'USER', 'VIEWER', name='userrole'), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=True),
        sa.Column('assigned_lead_id', sa.Integer(), nullable=True),
        sa.Column('organization_id', sa.Integer(), nullable=True),
        sa.Column('assigned_communities', sa.String(), nullable=True),
        sa.Column('preferred_communities', sa.String(), nullable=True),
        sa.Column('theme_preference', sa.String(), nullable=True),
        sa.Column('preferred_ai_model', sa.String(), nullable=True),
        sa.Column('ai_model_provider', sa.String(), nullable=True),
        sa.Column('ai_temperature', sa.String(), nullable=True),
        sa.Column('two_fa_enabled', sa.Boolean(), nullable=True),
        sa.Column('two_fa_secret', sa.String(), nullable=True),
        sa.Column('settings_json', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('last_login', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['assigned_lead_id'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    sa.Table(
        'api_tokens',
        metadata,
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('token', sa.String(), nullable=False),
        sa.Column('token_preview', sa.String(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('scopes', sa.String(), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=True),
        sa.Column('last_used', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('expires_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    sa.Table(
        'forum_posts',
        metadata,
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('organization_id', sa.Integer(), nullable=True),
        sa.Column('community_id', sa.String(length=50), nullable=False),
        sa.Column('author_id', sa.Integer(), nullable=True),
        sa.Column('title', sa.String(length=300), nullable=False),
        sa.Column('body', sa.Text(), nullable=False),
        sa.Column('tags', sa.JSON(), nullable=True),
        sa.Column('is_pinned', sa.Boolean(), nullable=False),
        sa.Column('is_locked', sa.Boolean(), nullable=False),
        sa.Column('is_deleted', sa.Boolean(), nullable=False),
        sa.Column('view_count', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['author_id'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    sa.Table(
        'login_history',
        metadata,
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('ip_address', sa.String(), nullable=True),
        sa.Column('user_agent', sa.String(), nullable=True),
        sa.Column('device_name', sa.String(), nullable=True),
        sa.Column('success', sa.Boolean(), nullable=True),
        sa.Column('failure_reason', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    sa.Table(
        'notification_preferences',
        metadata,
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('email_forum_posts', sa.Boolean(), nullable=True),
        sa.Column('email_comments', sa.Boolean(), nullable=True),
        sa.Column('email_mentions', sa.Boolean(), nullable=True),
        sa.Column('email_community_updates', sa.Boolean(), nullable=True),
        sa.Column('email_digest_frequency', sa.String(), nullable=True),
        sa.Column('in_app_forum_posts', sa.Boolean(), nullable=True),
        sa.Column('in_app_comments', sa.Boolean(), nullable=True),
        sa.Column('in_app_mentions', sa.Boolean(), nullable=True),
        sa.Column('in_app_system', sa.Boolean(), nullable=True),
        sa.Column('push_enabled', sa.Boolean(), nullable=True),
        sa.Column('quiet_hours_enabled', sa.Boolean(), nullable=True),
        sa.Column('quiet_hours_start', sa.String(), nullable=True),
        sa.Column('quiet_hours_end', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    sa.Table(
        'projects',
        metadata,
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('key', sa.String(length=20), nullable=False),
        sa.Column('name', sa.String(length=200), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('community_id', sa.String(length=50), nullable=False),
        sa.Column('organization_id', sa.Integer(), nullable=False),
        sa.Column('lead_user_id', sa.Integer(), nullable=True),
        sa.Column('icon', sa.String(length=100), nullable=True),
        sa.Column('color', sa.String(length=20), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=True),
        sa.Column('is_archived', sa.Boolean(), nullable=True),
        sa.Column('github_repo_url', sa.String(length=512), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.Column('created_by_user_id', sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(['created_by_user_id'], ['users.id'], ),
        sa.ForeignKeyConstraint(['lead_user_id'], ['users.id'], ),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    sa.Table(
        'tasks',
        metadata,
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('team_name', sa.String(length=255), nullable=False),
        sa.Column('title', sa.String(length=255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('status', sa.Enum('todo', 'in_progress', 'done', name='taskstatus'), nullable=False),
        sa.Column('assignee_id', sa.Integer(), nullable=True),
        sa.Column('created_by_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['assignee_id'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['created_by_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id')
    )
    sa.Table(
        'user_sessions',
        metadata,
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('session_token', sa.String(), nullable=False),
        sa.Column('device_name', sa.String(), nullable=True),
        sa.Column('device_type', sa.String(), nullable=True),
        sa.Column('browser', sa.String(), nullable=True),
        sa.Column('os', sa.String(), nullable=True),
        sa.Column('ip_address', sa.String(), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=True),
        sa.Column('last_activity', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('expires_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    sa.Table(
        'allure_reports',
        metadata,
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('project_id', sa.Integer(), nullable=False),
        sa.Column('source', sa.String(length=30), nullable=False),
        sa.Column('external_id', sa.String(length=255), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('branch', sa.String(length=255), nullable=True),
        sa.Column('workflow_name', sa.String(length=255), nullable=True),
        sa.Column('report_url', sa.String(length=1024), nullable=True),
        sa.Column('total_tests', sa.Integer(), nullable=False),
        sa.Column('passed_tests', sa.Integer(), nullable=False),
        sa.Column('failed_tests', sa.Integer(), nullable=False),
        sa.Column('broken_tests', sa.Integer(), nullable=False),
        sa.Column('skipped_tests', sa.Integer(), nullable=False),
        sa.Column('duration_ms', sa.Integer(), nullable=False),
        sa.Column('results_json', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('imported_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('project_id', 'source', 'external_id', name='uq_allure_report_source')
    )
    sa.Table(
        'analytics_suites',
        metadata,
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('project_id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('tags', sa.JSON(), nullable=False),
        sa.Column('cron_expression', sa.String(length=100), nullable=True),
        sa.Column('active', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    sa.Table(
        'forum_comments',
        metadata,
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('post_id', sa.Integer(), nullable=False),
        sa.Column('parent_comment_id', sa.Integer(), nullable=True),
        sa.Column('author_id', sa.Integer(), nullable=True),
        sa.Column('body', sa.Text(), nullable=False),
        sa.Column('is_deleted', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['author_id'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['parent_comment_id'], ['forum_comments.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['post_id'], ['forum_posts.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    sa.Table(
        'analytics_runs',
        metadata,
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('suite_id', sa.Integer(), nullable=False),
        sa.Column('status', sa.String(length=30), nullable=False),
        sa.Column('branch', sa.String(length=255), nullable=True),
        sa.Column('commit_sha', sa.String(length=40), nullable=True),
        sa.Column('triggered_by', sa.String(length=255), nullable=True),
        sa.Column('name', sa.String(length=255), nullable=True),
        sa.Column('collection', sa.String(length=255), nullable=True),
        sa.Column('collection_path', sa.String(length=512), nullable=True),
        sa.Column('environment', sa.String(length=255), nullable=True),
        sa.Column('started_at', sa.DateTime(), nullable=True),
        sa.Column('finished_at', sa.DateTime(), nullable=True),
        sa.Column('total_tests', sa.Integer(), nullable=False),
        sa.Column('passed_tests', sa.Integer(), nullable=False),
        sa.Column('failed_tests', sa.Integer(), nullable=False),
        sa.Column('skipped_tests', sa.Integer(), nullable=False),
        sa.Column('logs_json', sa.JSON(), nullable=False),
        sa.Column('results_json', sa.JSON(), nullable=False),
        sa.Column('details_json', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['suite_id'], ['analytics_suites.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    sa.Table(
        'forum_attachments',
        metadata,
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('post_id', sa.Integer(), nullable=True),
        sa.Column('comment_id', sa.Integer(), nullable=True),
        sa.Column('uploader_id', sa.Integer(), nullable=True),
        sa.Column('file_name', sa.String(), nullable=False),
        sa.Column('original_name', sa.String(), nullable=False),
        sa.Column('file_type', sa.String(), nullable=True),
        sa.Column('file_size', sa.Integer(), nullable=True),
        sa.Column('kind', sa.String(length=20), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['comment_id'], ['forum_comments.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['post_id'], ['forum_posts.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['uploader_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id')
    )
    sa.Table(
        'forum_reactions',
        metadata,
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('post_id', sa.Integer(), nullable=True),
        sa.Column('comment_id', sa.Integer(), nullable=True),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('reaction', sa.String(length=20), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['comment_id'], ['forum_comments.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['post_id'], ['forum_posts.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'post_id', 'comment_id', 'reaction', name='uq_forum_reaction')
    )


INDEXES = [
    ("ix_organizations_access_token", "organizations", ['access_token'], True),
    ("ix_organizations_id", "organizations", ['id'], False),
    ("ix_organizations_slug", "organizations", ['slug'], True),
    ("ix_users_email", "users", ['email'], True),
    ("ix_users_id", "users", ['id'], False),
    ("ix_users_username", "users", ['username'], False),
    ("ix_api_tokens_id", "api_tokens", ['id'], False),
    ("ix_api_tokens_token", "api_tokens", ['token'], True),
    ("ix_api_tokens_user_id", "api_tokens", ['user_id'], False),
    ("ix_forum_posts_author_id", "forum_posts", ['author_id'], False),
    ("ix_forum_posts_community_id", "forum_posts", ['community_id'], False),
    ("ix_forum_posts_id", "forum_posts", ['id'], False),
    ("ix_forum_posts_organization_id", "forum_posts", ['organization_id'], False),
    ("ix_login_history_created_at", "login_history", ['created_at'], False),
    ("ix_login_history_id", "login_history", ['id'], False),
    ("ix_login_history_user_id", "login_history", ['user_id'], False),
    ("ix_notification_preferences_id", "notification_preferences", ['id'], False),
    ("ix_notification_preferences_user_id", "notification_preferences", ['user_id'], True),
    ("ix_projects_community_id", "projects", ['community_id'], False),
    ("ix_projects_id", "projects", ['id'], False),
    ("ix_projects_key", "projects", ['key'], True),
    ("ix_projects_organization_id", "projects", ['organization_id'], False),
    ("ix_tasks_team_name", "tasks", ['team_name'], False),
    ("ix_user_sessions_created_at", "user_sessions", ['created_at'], False),
    ("ix_user_sessions_id", "user_sessions", ['id'], False),
    ("ix_user_sessions_session_token", "user_sessions", ['session_token'], True),
    ("ix_user_sessions_user_id", "user_sessions", ['user_id'], False),
    ("ix_allure_reports_id", "allure_reports", ['id'], False),
    ("ix_allure_reports_project_id", "allure_reports", ['project_id'], False),
    ("ix_analytics_suites_id", "analytics_suites", ['id'], False),
    ("ix_analytics_suites_project_id", "analytics_suites", ['project_id'], False),
    ("ix_forum_comments_author_id", "forum_comments", ['author_id'], False),
    ("ix_forum_comments_id", "forum_comments", ['id'], False),
    ("ix_forum_comments_parent_comment_id", "forum_comments", ['parent_comment_id'], False),
    ("ix_forum_comments_post_id", "forum_comments", ['post_id'], False),
    ("ix_analytics_runs_id", "analytics_runs", ['id'], False),
    ("ix_analytics_runs_suite_id", "analytics_runs", ['suite_id'], False),
    ("ix_forum_attachments_comment_id", "forum_attachments", ['comment_id'], False),
    ("ix_forum_attachments_id", "forum_attachments", ['id'], False),
    ("ix_forum_attachments_post_id", "forum_attachments", ['post_id'], False),
    ("ix_forum_reactions_comment_id", "forum_reactions", ['comment_id'], False),
    ("ix_forum_reactions_id", "forum_reactions", ['id'], False),
    ("ix_forum_reactions_post_id", "forum_reactions", ['post_id'], False),
    ("ix_forum_reactions_user_id", "forum_reactions", ['user_id'], False),
]


def _addable(column: sa.Column) -> sa.Column:
    """A copy of `column` that can be added to a table with rows: nullable, no primary key."""
    added = column._copy()
    added.nullable = True
    added.primary_key = False
    return added


def upgrade() -> None:
    bind = op.get_bind()
    metadata = sa.MetaData()
    _define_tables(metadata)
    existing = set(sa.inspect(bind).get_table_names())
    for table in metadata.sorted_tables:
        if table.name not in existing:
            table.create(bind)
            continue
        present = {column["name"] for column in sa.inspect(bind).get_columns(table.name)}
        for column in table.columns:
            if column.name not in present:
                op.add_column(table.name, _addable(column))

    inspector = sa.inspect(bind)
    for name, table_name, columns, unique in INDEXES:
        if name not in {index["name"] for index in inspector.get_indexes(table_name)}:
            op.create_index(name, table_name, columns, unique=unique)


def downgrade() -> None:
    raise NotImplementedError("The baseline cannot be downgraded.")
