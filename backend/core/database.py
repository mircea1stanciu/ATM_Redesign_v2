"""
Core database models and configuration for UnifiedWork
Multi-tenant architecture with organization isolation
"""
import enum

# Database setup
import os
import secrets
from datetime import datetime

from passlib.context import CryptContext
from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    Text,
    create_engine,
    inspect,
    text,
)
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship, sessionmaker

_current_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # Get parent directory (project root)
# ATM_DATABASE_PATH lets the UI-test harness run the app on a throwaway database.
_db_path = os.getenv("ATM_DATABASE_PATH") or os.path.join(_current_dir, "unifiedwork.db")
SQLALCHEMY_DATABASE_URL = f"sqlite:///{_db_path}"
engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# Password hashing
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def simple_hash_password(password: str) -> str:
    """Simple password hashing as fallback"""
    import hashlib
    return hashlib.sha256(password.encode()).hexdigest()

def simple_verify_password(password: str, hashed: str) -> bool:
    """Simple password verification as fallback"""
    import hashlib
    return hashlib.sha256(password.encode()).hexdigest() == hashed


class UserRole(enum.Enum):
    """User role enumeration"""
    SUPER_ADMIN = "super_admin"      # Platform administrator
    ADMIN = "admin"                  # Administrator
    ORG_ADMIN = "org_admin"          # Organization administrator
    COMMUNITY_LEAD = "community_lead"  # Community leader/moderator
    AUTOMATION_LEAD = "automation_lead"  # Automation workflow lead
    AUTOMATION_USER = "automation_user"  # Automation workflow user
    USER = "user"                    # Regular user
    VIEWER = "viewer"                # Read-only user


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

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, index=True, nullable=False)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    full_name = Column(String)
    role = Column(Enum(UserRole), default=UserRole.USER, nullable=False)
    is_active = Column(Boolean, default=True)
    
    # For automation lead assignment (which lead manages this user)
    assigned_lead_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    
    # Multi-tenancy
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=True)
    
    # Community Lead assignment (which communities they manage)
    assigned_communities = Column(String, nullable=True)  # JSON string: ["qa", "backend"]
    
    # User preferences
    preferred_communities = Column(String, nullable=True)  # JSON string of community preferences
    theme_preference = Column(String, default="system")  # light, dark, system
    preferred_ai_model = Column(String, default="gpt-4o-mini")  # User's preferred AI model
    ai_model_provider = Column(String, default="openai")  # openai or anthropic
    ai_temperature = Column(String, default="0.7")  # AI creativity level (0.0-1.0)
    
    # 2FA (Two-Factor Authentication)
    two_fa_enabled = Column(Boolean, default=False)
    two_fa_secret = Column(String, nullable=True)  # TOTP secret key

    # Free-form per-user integration settings (GitHub/Jira tokens, base URLs, etc.)
    settings_json = Column(JSON, default=dict, nullable=True)

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    last_login = Column(DateTime, nullable=True)
    
    # Relationships
    organization = relationship("Organization", back_populates="users")
    login_history = relationship("LoginHistory", back_populates="user")
    sessions = relationship("UserSession", back_populates="user")
    api_tokens = relationship("APIToken", back_populates="user")
    notification_preferences = relationship("NotificationPreference", back_populates="user", uselist=False)

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


def get_db():
    """Get database session"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    """Initialize database and create default data"""
    Base.metadata.create_all(bind=engine)
    inspector = inspect(engine)
    if "analytics_runs" in inspector.get_table_names():
        run_columns = {column["name"] for column in inspector.get_columns("analytics_runs")}
        if "logs_json" not in run_columns:
            with engine.begin() as connection:
                connection.execute(text("ALTER TABLE analytics_runs ADD COLUMN logs_json JSON NOT NULL DEFAULT '[]'"))
        with engine.begin() as connection:
            if "collection_path" not in run_columns:
                connection.execute(text("ALTER TABLE analytics_runs ADD COLUMN collection_path VARCHAR(512)"))
            if "environment" not in run_columns:
                connection.execute(text("ALTER TABLE analytics_runs ADD COLUMN environment VARCHAR(255)"))
            if "results_json" not in run_columns:
                connection.execute(
                    text("ALTER TABLE analytics_runs ADD COLUMN results_json JSON NOT NULL DEFAULT '[]'")
                )
            if "name" not in run_columns:
                connection.execute(text("ALTER TABLE analytics_runs ADD COLUMN name VARCHAR(255)"))
            if "details_json" not in run_columns:
                connection.execute(text("ALTER TABLE analytics_runs ADD COLUMN details_json JSON"))
    
    db = SessionLocal()
    try:
        get_default_organization(db)
        _seed_dev_admin(db)
    except Exception as e:
        print(f"❌ Error initializing database: {e}")
        db.rollback()
    finally:
        db.close()


DEFAULT_ORGANIZATION_SLUG = "unifiedwork"


def get_default_organization(db):
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


def _seed_dev_admin(db):
    """Create the first super admin from ATM_DEV_ADMIN_PASSWORD (development only; no fixed passwords)."""
    if db.query(User).filter(User.role == UserRole.SUPER_ADMIN).first():
        return
    password = os.getenv("ATM_DEV_ADMIN_PASSWORD")
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
