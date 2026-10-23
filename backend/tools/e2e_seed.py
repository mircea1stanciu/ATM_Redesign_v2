"""Seed a throwaway database for the UI tests (frontend/e2e).

Creates one user per role and a sample project. Writes the users' names and access tokens to a JSON file, so the
tests can open authenticated pages without going through the rate-limited login endpoint.

Usage (from backend/):
    ATM_DATABASE_PATH=/tmp/e2e.db E2E_PASSWORD=... python -m tools.e2e_seed <sessions.json>
"""
import json
import os
import sys

if not os.getenv("ATM_DATABASE_PATH"):
    sys.exit("ATM_DATABASE_PATH must point to a throwaway database; refusing to seed the real one.")

from app.core.db import SessionLocal  # noqa: E402
from app.core.security import create_access_token  # noqa: E402
from app.main import _init_db  # noqa: E402
from app.modules.identity.models import User, UserRole  # noqa: E402
from app.modules.identity.service import get_default_organization  # noqa: E402
from app.modules.projects.models import Project  # noqa: E402

SAMPLE_PROJECT_KEY = "E2E"


def seed(sessions_path: str) -> None:
    password = os.environ["E2E_PASSWORD"]
    _init_db()
    db = SessionLocal()
    try:
        org = get_default_organization(db)
        sessions = {}
        for role in UserRole:
            username = f"e2e_{role.value}"
            user = db.query(User).filter(User.username == username).first()
            if not user:
                user = User(
                    username=username,
                    email=f"{username}@e2e.test",
                    hashed_password=User.hash_password(password),
                    full_name=f"E2E {role.value.replace('_', ' ').title()}",
                    role=role,
                    organization_id=org.id,
                    is_active=True,
                )
                db.add(user)
                db.commit()
                db.refresh(user)
            token = create_access_token(
                data={
                    "user_id": user.id,
                    "username": user.username,
                    "role": user.role.value,
                    "organization_id": user.organization_id,
                }
            )
            sessions[role.value] = {"username": username, "token": token}

        if not db.query(Project).filter(Project.key == SAMPLE_PROJECT_KEY).first():
            db.add(
                Project(
                    key=SAMPLE_PROJECT_KEY,
                    name="E2E Sample Project",
                    description="Seeded for the UI tests",
                    community_id="qa",
                    organization_id=org.id,
                )
            )
            db.commit()
    finally:
        db.close()

    with open(sessions_path, "w") as handle:
        json.dump(sessions, handle, indent=2)


if __name__ == "__main__":
    seed(sys.argv[1])
