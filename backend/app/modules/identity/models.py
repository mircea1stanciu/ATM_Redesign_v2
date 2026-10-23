"""Users, the default organization and per-user security records."""
import enum
import secrets
from datetime import datetime
from typing import Optional

from sqlalchemy import JSON, Boolean, Column, DateTime, Enum, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.core.security import pwd_context


def simple_hash_password(password: str) -> str:
    """Simple password hashing as fallback"""
    import hashlib
    return hashlib.sha256(password.encode()).hexdigest()

def simple_verify_password(password: str, hashed: str) -> bool:
    """Simple password verification as fallback"""
    import hashlib
    return hashlib.sha256(password.encode()).hexdigest() == hashed


class UserRole(enum.Enum):
    """The six roles (docs/redesign/04-roles-and-permissions.md); permissions are in app.core.permissions."""
    SUPER_ADMIN = "super_admin"  # configures the install and can do everything
    AUTOMATION_LEAD = "automation_lead"  # manages people and projects, decides promotions
    AUTOMATION_SENIOR = "automation_senior"  # implements and runs tests, reviews PRs, mentors
    AUTOMATION_USER = "automation_user"  # implements and runs tests, opens PRs
    AUTOMATION_TRAINEE = "automation_trainee"  # learns; pushes only their own branches
    VIEWER = "viewer"  # reads results; changes nothing


class SubscriptionPlan(enum.Enum):
    """Maps the legacy organizations.subscription_plan column; removed with that table in phase 03."""
    FREE = "free"                    # 10 users, 1,000 chats/month - Trial/Testing
    SMALL_BUSINESS = "small_business"  # 20 users, 5,000 chats/month - Small Teams
    ENTERPRISE = "enterprise"          # 100+ users, 50,000+ chats/month - Large Organizations


class Organization(Base):
    """The install's single default organization (multi-organization tenancy was removed).

    Users and projects still reference it through organization_id; the table goes away in phase 03.
    """
    __tablename__ = "organizations"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    slug = Column(String, unique=True, index=True, nullable=False)
    domain = Column(String, unique=True, nullable=True)
    description = Column(Text, nullable=True)
    
    # Access token for organization registration
    access_token = Column(String, unique=True, index=True, nullable=False)
    
    # Subscription and limits
    subscription_plan = Column(Enum(SubscriptionPlan), default=SubscriptionPlan.FREE, nullable=False)
    max_users = Column(Integer, default=10)
    max_chat_sessions = Column(Integer, default=1000)
    
    # Branding
    logo_url = Column(String, nullable=True)
    primary_color = Column(String, default="#2563eb")
    secondary_color = Column(String, default="#64748b")
    
    # API Configuration per organization
    openai_api_key = Column(String, nullable=True)
    anthropic_api_key = Column(String, nullable=True)
    preferred_llm = Column(String, default="openai")
    
    # Status
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    users = relationship("User", back_populates="organization")

    @staticmethod
    def generate_access_token() -> str:
        """Generate secure access token"""
        return secrets.token_urlsafe(32)


class User(Base):
    """User account"""
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    username: Mapped[str] = mapped_column(String, index=True, nullable=False)
    email: Mapped[str] = mapped_column(String, unique=True, index=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String, nullable=False)
    full_name: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    # Stored as the member name in a plain string column (not a database enum type), so roles can change.
    role: Mapped[UserRole] = mapped_column(
        Enum(UserRole, native_enum=False, length=32), default=UserRole.VIEWER, nullable=False
    )
    # project_base | shared for seniors, users and trainees; empty for the other roles.
    scope_tag: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    is_active: Mapped[Optional[bool]] = mapped_column(Boolean, default=True, nullable=True)

    # The automation lead this person reports to (leads manage their people's roles and projects).
    assigned_lead_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    organization_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("organizations.id"), nullable=True)

    # Legacy community assignment (JSON list of community ids), still read by the hidden community forum.
    assigned_communities: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    # User preferences
    preferred_communities: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    theme_preference: Mapped[Optional[str]] = mapped_column(String, default="system", nullable=True)
    preferred_ai_model: Mapped[Optional[str]] = mapped_column(String, default="gpt-4o-mini", nullable=True)
    ai_model_provider: Mapped[Optional[str]] = mapped_column(String, default="openai", nullable=True)
    ai_temperature: Mapped[Optional[str]] = mapped_column(String, default="0.7", nullable=True)

    # 2FA (Two-Factor Authentication)
    two_fa_enabled: Mapped[Optional[bool]] = mapped_column(Boolean, default=False, nullable=True)
    two_fa_secret: Mapped[Optional[str]] = mapped_column(String, nullable=True)  # TOTP secret key

    # Non-secret personal settings (tokens are in user_connections)
    settings_json: Mapped[Optional[dict]] = mapped_column(JSON, default=dict, nullable=True)

    created_at: Mapped[Optional[datetime]] = mapped_column(DateTime, default=datetime.utcnow, nullable=True)
    last_login: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    organization = relationship("Organization", back_populates="users")
    login_history = relationship("LoginHistory", back_populates="user")
    sessions = relationship("UserSession", back_populates="user")
    api_tokens = relationship("APIToken", back_populates="user")
    notification_preferences = relationship("NotificationPreference", back_populates="user", uselist=False)
    # Encrypted personal tokens (app.modules.settings.connections)
    connections = relationship("UserConnection", back_populates="user", cascade="all, delete-orphan")

    def verify_password(self, password: str) -> bool:
        """Verify password against hash"""
        try:
            import hashlib
            # Try pre-hashed method first (new way: SHA-256 pre-hash + bcrypt)
            prehashed = hashlib.sha256(password.encode("utf-8")).hexdigest()
            if pwd_context.verify(prehashed, self.hashed_password):
                return True
        except Exception:
            pass
        
        try:
            # Try direct bcrypt verification (old way, for backward compatibility)
            return pwd_context.verify(password, self.hashed_password)
        except Exception:
            pass
        
        # Fallback to simple hash verification
        return simple_verify_password(password, self.hashed_password)

    @staticmethod
    def hash_password(password: str) -> str:
        """Hash a password"""
        try:
            return pwd_context.hash(password)
        except Exception:
            # Fallback to simple hash
            return simple_hash_password(password)


