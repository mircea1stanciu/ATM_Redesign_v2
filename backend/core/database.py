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
    UniqueConstraint,
    create_engine,
    inspect,
    text,
)
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship, sessionmaker

_current_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # Get parent directory (project root)
_db_path = os.path.join(_current_dir, "unifiedwork.db")
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
    """Subscription plan types with limits"""
    FREE = "free"                    # 10 users, 1,000 chats/month - Trial/Testing
    SMALL_BUSINESS = "small_business"  # 20 users, 5,000 chats/month - Small Teams
    ENTERPRISE = "enterprise"          # 100+ users, 50,000+ chats/month - Large Organizations


class UserStatus(enum.Enum):
    """User online status for messaging"""
    ONLINE = "online"
    AWAY = "away"
    OFFLINE = "offline"


class MessageType(enum.Enum):
    """Message type enumeration"""
    TEXT = "text"
    IMAGE = "image"
    FILE = "file"
    SYSTEM = "system"


class Organization(Base):
    """Organization/Tenant model for multi-tenancy"""
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
    chat_sessions = relationship("ChatSession", back_populates="organization")
    subscriptions = relationship("Subscription", back_populates="organization", cascade="all, delete-orphan")
    
    @staticmethod
    def generate_access_token() -> str:
        """Generate secure access token"""
        return secrets.token_urlsafe(32)
    
    @property
    def plan_limits(self) -> dict:
        """Get limits based on subscription plan"""
        limits = {
            SubscriptionPlan.FREE: {"users": 10, "chats": 1000},
            SubscriptionPlan.SMALL_BUSINESS: {"users": 20, "chats": 5000},
            SubscriptionPlan.ENTERPRISE: {"users": -1, "chats": -1}  # Unlimited
        }
        return limits.get(self.subscription_plan, limits[SubscriptionPlan.FREE])


class User(Base):
    """User model with multi-tenant support"""
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
    chat_sessions = relationship("ChatSession", back_populates="user")
    sent_messages = relationship("Message", foreign_keys="Message.sender_id")
    conversation_participations = relationship("ConversationParticipant")
    login_history = relationship("LoginHistory", back_populates="user")
    sessions = relationship("UserSession", back_populates="user")
    api_tokens = relationship("APIToken", back_populates="user")
    notification_preferences = relationship("NotificationPreference", back_populates="user", uselist=False)
    privacy_settings = relationship("PrivacySettings", back_populates="user", uselist=False)
    # Phase 4: Data & Integrations
    data_exports = relationship("DataExport", back_populates="user", cascade="all, delete-orphan")
    integrations = relationship("Integration", back_populates="user", cascade="all, delete-orphan")
    webhooks = relationship("Webhook", back_populates="user", cascade="all, delete-orphan")
    # Phase 5: Billing & Subscription
    subscription = relationship("Subscription", back_populates="user", uselist=False)
    billing_invoices = relationship("BillingInvoice", back_populates="user", cascade="all, delete-orphan")
    payment_methods = relationship("PaymentMethod", back_populates="user", cascade="all, delete-orphan")

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


class ChatSession(Base):
    """Chat session history with community context"""
    __tablename__ = "chat_sessions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True, nullable=False)
    organization_id = Column(Integer, ForeignKey("organizations.id"), index=True)
    
    # Community context
    community = Column(String, nullable=False)  # qa, backend, frontend, etc.
    agent_name = Column(String, nullable=False)  # QualityGPT, BackendGPT, etc.
    
    # Chat content
    message = Column(Text, nullable=False)
    response = Column(Text, nullable=False)
    model_used = Column(String, default="gpt-4o-mini")  # Which AI model was used
    model_id = Column(String, nullable=True)       # Model ID (e.g., "gpt-4", "claude-3-opus")
    model_provider = Column(String, nullable=True) # openai or anthropic
    
    # Metadata
    response_time_ms = Column(Integer, nullable=True)  # Response time in milliseconds
    tokens_used = Column(Integer, nullable=True)       # Tokens consumed (for billing)
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # Relationships
    user = relationship("User", back_populates="chat_sessions")
    organization = relationship("Organization", back_populates="chat_sessions")


class UserPresence(Base):
    """User presence tracking for real-time messaging"""
    __tablename__ = "user_presence"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True, nullable=False)
    organization_id = Column(Integer, ForeignKey("organizations.id"), index=True, nullable=False)
    
    # Presence data
    status = Column(Enum(UserStatus), default=UserStatus.OFFLINE, nullable=False)
    last_seen = Column(DateTime, default=datetime.utcnow)
    is_typing = Column(Boolean, default=False)
    typing_in_conversation = Column(Integer, nullable=True)  # conversation_id if typing
    
    # Connection tracking
    socket_id = Column(String, nullable=True)  # For WebSocket connection tracking
    
    # Timestamps
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    user = relationship("User")
    organization = relationship("Organization")
    
    # Ensure one presence record per user per organization
    __table_args__ = (UniqueConstraint('user_id', 'organization_id', name='_user_org_presence_uc'),)


