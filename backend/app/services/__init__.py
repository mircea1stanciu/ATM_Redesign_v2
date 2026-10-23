from typing import Optional

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_password_hash
from app.schemas.auth import UserCreate
from core.database import User
from core.database import UserRole as CoreUserRole


def _normalize_role(role: str) -> CoreUserRole:
    role_aliases = {
        "super_admin": CoreUserRole.SUPER_ADMIN,
        "admin": CoreUserRole.ADMIN,
        "org_admin": CoreUserRole.ORG_ADMIN,
        "community_lead": CoreUserRole.COMMUNITY_LEAD,
        "automation_lead": CoreUserRole.AUTOMATION_LEAD,
        "automation_user": CoreUserRole.AUTOMATION_USER,
        "developer": CoreUserRole.AUTOMATION_USER,
        "viewer": CoreUserRole.VIEWER,
        "user": CoreUserRole.USER,
    }

    normalized_role = role_aliases.get(role.lower())
    if normalized_role is None:
        raise ValueError(f"Unsupported role: {role}")
    return normalized_role


class AuthService:
    @staticmethod
    async def register_user(db: AsyncSession, user_data: UserCreate) -> User:
        """Register a new user."""
        # Check if user already exists - use exists() to avoid loading all columns
        stmt = select(User.email).where(User.email == user_data.email).limit(1)
        result = await db.execute(stmt)
        if result.scalars().first():
            raise ValueError(f"User with email {user_data.email} already exists")
        
        # Create new user with automation_user role (default registration role)
        user = User(
            email=user_data.email,
            hashed_password=get_password_hash(user_data.password),
            full_name=user_data.full_name,
            username=user_data.email.split('@')[0],
            role=CoreUserRole.USER,
            is_active=True,
        )
        db.add(user)
        try:
            await db.commit()
            await db.refresh(user)
            return user
        except IntegrityError as e:
            await db.rollback()
            if "email" in str(e).lower():
                raise ValueError(f"User with email {user_data.email} already exists")
            raise ValueError(f"Database error: {str(e)}")

    @staticmethod
    async def create_user(
        db: AsyncSession,
        email: str,
        password: str,
        full_name: str,
        role: str,
        assigned_lead_id: Optional[str] = None,
        is_active: bool = True,
    ) -> User:
        """Create a new user with specified role (admin only)."""
        # Check if user already exists - use exists() to avoid loading all columns
        stmt = select(User.email).where(User.email == email).limit(1)
        result = await db.execute(stmt)
        if result.scalars().first():
            raise ValueError(f"User with email {email} already exists")
        
        user_role = _normalize_role(role)
        
        # Create new user
        user = User(
            email=email,
            hashed_password=get_password_hash(password),
            full_name=full_name,
            username=email.split('@')[0],
            role=user_role,
            is_active=is_active,
            assigned_lead_id=int(assigned_lead_id) if assigned_lead_id else None,
        )
        db.add(user)
        try:
            await db.commit()
            await db.refresh(user)
            return user
        except IntegrityError as e:
            await db.rollback()
            if "email" in str(e).lower() or "unique" in str(e).lower():
                raise ValueError(f"User with email {email} already exists")
            raise ValueError(f"Database error: {str(e)}")

    @staticmethod
    async def authenticate_user(db: AsyncSession, email: str, password: str) -> Optional[User]:
        """Authenticate user and return user object if valid credentials."""
        stmt = select(User).where(User.email == email)
        result = await db.execute(stmt)
        user = result.scalars().first()
        
        if not user:
            return None
        
        # Use the User model's verify_password method
        if not user.verify_password(password):
            return None
        
        if not user.is_active:
            return None
        
        return user

    @staticmethod
    async def get_user_by_id(db: AsyncSession, user_id: str) -> Optional[User]:
        """Get user by ID."""
        stmt = select(User).where(User.id == int(user_id))
        result = await db.execute(stmt)
        return result.scalars().first()

    @staticmethod
    async def get_user_by_email(db: AsyncSession, email: str) -> Optional[bool]:
        """Check if user exists by email."""
        stmt = select(User.email).where(User.email == email).limit(1)
        result = await db.execute(stmt)
        return result.scalars().first() is not None

    @staticmethod
    async def list_users(db: AsyncSession) -> list[User]:
        """List all users (admin only)."""
        stmt = select(User).order_by(User.created_at)
        result = await db.execute(stmt)
        return list(result.scalars().all())

    @staticmethod
    async def update_user(
        db: AsyncSession,
        user_id: str,
        email: Optional[str] = None,
        full_name: Optional[str] = None,
        role: Optional[str] = None,
        assigned_lead_id: Optional[str] = None,
        is_active: Optional[bool] = None,
        password: Optional[str] = None,
    ) -> User:
        """Update a user's profile / role (admin only)."""
        stmt = select(User).where(User.id == int(user_id))
        result = await db.execute(stmt)
        user = result.scalars().first()
        if not user:
            raise ValueError("User not found")
        if email is not None:
            user.email = email
        if full_name is not None:
            user.full_name = full_name
        if role is not None:
            user.role = _normalize_role(role)
            if user.role not in {CoreUserRole.AUTOMATION_USER, CoreUserRole.USER, CoreUserRole.VIEWER}:
                user.assigned_lead_id = None
        if assigned_lead_id is not None:
            user.assigned_lead_id = int(assigned_lead_id) if assigned_lead_id else None
        if is_active is not None:
            user.is_active = is_active
        if password is not None:
            from app.core.security import get_password_hash
            user.hashed_password = get_password_hash(password)
        try:
            await db.commit()
            await db.refresh(user)
        except IntegrityError as e:
            await db.rollback()
            if "email" in str(e).lower():
                raise ValueError("Email already exists")
            raise ValueError(f"Database error: {str(e)}")
        return user

    @staticmethod
    async def delete_user(db: AsyncSession, user_id: str) -> bool:
        """Delete a user by id."""
        stmt = select(User).where(User.id == int(user_id))
        result = await db.execute(stmt)
        user = result.scalars().first()
        if not user:
            return False

        await db.delete(user)
        await db.commit()
        return True
