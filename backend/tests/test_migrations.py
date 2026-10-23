import sqlalchemy as sa
from alembic.script import ScriptDirectory

from alembic import command
from app.core.migrations import _alembic_config


def _upgrade(engine):
    config = _alembic_config()
    with engine.begin() as connection:
        config.attributes["connection"] = connection
        command.upgrade(config, "head")


def test_fresh_database_gets_every_table(tmp_path):
    engine = sa.create_engine(f"sqlite:///{tmp_path / 'fresh.db'}")
    _upgrade(engine)
    tables = set(sa.inspect(engine).get_table_names())
    assert {"users", "organizations", "projects", "analytics_runs", "tasks", "forum_posts"} <= tables
    with engine.connect() as connection:
        head = ScriptDirectory.from_config(_alembic_config()).get_current_head()
        assert connection.execute(sa.text("select version_num from alembic_version")).scalar() == head


def test_existing_database_is_adopted_without_losing_rows(tmp_path):
    engine = sa.create_engine(f"sqlite:///{tmp_path / 'legacy.db'}")
    with engine.begin() as connection:
        # An older users table (no settings_json / 2FA columns), a removed feature's table and an unrelated table.
        connection.execute(sa.text(
            "create table users (id integer primary key, username varchar not null, email varchar not null,"
            " hashed_password varchar not null, role varchar not null)"
        ))
        connection.execute(sa.text("insert into users values (1, 'ana', 'ana@example.com', 'x', 'VIEWER')"))
        connection.execute(sa.text("create table office_desks (id integer primary key)"))
        connection.execute(sa.text("create table something_else (id integer primary key)"))

    _upgrade(engine)

    inspector = sa.inspect(engine)
    assert "office_desks" not in inspector.get_table_names()
    assert "something_else" in inspector.get_table_names()
    assert {"settings_json", "two_fa_enabled", "organization_id"} <= {c["name"] for c in inspector.get_columns("users")}
    with engine.connect() as connection:
        assert connection.execute(sa.text("select username from users")).scalars().all() == ["ana"]