class Conversation(Base):
    """Conversation between users in an organization"""
    __tablename__ = "conversations"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), index=True, nullable=False)
    
    # Conversation metadata
    name = Column(String, nullable=True)  # Optional conversation name for group chats
    is_group = Column(Boolean, default=False)  # True for group conversations
    
    # Last activity tracking
    last_message_id = Column(Integer, nullable=True)
    last_activity = Column(DateTime, default=datetime.utcnow)
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    organization = relationship("Organization")
    participants = relationship("ConversationParticipant", back_populates="conversation")
    messages = relationship("Message", back_populates="conversation", order_by="Message.created_at")


class ConversationParticipant(Base):
    """Participants in a conversation"""
    __tablename__ = "conversation_participants"

    id = Column(Integer, primary_key=True, index=True)
    conversation_id = Column(Integer, ForeignKey("conversations.id"), index=True, nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), index=True, nullable=False)
    
    # Participant metadata
    joined_at = Column(DateTime, default=datetime.utcnow)
    last_read_message_id = Column(Integer, nullable=True)  # For unread count
    is_active = Column(Boolean, default=True)  # Can leave/rejoin conversations
    
    # Notifications
    muted = Column(Boolean, default=False)
    
    # Timestamps
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    conversation = relationship("Conversation", back_populates="participants")
    user = relationship("User")
    
    # Ensure unique participant per conversation
    __table_args__ = (UniqueConstraint('conversation_id', 'user_id', name='_conversation_user_uc'),)


class Message(Base):
    """Individual messages in conversations"""
    __tablename__ = "messages"

    id = Column(Integer, primary_key=True, index=True)
    conversation_id = Column(Integer, ForeignKey("conversations.id"), index=True, nullable=False)
    sender_id = Column(Integer, ForeignKey("users.id"), index=True, nullable=False)
    
    # Message content
    content = Column(Text, nullable=False)
    message_type = Column(Enum(MessageType), default=MessageType.TEXT, nullable=False)
    
    # File/media metadata (if applicable)
    file_url = Column(String, nullable=True)
    file_name = Column(String, nullable=True)
    file_size = Column(Integer, nullable=True)
    file_type = Column(String, nullable=True)
    
    # Message metadata
    edited = Column(Boolean, default=False)
    edited_at = Column(DateTime, nullable=True)
    
    # Threading (for replies)
    reply_to_message_id = Column(Integer, ForeignKey("messages.id"), nullable=True)
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # Relationships
    conversation = relationship("Conversation", back_populates="messages")
    sender = relationship("User")
    reply_to = relationship("Message", remote_side=[id])  # Self-referential for replies
    
    # Index for efficient message retrieval
    __table_args__ = (
        {'extend_existing': True}
    )


class MessageReaction(Base):
    """Message reactions (emoji reactions on messages)"""
    __tablename__ = "message_reactions"

    id = Column(Integer, primary_key=True, index=True)
    message_id = Column(Integer, ForeignKey("messages.id"), index=True, nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), index=True, nullable=False)
    emoji = Column(String(10), nullable=False)  # Emoji Unicode
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # Relationships
    message = relationship("Message")
    user = relationship("User")
    
    # Unique constraint - one reaction type per user per message
    __table_args__ = (
        UniqueConstraint('message_id', 'user_id', 'emoji', name='unique_user_message_reaction'),
        {'extend_existing': True}
    )


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


class PrivacySettings(Base):
    """User privacy and visibility settings"""
    __tablename__ = "privacy_settings"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True, index=True, nullable=False)
    
    # Profile visibility
    profile_public = Column(Boolean, default=True)  # Can others see profile
    show_activity = Column(Boolean, default=True)   # Show activity in community
    show_email = Column(Boolean, default=False)     # Show email publicly
    
    # Communication
    allow_messages = Column(Boolean, default=True)  # Allow messages from anyone
    allow_mentions = Column(Boolean, default=True)  # Allow being mentioned
    
    # Data sharing
    allow_analytics = Column(Boolean, default=True)  # Allow usage analytics
    allow_marketing = Column(Boolean, default=False) # Allow marketing emails
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    user = relationship("User", back_populates="privacy_settings")


# ── Data & Integrations Models ──────────────────────────────────────────────