class RoleMigrationLog(Base):
    """Old and new role of every user, written by the phase 04 role migration for the super admin to review."""
    __tablename__ = "role_migration_log"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    old_role = Column(String(32), nullable=False)
    new_role = Column(String(32), nullable=False)
    scope_tag = Column(String(16), nullable=True)
    migrated_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class LoginHistory(Base):
    """Track user login attempts for audit log"""
    __tablename__ = "login_history"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True, nullable=False)
    
    # Login metadata
    ip_address = Column(String, nullable=True)
    user_agent = Column(String, nullable=True)
    device_name = Column(String, nullable=True)  # e.g., "Chrome on Windows", "Safari on iOS"
    success = Column(Boolean, default=True)
    failure_reason = Column(String, nullable=True)  # e.g., "Invalid password", "Account locked"
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    
    # Relationships
    user = relationship("User", back_populates="login_history")


class UserSession(Base):
    """Active user sessions for device/session management"""
    __tablename__ = "user_sessions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True, nullable=False)
    
    # Session metadata
    session_token = Column(String, unique=True, index=True, nullable=False)
    device_name = Column(String, nullable=True)
    device_type = Column(String, nullable=True)  # desktop, mobile, tablet
    browser = Column(String, nullable=True)
    os = Column(String, nullable=True)
    ip_address = Column(String, nullable=True)
    
    # Session control
    is_active = Column(Boolean, default=True)
    last_activity = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    expires_at = Column(DateTime, nullable=False)  # Session expiration time
    
    # Relationships
    user = relationship("User", back_populates="sessions")


class APIToken(Base):
    """Personal API tokens for programmatic access"""
    __tablename__ = "api_tokens"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True, nullable=False)
    
    # Token metadata
    token = Column(String, unique=True, index=True, nullable=False)  # Hashed token
    token_preview = Column(String, nullable=False)  # Last 4 chars for display
    name = Column(String, nullable=False)  # e.g., "GitHub Integration", "Mobile App"
    scopes = Column(String, nullable=True)  # Comma-separated scopes
    
    # Token control
    is_active = Column(Boolean, default=True)
    last_used = Column(DateTime, nullable=True)
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    expires_at = Column(DateTime, nullable=True)  # None for never expires
    
    # Relationships
    user = relationship("User", back_populates="api_tokens")


class NotificationPreference(Base):
    """User notification preferences"""
    __tablename__ = "notification_preferences"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True, index=True, nullable=False)
    
    # Email notifications
    email_forum_posts = Column(Boolean, default=True)  # New posts in followed topics
    email_comments = Column(Boolean, default=True)     # Comments on your posts
    email_mentions = Column(Boolean, default=True)     # When mentioned
    email_community_updates = Column(Boolean, default=True)  # Community announcements
    email_digest_frequency = Column(String, default="weekly")  # daily, weekly, never
    
    # In-app notifications
    in_app_forum_posts = Column(Boolean, default=True)
    in_app_comments = Column(Boolean, default=True)
    in_app_mentions = Column(Boolean, default=True)
    in_app_system = Column(Boolean, default=True)
    
    # Push notifications (if applicable)
    push_enabled = Column(Boolean, default=False)
    
    # Quiet hours (optional)
    quiet_hours_enabled = Column(Boolean, default=False)
    quiet_hours_start = Column(String, nullable=True)  # HH:MM format
    quiet_hours_end = Column(String, nullable=True)    # HH:MM format
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    user = relationship("User", back_populates="notification_preferences")


# Register the target of User.connections whenever users are loaded.
from app.modules.settings import models as _connection_models  # noqa: E402,F401
