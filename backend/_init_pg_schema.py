"""One-off script: create the full legacy core.database schema against Postgres
and seed the default organization + super admin user, so that both the legacy
sync API (main.py) and the async v1 API (app/main.py) can share the same DB.
"""
import os

os.environ.setdefault("DATABASE_URL_OVERRIDE", "1")

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import core.database as coredb

PG_URL = "postgresql://testmanager:testmanager@localhost:5432/testmanager"

# Re-point the module's engine/session at Postgres instead of SQLite.
coredb.engine = create_engine(PG_URL)
coredb.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=coredb.engine)

# Import office models so they register with Base.metadata (same as init_db does).
try:
    from models.office_models import (  # noqa: F401
        DeskBooking,
        OfficeDesk,
        OfficeSettings,
        ParkingBooking,
        ParkingSpace,
    )
except ImportError:
    pass

coredb.Base.metadata.create_all(bind=coredb.engine)
print("Tables created.")

db = coredb.SessionLocal()
try:
    default_org = db.query(coredb.Organization).filter(coredb.Organization.slug == "unifiedwork").first()
    if not default_org:
        default_org = coredb.Organization(
            name="UnifiedWork",
            slug="unifiedwork",
            description="Default organization for UnifiedWork platform",
            subscription_plan=coredb.SubscriptionPlan.ENTERPRISE,
            max_users=100,
            max_chat_sessions=50000,
            access_token=coredb.Organization.generate_access_token(),
            primary_color="#2563eb",
            secondary_color="#64748b",
        )
        db.add(default_org)
        db.commit()
        db.refresh(default_org)
        print("Default organization created.")

    admin = db.query(coredb.User).filter(coredb.User.email == "admin@unifiedwork.com").first()
    if not admin:
        admin = coredb.User(
            username="admin",
            email="admin@unifiedwork.com",
            hashed_password=coredb.User.hash_password("admin123"),
            full_name="UnifiedWork Administrator",
            role=coredb.UserRole.SUPER_ADMIN,
            organization_id=default_org.id,
            is_active=True,
        )
        db.add(admin)
        db.commit()
        print("Super admin created: admin@unifiedwork.com / admin123")
    else:
        print("Super admin already exists.")
finally:
    db.close()