class DataExport(Base):
    """Track user data export requests"""
    __tablename__ = "data_export"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    
    # Export details
    export_type = Column(String(50))  # full, minimal, specific
    specific_types = Column(String)  # CSV: posts, comments, profile, etc
    format = Column(String(20), default="json")  # json, csv, xml
    status = Column(String(20), default="pending")  # pending, processing, ready, expired
    
    # File info
    file_url = Column(String, nullable=True)
    file_size = Column(Integer, default=0)  # bytes
    
    # Timestamps
    requested_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)
    expires_at = Column(DateTime, nullable=True)
    
    # Relationships
    user = relationship("User", back_populates="data_exports")


class Integration(Base):
    """Connected external integrations"""
    __tablename__ = "integration"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    
    # Integration details
    service_name = Column(String(100), nullable=False)  # slack, github, jira, etc
    service_type = Column(String(50))  # messaging, vcs, issue-tracking, etc
    
    # Connection info
    client_id = Column(String, nullable=True)
    client_secret = Column(String, nullable=True)  # encrypted
    access_token = Column(String, nullable=True)  # encrypted
    refresh_token = Column(String, nullable=True)  # encrypted
    token_expires_at = Column(DateTime, nullable=True)
    
    # Workspace/org info
    external_workspace_id = Column(String, nullable=True)
    external_workspace_name = Column(String, nullable=True)
    
    # Status
    is_active = Column(Boolean, default=True)
    last_sync = Column(DateTime, nullable=True)
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    user = relationship("User", back_populates="integrations")
    webhooks = relationship("Webhook", back_populates="integration", cascade="all, delete-orphan")


