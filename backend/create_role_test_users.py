#!/usr/bin/env python3
"""
Script to create test users for each role.
Creates 2 users for each of the 8 core roles:
- super_admin
- admin
- org_admin
- community_lead
- automation_lead
- automation_user
- user
- viewer
"""

import sys
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent))

from sqlalchemy import select

from core.database import SessionLocal, User, UserRole


def create_test_users() -> None:
    """Create 2 test users for each role."""
    users_to_create = [
        ("superadmin1@test.com", "parola123", "Super Admin 1", UserRole.SUPER_ADMIN),
        ("superadmin2@test.com", "parola123", "Super Admin 2", UserRole.SUPER_ADMIN),
        ("admin1@test.com", "parola123", "Admin 1", UserRole.ADMIN),
        ("admin2@test.com", "parola123", "Admin 2", UserRole.ADMIN),
        ("orgadmin1@test.com", "parola123", "Org Admin 1", UserRole.ORG_ADMIN),
        ("orgadmin2@test.com", "parola123", "Org Admin 2", UserRole.ORG_ADMIN),
        ("lead1@test.com", "parola123", "Community Lead 1", UserRole.COMMUNITY_LEAD),
        ("lead2@test.com", "parola123", "Community Lead 2", UserRole.COMMUNITY_LEAD),
        ("autolead1@test.com", "parola123", "Automation Lead 1", UserRole.AUTOMATION_LEAD),
        ("autolead2@test.com", "parola123", "Automation Lead 2", UserRole.AUTOMATION_LEAD),
        ("autouser1@test.com", "parola123", "Automation User 1", UserRole.AUTOMATION_USER),
        ("autouser2@test.com", "parola123", "Automation User 2", UserRole.AUTOMATION_USER),
        ("user1@test.com", "parola123", "Test User 1", UserRole.USER),
        ("user2@test.com", "parola123", "Test User 2", UserRole.USER),
        ("viewer1@test.com", "parola123", "Viewer 1", UserRole.VIEWER),
        ("viewer2@test.com", "parola123", "Viewer 2", UserRole.VIEWER),
    ]

    with SessionLocal() as session:
        print("🔍 Checking for existing users...")

        for email, password, full_name, role in users_to_create:
            result = session.execute(select(User).where(User.email == email))
            existing_user = result.scalar_one_or_none()

            if existing_user:
                print(f"   ⏭️  Skipping {email} (already exists)")
                continue

            user = User(
                username=email.split('@')[0],
                email=email,
                hashed_password=User.hash_password(password),
                full_name=full_name,
                role=role,
                is_active=True,
            )

            session.add(user)
            print(f"   ✓ Created {email} ({role.value})")

        try:
            session.commit()
            print("\n✅ Successfully created test users!")
        except Exception as exc:
            session.rollback()
            print(f"\n❌ Error creating users: {exc}")
            raise


def main() -> None:
    print("=" * 60)
    print("Creating test users for each role...")
    print("=" * 60)
    print()

    create_test_users()

    print()
    print("📋 Test user credentials:")
    print("-" * 60)
    print("All test users have password: parola123")
    print()
    print("Super Admin:       superadmin1@test.com, superadmin2@test.com")
    print("Admin:             admin1@test.com, admin2@test.com")
    print("Org Admin:         orgadmin1@test.com, orgadmin2@test.com")
    print("Community Lead:    lead1@test.com, lead2@test.com")
    print("Automation Lead:   autolead1@test.com, autolead2@test.com")
    print("Automation User:   autouser1@test.com, autouser2@test.com")
    print("User:              user1@test.com, user2@test.com")
    print("Viewer:            viewer1@test.com, viewer2@test.com")
    print("-" * 60)


if __name__ == "__main__":
    main()
