from fastapi.testclient import TestClient

from app.main import app

# These tests only check that the routes exist: without a migrated database the endpoints answer with an
# error status, so return server errors as responses instead of raising them.
client = TestClient(app, raise_server_exceptions=False)


def test_health_check():
    """Test health check endpoint."""
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_register_endpoint_exists():
    """Test that register endpoint exists."""
    response = client.post(
        "/api/v1/auth/register",
        json={
            "email": "test@example.com",
            "password": "password123",
            "full_name": "Test User"
        }
    )
    # Will fail with 500 due to no database, but endpoint should exist
    assert response.status_code in [400, 422, 500, 503]


def test_login_endpoint_exists():
    """Test that login endpoint exists."""
    response = client.post(
        "/api/v1/auth/login",
        data={
            "username": "test@example.com",
            "password": "password123"
        }
    )
    # Will fail with 500 due to no database, but endpoint should exist
    assert response.status_code in [400, 401, 422, 500, 503]


def test_projects_endpoint_exists():
    """Test that projects endpoints exist."""
    # GET without auth should fail
    response = client.get("/api/v1/projects")
    assert response.status_code in [401, 403, 500, 503]


def test_suites_endpoint_exists():
    """Test that test suites endpoints exist."""
    # GET without auth should fail  
    response = client.get("/api/v1/suites/test-id")
    assert response.status_code in [401, 403, 404, 500, 503]


def test_runs_endpoint_exists():
    """Test that test runs endpoints exist."""
    # GET without auth should fail
    response = client.get("/api/v1/runs/test-id")
    assert response.status_code in [401, 403, 404, 500, 503]
