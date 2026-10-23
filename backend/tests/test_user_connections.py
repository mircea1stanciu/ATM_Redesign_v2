import json

import pytest
import sqlalchemy as sa
from fastapi.testclient import TestClient

from alembic import command
from app.core.crypto import decrypt
from app.core.migrations import _alembic_config
from app.main import app

SECRET_SETTINGS = {
    "jira_token": "jira-secret-1234",
    "github_token": "ghp_secret5678",
    "project_github_tokens": {"7": "ghp_project7"},
    "ai_assistant": {"provider": "anthropic", "api_key": "sk-ant-secret", "model": "claude"},
    "jira_mcp_base_url": "https://jira.example.com",
}


def _migrate(engine, target):
    """Upgrade to `target`, or downgrade for a relative target such as "-1"."""
    config = _alembic_config()
    with engine.begin() as connection:
        config.attributes["connection"] = connection
        (command.downgrade if target.startswith("-") else command.upgrade)(config, target)


def test_migration_moves_tokens_out_of_settings_and_encrypts_them(tmp_path):
    engine = sa.create_engine(f"sqlite:///{tmp_path / 'db.sqlite'}")
    _migrate(engine, "0002_drop_removed_features")
    with engine.begin() as connection:
        connection.execute(sa.text(
            "insert into users (id, username, email, hashed_password, role, settings_json)"
            " values (1, 'ana', 'ana@example.com', 'x', 'VIEWER', :settings)"
        ), {"settings": json.dumps(SECRET_SETTINGS)})

    _migrate(engine, "head")

    with engine.connect() as connection:
        settings = json.loads(connection.execute(sa.text("select settings_json from users")).scalar())
        rows = connection.execute(sa.text("select kind, ref, secret from user_connections order by kind")).all()
    assert settings == {"jira_mcp_base_url": "https://jira.example.com"}
    secrets = {(kind, ref): secret for kind, ref, secret in rows}
    assert set(secrets) == {("ai_assistant", ""), ("github", ""), ("github_project", "7"), ("jira", "")}
    assert all("secret" not in value and "ghp_" not in value for value in secrets.values())
    assert decrypt(secrets[("jira", "")]) == "jira-secret-1234"
    assert json.loads(decrypt(secrets[("ai_assistant", "")]))["api_key"] == "sk-ant-secret"

    _migrate(engine, "-1")
    with engine.connect() as connection:
        restored = json.loads(connection.execute(sa.text("select settings_json from users")).scalar())
    assert restored == SECRET_SETTINGS


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client


def test_saved_token_is_encrypted_and_never_returned(client):
    signup = client.post("/api/auth/register", json={
        "username": "conn", "email": "conn@example.com", "password": "pw-123456", "full_name": "C",
    })
    headers = {"Authorization": f"Bearer {signup.json()['access_token']}"}

    saved = client.patch("/api/settings/confluence", headers=headers, json={"confluence_token": "conf-token-9876"})
    assert saved.status_code == 200
    assert saved.json()["confluence_token_preview"] == "•••• 9876"
    assert "conf-token-9876" not in saved.text
    assert "conf-token-9876" not in client.get("/api/settings/confluence", headers=headers).text

    from app.core.db import SessionLocal
    from app.modules.identity.models import User

    with SessionLocal() as db:
        user = db.query(User).filter(User.username == "conn").one()
        assert "confluence_token" not in (user.settings_json or {})
        [connection] = user.connections
        assert connection.kind == "confluence"
        assert decrypt(connection.secret) == "conf-token-9876"
