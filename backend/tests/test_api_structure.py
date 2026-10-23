import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture(scope="module")
def client():
    # The context manager runs the startup event, which prepares the (throwaway) database.
    with TestClient(app) as test_client:
        yield test_client


def test_health_check(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "healthy"


def test_register_then_sign_in(client):
    registered = client.post(
        "/api/auth/register",
        json={"username": "tester", "email": "tester@example.com", "password": "pw-123456", "full_name": "T"},
    )
    assert registered.status_code == 200
    token = registered.json()["access_token"]

    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    # Self-registered users join the install's default organization.
    assert me.json()["organization"]["slug"] == "unifiedwork"

    signed_in = client.post("/api/auth/login", json={"username": "tester", "password": "pw-123456"})
    assert signed_in.status_code == 200
    assert signed_in.json()["user"]["email"] == "tester@example.com"


def test_wrong_password_is_rejected(client):
    response = client.post("/api/auth/login", json={"username": "nobody", "password": "wrong"})
    assert response.status_code == 401


@pytest.mark.parametrize(
    "path",
    ["/api/projects/", "/api/runs/projects/1", "/api/settings/jira", "/api/settings/confluence", "/api/devices"],
)
def test_module_routes_require_sign_in(client, path):
    client.cookies.clear()  # login sets an access_token cookie, which also authenticates
    assert client.get(path).status_code == 401


def test_unknown_api_path_is_404(client):
    assert client.get("/api/no-such-route").status_code == 404
