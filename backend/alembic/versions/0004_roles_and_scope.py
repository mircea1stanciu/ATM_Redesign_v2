"""The six roles, scope tags and project membership (docs/redesign/04-roles-and-permissions.md, section 4.5).

- users.role becomes a plain string column with the new roles; every user is mapped and logged in
  role_migration_log (old role, new role, tag).
- users.scope_tag: project_base or shared for seniors, users and trainees.
- project_members: so that nobody loses access, every migrated project_base user and every viewer becomes a member of
  all existing projects (today everyone sees every project). Leads narrow this down afterwards.
- branch_owners (trainees push only their own branches) and analytics_suites.created_by_user_id (users manage only
  their own suites).

Revision ID: 0004_roles_and_scope
"""
from datetime import datetime

import sqlalchemy as sa

from alembic import op

revision = "0004_roles_and_scope"
down_revision = "0003_user_connections"
branch_labels = None
depends_on = None

# Old role (member name as stored) -> (new role, scope tag)
ROLE_MAP = {
    "SUPER_ADMIN": ("SUPER_ADMIN", None),
    "ADMIN": ("AUTOMATION_LEAD", None),
    "ORG_ADMIN": ("AUTOMATION_LEAD", None),
    "AUTOMATION_LEAD": ("AUTOMATION_LEAD", None),
    "COMMUNITY_LEAD": ("AUTOMATION_SENIOR", "shared"),
    "AUTOMATION_USER": ("AUTOMATION_USER", "project_base"),
    "USER": ("AUTOMATION_USER", "project_base"),
    "DEVELOPER": ("AUTOMATION_USER", "project_base"),
    "VIEWER": ("VIEWER", None),
}

users = sa.table("users", sa.column("id", sa.Integer), sa.column("role", sa.String), sa.column("scope_tag", sa.String))
projects = sa.table("projects", sa.column("id", sa.Integer))
log = sa.table(
    "role_migration_log",
    sa.column("user_id", sa.Integer), sa.column("old_role", sa.String), sa.column("new_role", sa.String),
    sa.column("scope_tag", sa.String), sa.column("migrated_at", sa.DateTime),
)
members = sa.table(
    "project_members",
    sa.column("project_id", sa.Integer), sa.column("user_id", sa.Integer), sa.column("added_at", sa.DateTime),
)


def upgrade() -> None:
    bind = op.get_bind()
    is_postgres = bind.dialect.name == "postgresql"
    with op.batch_alter_table("users") as batch:
        batch.alter_column(
            "role", type_=sa.String(32), existing_nullable=False, postgresql_using="role::text",
        )
        batch.add_column(sa.Column("scope_tag", sa.String(16), nullable=True))
    if is_postgres:
        op.execute("DROP TYPE IF EXISTS userrole")

    op.create_table(
        "role_migration_log",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("old_role", sa.String(32), nullable=False),
        sa.Column("new_role", sa.String(32), nullable=False),
        sa.Column("scope_tag", sa.String(16), nullable=True),
        sa.Column("migrated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_role_migration_log_user_id", "role_migration_log", ["user_id"])
    op.create_table(
        "project_members",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("added_by_user_id", sa.Integer(), nullable=True),
        sa.Column("added_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["added_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("project_id", "user_id", name="uq_project_member"),
    )
    op.create_index("ix_project_members_project_id", "project_members", ["project_id"])
    op.create_index("ix_project_members_user_id", "project_members", ["user_id"])
    op.create_table(
        "branch_owners",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("branch", sa.String(255), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("project_id", "branch", name="uq_branch_owner"),
    )
    op.create_index("ix_branch_owners_project_id", "branch_owners", ["project_id"])
    with op.batch_alter_table("analytics_suites") as batch:
        batch.add_column(sa.Column("created_by_user_id", sa.Integer(), nullable=True))
        batch.create_foreign_key(
            "fk_analytics_suites_created_by_user_id", "users", ["created_by_user_id"], ["id"], ondelete="SET NULL",
        )

    now = datetime.utcnow()
    project_ids = [pid for (pid,) in bind.execute(sa.select(projects.c.id))]
    for user_id, old_role in bind.execute(sa.select(users.c.id, users.c.role)).all():
        new_role, tag = ROLE_MAP.get(str(old_role or "").upper(), ("VIEWER", None))
        bind.execute(users.update().where(users.c.id == user_id).values(role=new_role, scope_tag=tag))
        bind.execute(log.insert().values(user_id=user_id, old_role=str(old_role), new_role=new_role,
                                         scope_tag=tag, migrated_at=now))
        if (tag == "project_base" or new_role == "VIEWER") and project_ids:
            bind.execute(members.insert(), [{"project_id": pid, "user_id": user_id, "added_at": now}
                                            for pid in project_ids])


def downgrade() -> None:
    bind = op.get_bind()
    for user_id, old_role in bind.execute(sa.select(log.c.user_id, log.c.old_role)).all():
        bind.execute(users.update().where(users.c.id == user_id).values(role=old_role))
    with op.batch_alter_table("analytics_suites") as batch:
        batch.drop_constraint("fk_analytics_suites_created_by_user_id", type_="foreignkey")
        batch.drop_column("created_by_user_id")
    op.drop_table("branch_owners")
    op.drop_table("project_members")
    op.drop_table("role_migration_log")
    with op.batch_alter_table("users") as batch:
        batch.drop_column("scope_tag")