class Webhook(Base):
    """Webhook configuration for integrations"""
    __tablename__ = "webhook"
    
    id = Column(Integer, primary_key=True, index=True)
    integration_id = Column(Integer, ForeignKey("integration.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    
    # Webhook details
    event_type = Column(String(100), nullable=False)  # push, pull_request, issue, etc
    target_url = Column(String, nullable=False)
    
    # Configuration
    is_active = Column(Boolean, default=True)
    secret = Column(String, nullable=True)  # HMAC secret for verification
    headers = Column(JSON, default={})  # custom headers
    
    # Delivery tracking
    last_delivery = Column(DateTime, nullable=True)
    delivery_count = Column(Integer, default=0)
    failure_count = Column(Integer, default=0)
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    integration = relationship("Integration", back_populates="webhooks")
    user = relationship("User", back_populates="webhooks")


# ── Billing & Subscription Models ──────────────────────────────────────────

class Subscription(Base):
    """User subscription details"""
    __tablename__ = "subscription"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, unique=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    
    # Subscription details
    plan = Column(String(50), default="free")  # free, starter, professional, enterprise
    status = Column(String(50), default="active")  # active, paused, cancelled, expired
    billing_cycle = Column(String(20), default="monthly")  # monthly, yearly
    
    # Pricing
    monthly_cost = Column(String(20), default="0.00")
    yearly_cost = Column(String(20), default="0.00")
    
    # Dates
    current_period_start = Column(DateTime, nullable=True)
    current_period_end = Column(DateTime, nullable=True)  # next billing date
    renewal_date = Column(DateTime, nullable=True)
    cancelled_at = Column(DateTime, nullable=True)
    
    # Features
    storage_limit_gb = Column(Integer, default=5)  # GB
    max_team_members = Column(Integer, default=1)
    api_rate_limit = Column(Integer, default=1000)  # requests per day
    
    # Trial period
    trial_ends_at = Column(DateTime, nullable=True)
    is_trial = Column(Boolean, default=False)
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    user = relationship("User", back_populates="subscription")
    organization = relationship("Organization", back_populates="subscriptions")


class BillingInvoice(Base):
    """Billing history and invoices"""
    __tablename__ = "billing_invoice"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    subscription_id = Column(Integer, ForeignKey("subscription.id"), nullable=False)
    
    # Invoice details
    invoice_number = Column(String(100), unique=True, nullable=False)
    amount = Column(String(20), nullable=False)
    currency = Column(String(10), default="USD")
    
    # Item details
    description = Column(String, nullable=False)  # Subscription for Sept 2024, etc
    period_start = Column(DateTime, nullable=True)
    period_end = Column(DateTime, nullable=True)
    
    # Status
    status = Column(String(50), default="unpaid")  # paid, unpaid, pending, failed, refunded
    payment_method_id = Column(Integer, ForeignKey("payment_method.id"), nullable=True)
    
    # Timeline
    due_date = Column(DateTime, nullable=True)
    paid_at = Column(DateTime, nullable=True)
    refunded_at = Column(DateTime, nullable=True)
    
    # Timestamps
    issued_at = Column(DateTime, default=datetime.utcnow)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # Relationships
    user = relationship("User", back_populates="billing_invoices")
    subscription = relationship("Subscription")
    payment_method = relationship("PaymentMethod")


class PaymentMethod(Base):
    """Payment methods on file"""
    __tablename__ = "payment_method"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    
    # Payment details
    type = Column(String(50))  # credit_card, debit_card, bank_account, paypal
    
    # Card info (encrypted in production)
    card_brand = Column(String(50), nullable=True)  # visa, mastercard, amex
    card_last4 = Column(String(4), nullable=True)  # Last 4 digits
    card_exp_month = Column(Integer, nullable=True)
    card_exp_year = Column(Integer, nullable=True)
    
    # Bank info (for ACH)
    bank_name = Column(String(100), nullable=True)
    bank_account_last4 = Column(String(4), nullable=True)
    
    # Status
    is_default = Column(Boolean, default=False)
    is_valid = Column(Boolean, default=True)
    
    # Billing address
    billing_name = Column(String(100), nullable=True)
    billing_email = Column(String(100), nullable=True)
    billing_address = Column(String, nullable=True)
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    user = relationship("User", back_populates="payment_methods")


def get_db():
    """Get database session"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    """Initialize database and create default data"""
    # Import office models here to avoid circular imports
    # This registers them with SQLAlchemy's metadata before creating tables
    try:
        from models.office_models import (  # noqa: F401
            DeskBooking,
            OfficeDesk,
            OfficeSettings,
            ParkingBooking,
            ParkingSpace,
        )
    except ImportError:
        # Models may not exist yet during initial setup
        pass
    
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
        # Create default organization
        default_org = db.query(Organization).filter(Organization.slug == "unifiedwork").first()
        if not default_org:
            default_org = Organization(
                name="UnifiedWork",
                slug="unifiedwork",
                description="Default organization for UnifiedWork platform",
                subscription_plan=SubscriptionPlan.ENTERPRISE,
                max_users=100,
                max_chat_sessions=50000,
                access_token=Organization.generate_access_token(),
                primary_color="#2563eb",
                secondary_color="#64748b"
            )
            db.add(default_org)
            db.commit()
            db.refresh(default_org)
            print("✅ Default organization created")
            print(f"   Access Token: {default_org.access_token}")
        
        # Create super admin user
        super_admin = db.query(User).filter(User.email == "admin@unifiedwork.com").first()
        if not super_admin:
            try:
                super_admin = User(
                    username="admin",
                    email="admin@unifiedwork.com",
                    hashed_password=User.hash_password("admin123"),
                    full_name="UnifiedWork Administrator",
                    role=UserRole.SUPER_ADMIN,
                    organization_id=default_org.id,
                    is_active=True
                )
                db.add(super_admin)
                db.commit()
                print("✅ Super admin created (username: admin, password: admin123)")
            except Exception as e:
                print(f"❌ Error creating super admin: {e}")
        
        # Create demo organization
        demo_org = db.query(Organization).filter(Organization.slug == "demo").first()
        if not demo_org:
            demo_org = Organization(
                name="Demo Company",
                slug="demo",
                description="Demo organization for testing UnifiedWork",
                subscription_plan=SubscriptionPlan.SMALL_BUSINESS,
                max_users=25,
                max_chat_sessions=10000,
                access_token=Organization.generate_access_token(),
                primary_color="#7c3aed",
                secondary_color="#a855f7"
            )
            db.add(demo_org)
            db.commit()
            db.refresh(demo_org)
            print("✅ Demo organization created")
            print(f"   Access Token: {demo_org.access_token}")
            
            # Create demo users for each community
            demo_users = [
                {"username": "qa_engineer", "email": "qa@demo.com", "full_name": "QA Engineer"},
                {"username": "backend_dev", "email": "backend@demo.com", "full_name": "Backend Developer"},
                {"username": "frontend_dev", "email": "frontend@demo.com", "full_name": "Frontend Developer"},
                {"username": "ui_designer", "email": "design@demo.com", "full_name": "UI/UX Designer"},
                {"username": "product_manager", "email": "product@demo.com", "full_name": "Product Manager"},
                {"username": "devops_engineer", "email": "devops@demo.com", "full_name": "DevOps Engineer"},
                {"username": "tech_writer", "email": "docs@demo.com", "full_name": "Technical Writer"},
            ]
            
            for user_data in demo_users:
                if not db.query(User).filter(User.email == user_data["email"]).first():
                    demo_user = User(
                        username=user_data["username"],
                        email=user_data["email"],
                        hashed_password=User.hash_password("demo123"),
                        full_name=user_data["full_name"],
                        role=UserRole.USER,
                        organization_id=demo_org.id,
                        is_active=True
                    )
                    db.add(demo_user)
            
            db.commit()
            print("✅ Demo users created (password: demo123)")
            
    except Exception as e:
        print(f"❌ Error initializing database: {e}")
        db.rollback()
    finally:
        db.close()
