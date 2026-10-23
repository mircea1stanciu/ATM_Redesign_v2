"""Identity logic: authentication, the default organization and the development admin."""
from typing import Optional

from sqlalchemy.orm import Session

from app.core.config import settings
from app.modules.identity.models import Organization, SubscriptionPlan, User, UserRole

DEFAULT_ORGANIZATION_SLUG = "unifiedwork"


def authenticate_user(db: Session, username: str, password: str) -> Optional[User]:
    """The active user with this username or email and password, or None."""
    user = db.query(User).filter((User.username == username) | (User.email == username)).first()
    if not user or not user.verify_password(password) or not user.is_active:
        return None
    return user


def get_default_organization(db: Session) -> Organization:
    """Return the install's single organization, creating it on first start."""
    org = db.query(Organization).filter(Organization.slug == DEFAULT_ORGANIZATION_SLUG).first()
    if not org:
        org = Organization(
            name="ATM",
            slug=DEFAULT_ORGANIZATION_SLUG,
            subscription_plan=SubscriptionPlan.ENTERPRISE,
            access_token=Organization.generate_access_token(),
        )
        db.add(org)
        db.commit()
        db.refresh(org)
    return org


def seed_dev_admin(db: Session) -> None:
    """Create the first super admin from ATM_DEV_ADMIN_PASSWORD (development only; no fixed passwords)."""
    if db.query(User).filter(User.role == UserRole.SUPER_ADMIN).first():
        return
    password = settings.ATM_DEV_ADMIN_PASSWORD
    if not password:
        print("ℹ️  No super admin yet. Set ATM_DEV_ADMIN_PASSWORD in backend/.env to create 'admin' on next start.")
        return
    db.add(
        User(
            username="admin",
            email="admin@atm.local",
            hashed_password=User.hash_password(password),
            full_name="ATM Administrator",
            role=UserRole.SUPER_ADMIN,
            organization_id=get_default_organization(db).id,
            is_active=True,
        )
    )
    db.commit()
    print("✅ Super admin 'admin' created from ATM_DEV_ADMIN_PASSWORD")
