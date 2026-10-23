# UnifiedWork Backend - AI-Powered Unified Workspace
# Comprehensive multi-tenant SaaS platform for tech teams

import base64
import io
import json
import logging
import os
from datetime import datetime
from typing import Optional

from dotenv import load_dotenv
from fastapi import Body, Depends, FastAPI, HTTPException, Request, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

# Load environment variables before importing modules that read JWT settings.
load_dotenv()
from sqlalchemy.orm import Session

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('auth_audit.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# Import for 2FA
import pyotp
import qrcode

from agents.simple_analyst_agent import SimpleAnalystAgent
from agents.simple_backend_agent import SimpleBackendAgent
from agents.simple_design_agent import SimpleDesignAgent
from agents.simple_devops_agent import SimpleDevOpsAgent
from agents.simple_frontend_agent import SimpleFrontendAgent
from agents.simple_product_agent import SimpleProductAgent
from agents.simple_qa_agent import SimpleQAAgent
from api import ai_routes, integrations_routes, office_routes, project_routes, settings_routes
from core.auth import (
    authenticate_user,
    create_access_token,
    get_current_user,
    get_org_admin_user,
    get_organization_from_subdomain,
    get_super_admin_user,
    pwd_context,
)

# Import core modules
from core.database import (
    ChatSession,
    Organization,
    SubscriptionPlan,
    User,
    UserRole,
    get_db,
    init_db,
)

# Import office models to register them with SQLAlchemy

# Helper function for community access control
def check_community_access(user: User, community_id: str):
    """Check if user has access to a specific community within their organization"""
    
    # Super admins and org admins have access to all communities
    if user.role in [UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN]:
        return True
    
    # Regular users and community leads must have community assigned
    import json
    assigned_communities = json.loads(user.assigned_communities) if user.assigned_communities else []
    
    if community_id not in assigned_communities:
        raise HTTPException(
            status_code=403, 
            detail=f"Access denied. You are not assigned to the {community_id} community. Contact your organization administrator for access."
        )
    
    return True

# Initialize rate limiter
limiter = Limiter(key_func=get_remote_address)

# Initialize FastAPI app
app = FastAPI(
    title="UnifiedWork API",
    description="""
## 🚀 UnifiedWork - AI-Powered Unified Workspace

A comprehensive platform that brings together all tech roles with specialized AI assistants.

### 7 Specialized Communities

1. **🎯 QA Engineers** → QualityGPT - Test automation, scenarios, bug analysis
2. **🔧 Backend Developers** → BackendGPT - API design, database optimization
3. **🎨 Frontend Developers** → FrontendGPT - React/Vue/Angular, mobile apps
4. **✨ UI/UX Designers** → DesignGPT - Design systems, accessibility
5. **📊 Product Managers** → ProductGPT - Requirements, user stories
6. **🔐 DevOps Engineers** → OpsGPT - CI/CD, infrastructure
7. **� Business System Analysts** → AnalystGPT - Requirements analysis, process optimization

### Features

- 🏢 **Multi-Tenant Architecture** - Complete organization isolation
- 🔐 **Role-Based Access Control** - Super Admin, Org Admin, User roles
- 🤖 **7 Specialized AI Agents** - Expert assistance for each tech role
- 📊 **Subscription Plans** - FREE, BASIC, PREMIUM, ENTERPRISE
- 🎨 **Custom Branding** - Organization-specific themes and colors
- 📈 **Usage Analytics** - Track usage across teams and projects
- 🔑 **Flexible API Keys** - Per-organization LLM configuration

### Authentication

Most endpoints require JWT Bearer token authentication:
```
Authorization: Bearer <your_jwt_token>
```
""",
    version="3.0.0",
    openapi_tags=[
        {"name": "Authentication", "description": "User authentication and registration"},
        {"name": "Communities", "description": "Community-specific chat interfaces"},
        {"name": "Organizations", "description": "Multi-tenant organization management"},
        {"name": "Chat", "description": "AI-powered chat with specialized agents"},
        {"name": "Admin", "description": "Administrative endpoints"},
        {"name": "Health", "description": "System health monitoring"}
    ]
)

# Add rate limiter state
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001", "http://localhost:3002", "http://localhost:3003"],  # Frontend URLs
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Security Headers Middleware
@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    # Prevent clickjacking attacks
    response.headers["X-Frame-Options"] = "DENY"
    # Prevent MIME type sniffing
    response.headers["X-Content-Type-Options"] = "nosniff"
    # Enable XSS protection
    response.headers["X-XSS-Protection"] = "1; mode=block"
    # Content Security Policy - adjust as needed
    response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline';"
    # Referrer policy
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    # Permissions policy
    response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
    return response

# Include routers
app.include_router(project_routes.router)
app.include_router(project_routes.analytics_router)
app.include_router(ai_routes.router)
app.include_router(office_routes.router)
app.include_router(settings_routes.router, prefix="/api")
app.include_router(integrations_routes.router, prefix="/api")

# Jira/Confluence/GitHub/Zephyr settings (incl. Jira project search) and mobile
# device management exist only in the v1 app; expose them here too so the
# frontend's /api/settings/* and /api/devices/* calls work.
from app.api.v1.endpoints import devices as v1_devices_routes
from app.api.v1.endpoints import settings as v1_settings_routes

app.include_router(v1_settings_routes.router, prefix="/api/settings", tags=["settings"])
app.include_router(v1_devices_routes.router, prefix="/api/devices", tags=["devices"])

# Import and include messaging routes
from messaging_routes import router as messaging_router

app.include_router(messaging_router)

# Global agent instances - One for each community
# Global agent instances - One for each community
agents = {
    "qa": None,
    "backend": None,
    "frontend": None,
    "design": None,
    "product": None,
    "devops": None,
    "analyst": None,  # Changed from "docs" to "analyst"
}

@app.on_event("startup")
async def startup_event():
    """Initialize database and AI agents on startup"""
    global agents
    
    # Initialize database
    try:
        init_db()
        print("✅ Database initialized successfully")
    except Exception as e:
        print(f"❌ Failed to initialize database: {e}")

    # Re-attach long-running Appium executions started before a restart.
    try:
        await project_routes.resume_orphaned_manual_runs()
    except Exception as e:
        print(f"❌ Failed to resume running executions: {e}")
    
    # Initialize all AI agents
    try:
        agents["qa"] = SimpleQAAgent()
        agents["backend"] = SimpleBackendAgent()
        agents["frontend"] = SimpleFrontendAgent()
        agents["design"] = SimpleDesignAgent()
        agents["product"] = SimpleProductAgent()
        agents["devops"] = SimpleDevOpsAgent()
        agents["analyst"] = SimpleAnalystAgent()
        print("✅ All AI Agents initialized successfully")
    except Exception as e:
        print(f"❌ Failed to initialize agents: {e}")

# Pydantic models
class LoginRequest(BaseModel):
    username: str
    password: str
    organization_slug: Optional[str] = None

class RegisterRequest(BaseModel):
    username: str
    email: EmailStr
    password: str
    full_name: Optional[str] = None
    organization_slug: Optional[str] = None

class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str
    two_fa_code: Optional[str] = None

class ProfileUpdateRequest(BaseModel):
    username: Optional[str] = None
    full_name: Optional[str] = None
    email: Optional[str] = None
    two_fa_code: Optional[str] = None

class DeleteAccountRequest(BaseModel):
    password: str
    two_fa_code: Optional[str] = None

class Enable2FARequest(BaseModel):
    verify_code: Optional[str] = None  # Optional for step 1, required for step 2

class Enable2FAResponse(BaseModel):
    qr_code: Optional[str] = None  # Base64 encoded QR code image
    secret: Optional[str] = None  # TOTP secret for manual entry
    enabled: bool

# ── Settings Models ──────────────────────────────────────────────────────────
class LoginHistoryResponse(BaseModel):
    id: int
    ip_address: Optional[str]
    user_agent: Optional[str]
    device_name: Optional[str]
    success: bool
    failure_reason: Optional[str]
    created_at: str

class UserSessionResponse(BaseModel):
    id: int
    device_name: Optional[str]
    device_type: Optional[str]
    browser: Optional[str]
    os: Optional[str]
    ip_address: Optional[str]
    is_active: bool
    last_activity: str
    created_at: str
    expires_at: str

class APITokenRequest(BaseModel):
    name: str
    scopes: Optional[str] = None
    expires_at: Optional[str] = None

class APITokenResponse(BaseModel):
    id: int
    token_preview: str
    name: str
    scopes: Optional[str]
    is_active: bool
    last_used: Optional[str]
    created_at: str
    expires_at: Optional[str]

class APITokenCreateResponse(APITokenResponse):
    token: str  # Only shown once on creation

class ThemePreferenceRequest(BaseModel):
    theme: str  # light, dark, system

class AIPreferencesRequest(BaseModel):
    preferred_model: str
    provider: str  # openai, anthropic
    temperature: float

class AIPreferencesResponse(BaseModel):
    preferred_model: str
    provider: str
    temperature: float

class NotificationPreferencesRequest(BaseModel):
    email_forum_posts: Optional[bool] = None
    email_comments: Optional[bool] = None
    email_mentions: Optional[bool] = None
    email_community_updates: Optional[bool] = None
    email_digest_frequency: Optional[str] = None
    in_app_forum_posts: Optional[bool] = None
    in_app_comments: Optional[bool] = None
    in_app_mentions: Optional[bool] = None
    in_app_system: Optional[bool] = None
    push_enabled: Optional[bool] = None
    quiet_hours_enabled: Optional[bool] = None
    quiet_hours_start: Optional[str] = None
    quiet_hours_end: Optional[str] = None

class NotificationPreferencesResponse(BaseModel):
    email_forum_posts: bool
    email_comments: bool
    email_mentions: bool
    email_community_updates: bool
    email_digest_frequency: str
    in_app_forum_posts: bool
    in_app_comments: bool
    in_app_mentions: bool
    in_app_system: bool
    push_enabled: bool
    quiet_hours_enabled: bool
    quiet_hours_start: Optional[str]
    quiet_hours_end: Optional[str]

class PrivacySettingsRequest(BaseModel):
    profile_public: Optional[bool] = None
    show_activity: Optional[bool] = None
    show_email: Optional[bool] = None
    allow_messages: Optional[bool] = None
    allow_mentions: Optional[bool] = None
    allow_analytics: Optional[bool] = None
    allow_marketing: Optional[bool] = None

class PrivacySettingsResponse(BaseModel):
    profile_public: bool
    show_activity: bool
    show_email: bool
    allow_messages: bool
    allow_mentions: bool
    allow_analytics: bool
    allow_marketing: bool

class CommunityPreferencesRequest(BaseModel):
    preferred_communities: list[str]  # e.g., ["qa", "backend"]

class SubscriptionDetailsResponse(BaseModel):
    plan: str
    max_users: int
    current_users: int
    max_chat_sessions: int
    current_chat_sessions: int
    renewal_date: Optional[str] = None

class BillingHistoryResponse(BaseModel):
    id: int
    amount: float
    currency: str
    description: str
    status: str  # paid, pending, failed
    created_at: str

# ── Phase 4: Data & Integrations Response Models ──────────────────────────
class DataExportResponse(BaseModel):
    id: int
    export_type: str
    format: str
    status: str
    file_url: Optional[str]
    file_size: int
    requested_at: str
    completed_at: Optional[str]
    expires_at: Optional[str]

class IntegrationResponse(BaseModel):
    id: int
    service_name: str
    service_type: str
    external_workspace_name: Optional[str]
    is_active: bool
    last_sync: Optional[str]
    created_at: str

class WebhookResponse(BaseModel):
    id: int
    event_type: str
    target_url: str
    is_active: bool
    last_delivery: Optional[str]
    delivery_count: int
    failure_count: int
    created_at: str

class IntegrationDetailResponse(IntegrationResponse):
    webhooks: list[WebhookResponse] = []

# ── Phase 5: Billing & Subscription Response Models ──────────────────────
class SubscriptionResponse(BaseModel):
    plan: str
    status: str
    billing_cycle: str
    monthly_cost: str
    yearly_cost: str
    current_period_start: Optional[str]
    current_period_end: Optional[str]
    renewal_date: Optional[str]
    storage_limit_gb: int
    max_team_members: int
    api_rate_limit: int
    is_trial: bool
    trial_ends_at: Optional[str]

class InvoiceResponse(BaseModel):
    id: int
    invoice_number: str
    amount: str
    currency: str
    description: str
    status: str
    period_start: Optional[str]
    period_end: Optional[str]
    due_date: Optional[str]
    paid_at: Optional[str]
    issued_at: str

class PaymentMethodResponse(BaseModel):
    id: int
    type: str
    card_brand: Optional[str]
    card_last4: Optional[str]
    card_exp_month: Optional[int]
    card_exp_year: Optional[int]
    bank_name: Optional[str]
    bank_account_last4: Optional[str]
    is_default: bool
    is_valid: bool
    billing_name: Optional[str]
    created_at: str

class PaymentMethodCreateRequest(BaseModel):
    type: str  # credit_card, debit_card, bank_account
    card_number: Optional[str] = None  # encrypted end-to-end
    card_exp_month: Optional[int] = None
    card_exp_year: Optional[int] = None
    billing_name: Optional[str] = None
    billing_email: Optional[str] = None
    set_as_default: bool = False

class OrgActionWithTwoFARequest(BaseModel):
    two_fa_code: Optional[str] = None  # 2FA code for sensitive organization operations

class Verify2FARequest(BaseModel):
    code: str  # 6-digit TOTP code

class Login2FARequest(BaseModel):
    username: str
    password: str
    totp_code: str  # 6-digit TOTP code for 2FA
    organization_slug: Optional[str] = None

class TokenResponse(BaseModel):
    access_token: str
    token_type: str
    user: dict
    requires_2fa: Optional[bool] = False  # Indicates if 2FA is required

class ChatMessage(BaseModel):
    message: str
    community: Optional[str] = None  # Optional since community_id is in URL path

class ChatResponse(BaseModel):
    response: str
    timestamp: str
    agent: str

# Authentication endpoints
@app.post("/api/auth/login", response_model=TokenResponse, tags=["Authentication"])
@limiter.limit("5/minute")  # Max 5 login attempts per minute per IP
async def login(request: Request, login_data: LoginRequest, response: Response, db: Session = Depends(get_db)):
    """Login with multi-tenant support"""
    client_ip = request.client.host if request.client else "unknown"
    
    # Log login attempt
    logger.info(f"Login attempt - Username: {login_data.username}, IP: {client_ip}, Org: {login_data.organization_slug or 'None'}")
    
    user = authenticate_user(
        db, 
        login_data.username, 
        login_data.password,
        login_data.organization_slug
    )
    
    if not user:
        # Log failed login
        logger.warning(f"Failed login - Username: {login_data.username}, IP: {client_ip}, Reason: Invalid credentials")
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    # Check if organization is blocked
    if user.organization_id:
        org = db.query(Organization).filter(Organization.id == user.organization_id).first()
        if org and not org.is_active:
            raise HTTPException(
                status_code=403, 
                detail="Your organization has been blocked. Please contact support."
            )
    
    # Check if user has 2FA enabled
    if user.two_fa_enabled:
        # Return response indicating 2FA is required (no token yet)
        return TokenResponse(
            access_token="",  # Empty token
            token_type="bearer",
            requires_2fa=True,
            user={
                "id": user.id,
                "username": user.username,
                "email": user.email,
            }
        )
    
    # No 2FA required, proceed with normal login
    user.last_login = datetime.utcnow()
    db.commit()
    
    # Log successful login
    logger.info(f"Successful login - Username: {user.username}, User ID: {user.id}, IP: {client_ip}")
    
    access_token = create_access_token(
        data={
            "user_id": user.id,
            "username": user.username,
            "role": user.role.value,
            "organization_id": user.organization_id
        }
    )
    
    # Set HTTPOnly secure cookie
    response.set_cookie(
        key="access_token",
        value=access_token,
        httponly=True,  # Prevents JavaScript access (XSS protection)
        secure=False,    # Set to True in production with HTTPS
        samesite="lax",  # CSRF protection
        max_age=86400    # 24 hours
    )
    
    org_info = None
    if user.organization:
        org_info = {
            "id": user.organization.id,
            "name": user.organization.name,
            "slug": user.organization.slug,
            "subscription_plan": user.organization.subscription_plan.value
        }
    
    return TokenResponse(
        access_token=access_token,
        token_type="bearer",
        requires_2fa=False,
        user={
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "full_name": user.full_name,
            "role": user.role.value,
            "two_fa_enabled": user.two_fa_enabled,
            "assigned_communities": json.loads(user.assigned_communities) if user.assigned_communities else [],
            "organization": org_info
        }
    )

@app.post("/api/auth/login/verify-2fa", response_model=TokenResponse, tags=["Authentication"])
@limiter.limit("5/minute")  # Max 5 verification attempts per minute per IP
async def login_verify_2fa(request: Request, login_data: Login2FARequest, response: Response, db: Session = Depends(get_db)):
    """Verify 2FA code and complete login"""
    client_ip = request.client.host if request.client else "unknown"
    
    # Log 2FA verification attempt
    logger.info(f"2FA verification attempt - Username: {login_data.username}, IP: {client_ip}")
    
    # Authenticate user with username and password
    user = authenticate_user(
        db, 
        login_data.username, 
        login_data.password,
        login_data.organization_slug
    )
    
    if not user:
        logger.warning(f"Failed 2FA verification - Username: {login_data.username}, IP: {client_ip}, Reason: Invalid credentials")
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    # Check if user has 2FA enabled
    if not user.two_fa_enabled:
        raise HTTPException(status_code=400, detail="2FA is not enabled for this user")
    
    # Verify the TOTP code
    if not user.two_fa_secret:
        raise HTTPException(status_code=500, detail="2FA secret not found")
    
    totp = pyotp.TOTP(user.two_fa_secret)
    if not totp.verify(login_data.totp_code, valid_window=1):
        logger.warning(f"Failed 2FA verification - Username: {login_data.username}, IP: {client_ip}, Reason: Invalid TOTP code")
        raise HTTPException(status_code=401, detail="Invalid 2FA code")
    
    # Check if organization is blocked
    if user.organization_id:
        org = db.query(Organization).filter(Organization.id == user.organization_id).first()
        if org and not org.is_active:
            raise HTTPException(
                status_code=403, 
                detail="Your organization has been blocked. Please contact support."
            )
    
    # 2FA verified successfully, issue token
    user.last_login = datetime.utcnow()
    db.commit()
    
    # Log successful 2FA login
    logger.info(f"Successful 2FA login - Username: {user.username}, User ID: {user.id}, IP: {client_ip}")
    
    access_token = create_access_token(
        data={
            "user_id": user.id,
            "username": user.username,
            "role": user.role.value,
            "organization_id": user.organization_id
        }
    )
    
    # Set HTTPOnly secure cookie
    response.set_cookie(
        key="access_token",
        value=access_token,
        httponly=True,  # Prevents JavaScript access (XSS protection)
        secure=False,    # Set to True in production with HTTPS
        samesite="lax",  # CSRF protection
        max_age=86400    # 24 hours
    )
    
    org_info = None
    if user.organization:
        org_info = {
            "id": user.organization.id,
            "name": user.organization.name,
            "slug": user.organization.slug,
            "subscription_plan": user.organization.subscription_plan.value
        }
    
    return TokenResponse(
        access_token=access_token,
        token_type="bearer",
        requires_2fa=False,
        user={
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "full_name": user.full_name,
            "role": user.role.value,
            "two_fa_enabled": user.two_fa_enabled,
            "assigned_communities": json.loads(user.assigned_communities) if user.assigned_communities else [],
            "organization": org_info
        }
    )

@app.post("/api/auth/logout", tags=["Authentication"])
async def logout(response: Response):
    """Logout by clearing the HTTPOnly cookie"""
    response.delete_cookie(key="access_token")
    return {"message": "Logged out successfully"}

@app.get("/api/auth/me", tags=["Authentication"])
async def get_current_user_info(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Get current user information"""
    # Get organization info
    org_info = None
    if current_user.organization_id:
        org = db.query(Organization).filter(Organization.id == current_user.organization_id).first()
        if org:
            org_info = {
                "id": org.id,
                "name": org.name,
                "slug": org.slug,
                "subscription_plan": org.subscription_plan.value
            }
    
    return {
        "id": current_user.id,
        "username": current_user.username,
        "email": current_user.email,
        "full_name": current_user.full_name,
        "role": current_user.role.value,
        "two_fa_enabled": current_user.two_fa_enabled,
        "assigned_communities": json.loads(current_user.assigned_communities) if current_user.assigned_communities else [],
        "organization": org_info
    }

@app.post("/api/auth/change-password", tags=["Authentication"])
async def change_password(
    change_pwd_request: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Change user password"""
    current_password = change_pwd_request.current_password
    new_password = change_pwd_request.new_password
    two_fa_code = change_pwd_request.two_fa_code
    
    if not current_password or not new_password:
        raise HTTPException(status_code=400, detail="Current password and new password are required")
    
    # Verify current password
    if not pwd_context.verify(current_password, current_user.hashed_password):
        raise HTTPException(status_code=401, detail="Current password is incorrect")
    
    # Check 2FA requirement
    if current_user.two_fa_enabled:
        if not two_fa_code:
            raise HTTPException(status_code=403, detail="2FA code is required for sensitive operations")
        
        # Verify the TOTP code
        totp = pyotp.TOTP(current_user.two_fa_secret)
        if not totp.verify(two_fa_code, valid_window=1):
            raise HTTPException(status_code=401, detail="Invalid 2FA code")
    
    # Hash new password
    new_password_hash = pwd_context.hash(new_password)
    
    # Update password in database
    current_user.hashed_password = new_password_hash
    db.add(current_user)
    db.commit()
    
    return {
        "message": "Password changed successfully",
        "status": "success"
    }

@app.put("/api/auth/profile", tags=["Authentication"])
async def update_profile(
    profile_update: ProfileUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update user profile (username and full name)"""
    
    # Check 2FA requirement
    if current_user.two_fa_enabled:
        if not profile_update.two_fa_code:
            raise HTTPException(status_code=403, detail="2FA code is required for sensitive operations")
        
        # Verify the TOTP code
        totp = pyotp.TOTP(current_user.two_fa_secret)
        if not totp.verify(profile_update.two_fa_code, valid_window=1):
            raise HTTPException(status_code=401, detail="Invalid 2FA code")
    
    # Check if new username is provided and already taken
    if profile_update.username and profile_update.username != current_user.username:
        existing_user = db.query(User).filter(User.username == profile_update.username).first()
        if existing_user:
            raise HTTPException(status_code=400, detail="Username already taken")
        current_user.username = profile_update.username
    
    # Update full name if provided
    if profile_update.full_name is not None:
        current_user.full_name = profile_update.full_name
    
    # Update email if provided and not already taken
    if profile_update.email is not None and profile_update.email != current_user.email:
        existing_user = db.query(User).filter(User.email == profile_update.email).first()
        if existing_user:
            raise HTTPException(status_code=400, detail="Email already in use")
        current_user.email = profile_update.email
    
    # Save changes
    db.add(current_user)
    db.commit()
    db.refresh(current_user)
    
    return {
        "message": "Profile updated successfully",
        "status": "success",
        "user": {
            "id": current_user.id,
            "username": current_user.username,
            "full_name": current_user.full_name,
            "email": current_user.email,
            "role": current_user.role.value
        }
    }

@app.post("/api/auth/2fa/setup", response_model=Enable2FAResponse, tags=["Authentication"])
async def setup_2fa(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Generate 2FA setup QR code"""
    # Check if already enabled
    if current_user.two_fa_enabled:
        raise HTTPException(status_code=400, detail="2FA is already enabled")
    
    # Generate TOTP secret
    secret = pyotp.random_base32()
    
    # Create provisioning URI for QR code
    totp = pyotp.TOTP(secret)
    provisioning_uri = totp.provisioning_uri(
        name=current_user.email,
        issuer_name="UnifiedWork"
    )
    
    # Generate QR code image
    qr = qrcode.QRCode(version=1, box_size=10, border=5)
    qr.add_data(provisioning_uri)
    qr.make(fit=True)
    
    # Convert to image and encode as base64
    img = qr.make_image(fill_color="black", back_color="white")
    img_byte_arr = io.BytesIO()
    img.save(img_byte_arr, format='PNG')
    img_byte_arr.seek(0)
    qr_code_base64 = base64.b64encode(img_byte_arr.getvalue()).decode()
    
    # Store secret in database (unverified - two_fa_enabled is still False)
    # The secret will only be "activated" when the user verifies the code
    current_user.two_fa_secret = secret
    db.add(current_user)
    db.commit()
    db.refresh(current_user)
    
    return {
        "qr_code": qr_code_base64,
        "secret": secret,
        "enabled": False
    }

@app.post("/api/auth/2fa/enable", tags=["Authentication"])
async def enable_2fa(
    enable_request: Enable2FARequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Enable 2FA with verification code"""
    if not enable_request.verify_code:
        raise HTTPException(status_code=400, detail="Verification code is required")
    
    # Check if user already has 2FA enabled
    if current_user.two_fa_enabled:
        raise HTTPException(status_code=400, detail="2FA is already enabled")
    
    # Check if user has a pending secret (from setup endpoint)
    if not current_user.two_fa_secret:
        raise HTTPException(status_code=400, detail="Please setup 2FA first using /api/auth/2fa/setup")
    
    # Verify the code against the stored secret
    totp = pyotp.TOTP(current_user.two_fa_secret)
    if not totp.verify(enable_request.verify_code, valid_window=1):
        raise HTTPException(status_code=400, detail="Invalid verification code")
    
    # Enable 2FA on the user (secret is already stored)
    current_user.two_fa_enabled = True
    db.add(current_user)
    db.commit()
    db.refresh(current_user)
    
    return {
        "message": "2FA enabled successfully",
        "enabled": True
    }

@app.post("/api/auth/2fa/disable", tags=["Authentication"])
async def disable_2fa(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Disable 2FA"""
    if not current_user.two_fa_enabled:
        raise HTTPException(status_code=400, detail="2FA is not enabled")
    
    current_user.two_fa_enabled = False
    current_user.two_fa_secret = None
    db.add(current_user)
    db.commit()
    
    return {
        "message": "2FA disabled successfully",
        "enabled": False
    }

@app.get("/api/auth/2fa/status", tags=["Authentication"])
async def get_2fa_status(
    current_user: User = Depends(get_current_user)
):
    """Get 2FA status for current user"""
    return {
        "enabled": current_user.two_fa_enabled,
        "user_id": current_user.id
    }

@app.post("/api/users/{user_id}/2fa/disable", tags=["User Management"])
async def admin_disable_user_2fa(
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Super Admin or Org Admin: Disable 2FA for users"""
    # Get the target user
    target_user = db.query(User).filter(User.id == user_id).first()
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Authorization checks
    if current_user.role == UserRole.SUPER_ADMIN:
        # Super admins can disable 2FA for any user
        pass
    elif current_user.role == UserRole.ORG_ADMIN:
        # Org admins can only disable 2FA for users in their organization
        if not current_user.organization_id:
            raise HTTPException(
                status_code=403,
                detail="Organization admin must be associated with an organization"
            )
        if target_user.organization_id != current_user.organization_id:
            raise HTTPException(
                status_code=403,
                detail="You can only disable 2FA for users in your organization"
            )
    else:
        raise HTTPException(
            status_code=403,
            detail="Only super administrators and organization administrators can disable 2FA for other users"
        )
    
    # Don't allow disabling 2FA for yourself through this endpoint
    if target_user.id == current_user.id:
        raise HTTPException(
            status_code=400, 
            detail="Use the regular 2FA disable endpoint for your own account"
        )
    
    # Check if 2FA is enabled
    if not target_user.two_fa_enabled:
        return {
            "message": "2FA is already disabled for this user",
            "enabled": False,
            "user_id": target_user.id,
            "username": target_user.username
        }
    
    # Disable 2FA
    target_user.two_fa_enabled = False
    target_user.two_fa_secret = None
    db.add(target_user)
    db.commit()
    
    # Log the action
    admin_type = "Super admin" if current_user.role == UserRole.SUPER_ADMIN else "Org admin"
    logger.info(f"{admin_type} {current_user.username} disabled 2FA for user {target_user.username} (ID: {target_user.id})")
    
    return {
        "message": f"2FA disabled successfully for user {target_user.username}",
        "enabled": False,
        "user_id": target_user.id,
        "username": target_user.username
    }

@app.post("/api/auth/profile/picture", tags=["Authentication"])
async def upload_profile_picture(
    file: UploadFile = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Upload a profile picture for the current user"""
    if not file:
        raise HTTPException(status_code=400, detail="No file provided")
    
    # Validate file type
    allowed_types = {'image/jpeg', 'image/png', 'image/gif', 'image/webp'}
    if file.content_type not in allowed_types:
        raise HTTPException(status_code=400, detail="File must be an image (JPEG, PNG, GIF, or WebP)")
    
    # Validate file size (max 5MB)
    contents = await file.read()
    if len(contents) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File must be less than 5MB")
    
    # Store profile picture path or URL (example: store as base64 or file path)
    # For now, we'll just store a placeholder - in production, you'd upload to S3 or similar
    import hashlib
    file_hash = hashlib.md5(contents).hexdigest()
    picture_url = f"/uploads/profile-pictures/{current_user.id}-{file_hash}.png"
    
    # Update user's profile picture (you would need to add profile_picture_url field to User model)
    # For now, storing in settings_json
    if not current_user.settings_json:
        current_user.settings_json = {}
    current_user.settings_json['profile_picture_url'] = picture_url
    
    db.add(current_user)
    db.commit()
    db.refresh(current_user)
    
    return {
        "profile_picture_url": picture_url,
        "message": "Profile picture uploaded successfully"
    }

@app.delete("/api/auth/profile/picture", tags=["Authentication"])
async def delete_profile_picture(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete the profile picture for the current user"""
    if not current_user.settings_json:
        current_user.settings_json = {}
    
    if 'profile_picture_url' in current_user.settings_json:
        del current_user.settings_json['profile_picture_url']
    
    db.add(current_user)
    db.commit()
    
    return {
        "message": "Profile picture removed successfully"
    }

@app.post("/api/auth/delete-account", tags=["Authentication"])
async def delete_account(
    request: DeleteAccountRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Permanently delete the current user's account"""
    # Verify password
    if not pwd_context.verify(request.password, current_user.hashed_password):
        raise HTTPException(status_code=401, detail="Password is incorrect")
    
    # Check 2FA if enabled
    if current_user.two_fa_enabled:
        if not request.two_fa_code:
            raise HTTPException(status_code=403, detail="2FA code is required for account deletion")
        
        totp = pyotp.TOTP(current_user.two_fa_secret)
        if not totp.verify(request.two_fa_code, valid_window=1):
            raise HTTPException(status_code=401, detail="Invalid 2FA code")
    
    # Log the deletion
    user_id = current_user.id
    user_email = current_user.email
    logger.info(f"User {user_email} (ID: {user_id}) permanently deleted their account")
    
    # Delete related data first (if needed)
    # Delete chat sessions
    db.query(ChatSession).filter(ChatSession.user_id == user_id).delete()
    
    # Delete the user
    db.delete(current_user)
    db.commit()
    
    return {
        "message": "Account deleted successfully"
    }

@app.post("/api/auth/register", response_model=TokenResponse, tags=["Authentication"])
async def register(register_data: RegisterRequest, db: Session = Depends(get_db)):
    """Register new user with organization support"""
    # Check if email exists
    if db.query(User).filter(User.email == register_data.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")
    
    # Get organization
    organization_id = None
    if register_data.organization_slug:
        org = get_organization_from_subdomain(register_data.organization_slug, db)
        if not org:
            raise HTTPException(status_code=404, detail="Organization not found")
        if not org.is_active:
            raise HTTPException(
                status_code=403, 
                detail="Organization is blocked. New registrations are not allowed."
            )
        
        # Check user limit
        user_count = db.query(User).filter(User.organization_id == org.id).count()
        if user_count >= org.max_users:
            raise HTTPException(
                status_code=403, 
                detail=f"Organization has reached maximum users ({org.max_users})"
            )
        organization_id = org.id
    
    # Create new user
    new_user = User(
        username=register_data.username,
        email=register_data.email,
        hashed_password=User.hash_password(register_data.password),
        full_name=register_data.full_name,
        role=UserRole.USER,
        organization_id=organization_id,
        is_active=True
    )
    
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    
    # Create access token
    access_token = create_access_token(
        data={
            "user_id": new_user.id,
            "username": new_user.username,
            "role": new_user.role.value,
            "organization_id": new_user.organization_id
        }
    )
    
    org_info = None
    if new_user.organization:
        org_info = {
            "id": new_user.organization.id,
            "name": new_user.organization.name,
            "slug": new_user.organization.slug,
            "subscription_plan": new_user.organization.subscription_plan.value
        }
    
    return TokenResponse(
        access_token=access_token,
        token_type="bearer",
        user={
            "id": new_user.id,
            "username": new_user.username,
            "email": new_user.email,
            "full_name": new_user.full_name,
            "role": new_user.role.value,
            "organization": org_info
        }
    )

@app.post("/api/auth/register-org-admin", response_model=TokenResponse, tags=["Authentication"])
async def register_org_admin(register_data: dict, db: Session = Depends(get_db)):
    """Register as organization admin using access token"""
    
    # Validate required fields
    required_fields = ["access_token", "username", "email", "password", "full_name"]
    for field in required_fields:
        if field not in register_data:
            raise HTTPException(status_code=400, detail=f"Missing required field: {field}")
    
    # Debug logging
    print(f"🔍 Registration attempt with access_token: {register_data['access_token'][:20]}...")
    
    # Find organization by access token
    org = db.query(Organization).filter(
        Organization.access_token == register_data["access_token"]
    ).first()
    
    if not org:
        raise HTTPException(status_code=400, detail="Invalid access token")
    
    print(f"✅ Found organization: ID={org.id}, Name={org.name}, Slug={org.slug}")
    
    if not org.is_active:
        raise HTTPException(status_code=403, detail="Organization is not active")
    
    # Note: Multiple organization admins are allowed per organization
    
    # Check if email already exists
    if db.query(User).filter(User.email == register_data["email"]).first():
        raise HTTPException(status_code=400, detail="Email already registered")
    
    # Check if username exists within organization
    if db.query(User).filter(
        User.username == register_data["username"],
        User.organization_id == org.id
    ).first():
        raise HTTPException(status_code=400, detail="Username already taken in this organization")
    
    # Create org admin user
    new_user = User(
        username=register_data["username"],
        email=register_data["email"],
        hashed_password=User.hash_password(register_data["password"]),
        full_name=register_data["full_name"],
        role=UserRole.ORG_ADMIN,
        organization_id=org.id,
        is_active=True
    )
    
    print(f"💾 Creating user with organization_id={org.id}")
    
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    
    print(f"✅ User created: ID={new_user.id}, organization_id={new_user.organization_id}")
    
    # Create JWT token
    access_token = create_access_token(
        data={
            "user_id": new_user.id,
            "username": new_user.username,
            "role": new_user.role.value,
            "organization_id": org.id
        }
    )
    
    return TokenResponse(
        access_token=access_token,
        token_type="bearer",
        user={
            "id": new_user.id,
            "username": new_user.username,
            "email": new_user.email,
            "full_name": new_user.full_name,
            "role": new_user.role.value,
            "organization": {
                "id": org.id,
                "name": org.name,
                "slug": org.slug,
                "subscription_plan": org.subscription_plan.value
            }
        }
    )


@app.post("/api/auth/register-user", tags=["Authentication"])
async def register_org_user(register_data: dict, db: Session = Depends(get_db)):
    """Register as regular user within an organization"""
    
    # Debug logging
    print(f"[REGISTER-USER DEBUG] Received payload: {register_data}")
    print(f"[REGISTER-USER DEBUG] Role: {register_data.get('role')}")
    print(f"[REGISTER-USER DEBUG] Assigned Communities: {register_data.get('assigned_communities')}")
    
    # Validate required fields
    required_fields = ["organization_slug", "username", "email", "password", "full_name"]
    for field in required_fields:
        if field not in register_data:
            raise HTTPException(status_code=400, detail=f"Missing required field: {field}")
    
    # Find organization by slug
    org = db.query(Organization).filter(
        Organization.slug == register_data["organization_slug"]
    ).first()
    
    if not org:
        raise HTTPException(status_code=400, detail="Organization not found")
    
    if not org.is_active:
        raise HTTPException(status_code=403, detail="Organization is not active")
    
    # Check user limit
    user_count = db.query(User).filter(User.organization_id == org.id).count()
    if user_count >= org.max_users:
        raise HTTPException(
            status_code=403,
            detail=f"Organization has reached maximum user limit ({org.max_users})"
        )
    
    # Check if email already exists
    if db.query(User).filter(User.email == register_data["email"]).first():
        raise HTTPException(status_code=400, detail="Email already registered")
    
    # Check if username exists within organization
    if db.query(User).filter(
        User.username == register_data["username"],
        User.organization_id == org.id
    ).first():
        raise HTTPException(status_code=400, detail="Username already taken in this organization")
    
    # Determine user role (default to USER)
    user_role = UserRole.USER
    assigned_communities = None
    
    if register_data.get("role"):
        role_value = register_data["role"].upper()
        if role_value in ["USER", "VIEWER", "COMMUNITY_LEAD"]:
            user_role = UserRole[role_value]
    
    print(f"[REGISTER-USER DEBUG] After role check - user_role: {user_role}, has assigned_communities in payload: {register_data.get('assigned_communities')}")
    print(f"[REGISTER-USER DEBUG] Condition check: role is COMMUNITY_LEAD or USER: {user_role == UserRole.COMMUNITY_LEAD or user_role == UserRole.USER}")
    print(f"[REGISTER-USER DEBUG] Condition check: assigned_communities is not empty: {bool(register_data.get('assigned_communities'))}")
    
    # Handle community assignments for community leads and regular users
    if (user_role == UserRole.COMMUNITY_LEAD or user_role in {UserRole.USER, UserRole.VIEWER}) and register_data.get("assigned_communities"):
        import json
        assigned_communities = json.dumps(register_data["assigned_communities"])
        print("[REGISTER-USER DEBUG] ✅ Entering community assignment block")
        print(f"[REGISTER-USER DEBUG] Communities before JSON dump: {register_data.get('assigned_communities')}")
        print(f"[REGISTER-USER DEBUG] Communities after JSON dump: {assigned_communities}")
    else:
        print("[REGISTER-USER DEBUG] ❌ NOT entering community assignment block - assigned_communities will be None")
    
    # Create regular user
    new_user = User(
        username=register_data["username"],
        email=register_data["email"],
        hashed_password=User.hash_password(register_data["password"]),
        full_name=register_data["full_name"],
        role=user_role,
        assigned_communities=assigned_communities,
        organization_id=org.id,
        is_active=True
    )
    
    print(f"[REGISTER-USER DEBUG] New user role: {new_user.role}")
    print(f"[REGISTER-USER DEBUG] New user assigned_communities: {new_user.assigned_communities}")
    
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    
    # Create JWT token
    import json
    access_token = create_access_token(
        data={
            "user_id": new_user.id,
            "username": new_user.username,
            "role": new_user.role.value,
            "organization_id": org.id
        }
    )
    
    assigned_communities_response = json.loads(new_user.assigned_communities) if new_user.assigned_communities else []
    print(f"[REGISTER-USER DEBUG] Response assigned_communities: {assigned_communities_response}")
    
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "id": new_user.id,
            "username": new_user.username,
            "email": new_user.email,
            "full_name": new_user.full_name,
            "role": new_user.role.value,
            "assigned_communities": assigned_communities_response,
            "organization": {
                "id": org.id,
                "name": org.name,
                "slug": org.slug,
                "subscription_plan": org.subscription_plan.value
            }
        }
    }

# Community-specific chat endpoints
@app.post("/api/communities/{community_id}/chat", response_model=ChatResponse, tags=["Communities"])
async def community_chat(
    community_id: str,
    chat_message: ChatMessage,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Chat with community-specific AI agent"""
    
    # Validate community
    valid_communities = ["qa", "backend", "frontend", "design", "product", "devops", "docs"]
    if community_id not in valid_communities:
        raise HTTPException(status_code=404, detail="Community not found")
    
    # Check community access control
    check_community_access(current_user, community_id)
    
    # Get agent for community
    agent = agents.get(community_id)
    if not agent:
        raise HTTPException(status_code=503, detail=f"{community_id.title()} agent not initialized")
    
    # Check organization chat limit
    if current_user.organization_id:
        org = db.query(Organization).filter(Organization.id == current_user.organization_id).first()
        if org:
            chat_count = db.query(ChatSession).filter(
                ChatSession.organization_id == org.id
            ).count()
            if chat_count >= org.max_chat_sessions:
                raise HTTPException(
                    status_code=403,
                    detail=f"Organization has reached maximum chat sessions ({org.max_chat_sessions})"
                )
    
    try:
        # Map community to agent name
        agent_names = {
            "qa": "QualityGPT",
            "backend": "BackendGPT", 
            "frontend": "FrontendGPT",
            "design": "DesignGPT",
            "product": "ProductGPT",
            "devops": "OpsGPT",
            "analyst": "AnalystGPT"  # Changed from "docs": "DocsGPT"
        }
        
        # Extract auth token from request headers
        auth_header = request.headers.get("Authorization", "")
        auth_token = auth_header.replace("Bearer ", "") if auth_header.startswith("Bearer ") else None
        
        # Process message with appropriate agent (pass token if agent supports it)
        if hasattr(agent, 'process_query') and 'auth_token' in agent.process_query.__code__.co_varnames:
            response = agent.process_query(chat_message.message, auth_token=auth_token)
        else:
            response = agent.process_query(chat_message.message)
        
        # Save to database
        chat_session = ChatSession(
            user_id=current_user.id,
            organization_id=current_user.organization_id,
            community=community_id,
            agent_name=agent_names.get(community_id, f"{community_id.title()}GPT"),
            message=chat_message.message,
            response=response
        )
        db.add(chat_session)
        db.commit()
        
        return ChatResponse(
            response=response,
            timestamp=datetime.utcnow().isoformat(),
            agent=agent_names.get(community_id, f"{community_id.title()}GPT")
        )
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing message: {str(e)}")

# AI Model Management Endpoints (GitHub Copilot-style)
@app.get("/api/ai-models", tags=["AI Models"])
async def get_available_models(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get list of available AI models"""
    from core.model_manager import ModelManager
    
    # Get user's subscription plan from organization
    subscription = "free"
    if current_user.organization_id:
        org = db.query(Organization).filter(Organization.id == current_user.organization_id).first()
        if org and org.subscription_plan:
            subscription = org.subscription_plan.value
    
    models = ModelManager.get_available_models()
    
    # Filter models based on subscription
    accessible_models = [
        model for model in models
        if ModelManager.validate_model_access(model["id"], subscription)
    ]
    
    return {
        "models": accessible_models,
        "default": ModelManager.DEFAULT_MODEL,
        "user_preference": current_user.preferred_ai_model or ModelManager.DEFAULT_MODEL,
        "subscription": subscription
    }

@app.get("/api/ai-models/{model_id}", tags=["AI Models"])
async def get_model_info(model_id: str, current_user: User = Depends(get_current_user)):
    """Get detailed information about a specific model"""
    from core.model_manager import ModelManager
    
    model_info = ModelManager.get_model_info(model_id)
    if not model_info:
        raise HTTPException(status_code=404, detail="Model not found")
    
    return model_info

@app.post("/api/user/preferences/model", tags=["User Preferences"])
async def set_preferred_model(
    model_id: str,
    temperature: Optional[float] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Set user's preferred AI model and temperature"""
    from core.model_manager import ModelManager
    
    # Validate model exists
    if model_id not in ModelManager.AVAILABLE_MODELS:
        raise HTTPException(status_code=400, detail="Invalid model ID")
    
    # Check subscription access
    subscription = "free"
    if current_user.organization_id:
        org = db.query(Organization).filter(Organization.id == current_user.organization_id).first()
        if org:
            subscription = org.subscription_plan.value
    
    if not ModelManager.validate_model_access(model_id, subscription):
        raise HTTPException(
            status_code=403,
            detail=f"Model '{model_id}' not available in {subscription} plan. Upgrade to access."
        )
    
    # Update user preferences
    current_user.preferred_ai_model = model_id
    if temperature is not None:
        if not 0.0 <= temperature <= 1.0:
            raise HTTPException(status_code=400, detail="Temperature must be between 0.0 and 1.0")
        
        # Subscription-based temperature limits
        max_temp = 1.0
        if subscription.lower() == "free":
            max_temp = 0.5
        elif subscription.lower() == "basic":
            max_temp = 0.7
        
        if temperature > max_temp:
            raise HTTPException(
                status_code=403,
                detail=f"Temperature limited to {max_temp} for {subscription.upper()} plan. Upgrade for full control."
            )
        
        current_user.ai_temperature = str(temperature)
    
    db.commit()
    
    return {
        "message": "Preferences updated successfully",
        "preferred_model": model_id,
        "temperature": float(current_user.ai_temperature),
        "max_temperature": max_temp if temperature is not None else 1.0,
        "subscription": subscription,
        "model_info": ModelManager.get_model_info(model_id)
    }

@app.get("/api/user/preferences", tags=["User Preferences"])
async def get_user_preferences(
    current_user: User = Depends(get_current_user)
):
    """Get user's AI preferences"""
    return {
        "preferred_model": current_user.preferred_ai_model or "gpt-4o-mini",
        "temperature": float(current_user.ai_temperature) if current_user.ai_temperature else 0.7,
        "theme": current_user.theme_preference or "system"
    }

# Get community examples
@app.get("/api/communities/{community_id}/examples", tags=["Communities"])
async def get_community_examples(
    community_id: str,
    current_user: User = Depends(get_current_user)
):
    """Get example queries for specific community"""
    
    # Check community access control
    check_community_access(current_user, community_id)
    
    examples_data = {
        "qa": {
            "agent": "QualityGPT",
            "examples": [
                {
                    "category": "Generate Tests",
                    "queries": [
                        "Generate a Playwright test for login functionality",
                        "Create a test for adding items to shopping cart",
                        "Generate an API test for user registration"
                    ]
                },
                {
                    "category": "Learn Concepts", 
                    "queries": [
                        "What is Page Object Model?",
                        "Explain test automation best practices",
                        "What are locators and selectors?"
                    ]
                }
            ]
        },
        "backend": {
            "agent": "BackendGPT",
            "examples": [
                {
                    "category": "API Development",
                    "queries": [
                        "Create a REST API for user management",
                        "Design endpoints for e-commerce platform",
                        "Implement GraphQL schema for blog"
                    ]
                },
                {
                    "category": "Database Design",
                    "queries": [
                        "Design database schema for social media app",
                        "Optimize slow MySQL queries",
                        "Implement database migrations with Alembic"
                    ]
                }
            ]
        },
        "frontend": {
            "agent": "FrontendGPT", 
            "examples": [
                {
                    "category": "React Development",
                    "queries": [
                        "Create a reusable React component library",
                        "Implement state management with Redux",
                        "Build responsive navigation component"
                    ]
                },
                {
                    "category": "Mobile Development",
                    "queries": [
                        "Create React Native navigation stack",
                        "Implement push notifications in Flutter",
                        "Build cross-platform form component"
                    ]
                }
            ]
        },
        "design": {
            "agent": "DesignGPT",
            "examples": [
                {
                    "category": "Design Systems", 
                    "queries": [
                        "Create a comprehensive button component library",
                        "Design consistent color palette for brand",
                        "Build accessible form design patterns"
                    ]
                },
                {
                    "category": "User Experience",
                    "queries": [
                        "Design onboarding flow for SaaS app",
                        "Create user journey for e-commerce checkout",
                        "Improve mobile app navigation UX"
                    ]
                }
            ]
        },
        "product": {
            "agent": "ProductGPT",
            "examples": [
                {
                    "category": "Requirements",
                    "queries": [
                        "Write product requirements for chat feature",
                        "Create acceptance criteria for user login",
                        "Define API specifications for mobile app"
                    ]
                },
                {
                    "category": "Strategy",
                    "queries": [
                        "Plan Q1 product roadmap for SaaS platform",
                        "Define success metrics for new feature",
                        "Create competitive analysis framework"
                    ]
                }
            ]
        },
        "devops": {
            "agent": "OpsGPT",
            "examples": [
                {
                    "category": "CI/CD",
                    "queries": [
                        "Set up GitHub Actions pipeline for Node.js",
                        "Create Docker deployment for React app",
                        "Implement automated testing in CI pipeline"
                    ]
                },
                {
                    "category": "Infrastructure",
                    "queries": [
                        "Deploy scalable architecture on AWS",
                        "Set up Kubernetes cluster monitoring",
                        "Implement infrastructure as code with Terraform"
                    ]
                }
            ]
        },
        "analyst": {
            "agent": "AnalystGPT",
            "examples": [
                {
                    "category": "Requirements Analysis",
                    "queries": [
                        "Analyze business requirements for CRM system",
                        "Create functional specification document",
                        "Define user stories with acceptance criteria"
                    ]
                },
                {
                    "category": "Process Optimization",
                    "queries": [
                        "Map current business process workflow",
                        "Identify bottlenecks in sales process",
                        "Design improved customer onboarding flow"
                    ]
                }
            ]
        }
    }
    
    if community_id not in examples_data:
        raise HTTPException(status_code=404, detail="Community not found")
    
    return examples_data[community_id]

# Health check
@app.get("/api/health", tags=["Health"])
async def health_check():
    """Health check endpoint"""
    agent_status = {name: agent is not None for name, agent in agents.items()}
    all_healthy = all(agent_status.values())
    
    return {
        "status": "healthy" if all_healthy else "partial",
        "agents": agent_status,
        "timestamp": datetime.now().isoformat()
    }

# ==================== ORGANIZATION MANAGEMENT APIs ====================

@app.post("/api/organizations", status_code=201, tags=["Organizations"])
async def create_organization(
    org_data: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_super_admin_user)
):
    """Create a new organization (Super Admin only)"""
    required_fields = ["name", "slug"]
    for field in required_fields:
        if field not in org_data:
            raise HTTPException(status_code=400, detail=f"Missing required field: {field}")
    
    # Check if slug already exists
    if db.query(Organization).filter(Organization.slug == org_data["slug"]).first():
        raise HTTPException(status_code=400, detail="Organization slug already exists")
    
    # Validate subscription plan
    subscription_plan = org_data.get("subscription_plan", "free").upper()
    try:
        plan = SubscriptionPlan[subscription_plan]
    except KeyError:
        raise HTTPException(status_code=400, detail="Invalid subscription plan")
    
    new_org = Organization(
        name=org_data["name"],
        slug=org_data["slug"],
        description=org_data.get("description"),
        subscription_plan=plan,
        max_users=org_data.get("max_users", 10),
        max_chat_sessions=org_data.get("max_chat_sessions", 1000),
        access_token=Organization.generate_access_token(),
        is_active=True
    )
    
    db.add(new_org)
    db.commit()
    db.refresh(new_org)
    
    return {
        "id": new_org.id,
        "name": new_org.name,
        "slug": new_org.slug,
        "subscription_plan": new_org.subscription_plan.value,
        "access_token": new_org.access_token,
        "created_at": new_org.created_at.isoformat()
    }


@app.get("/api/organizations", tags=["Organizations"])
async def list_organizations(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_super_admin_user),
    skip: int = 0,
    limit: int = 100
):
    """List all organizations (Super Admin only)"""
    orgs = db.query(Organization).offset(skip).limit(limit).all()
    
    result = []
    for org in orgs:
        user_count = db.query(User).filter(User.organization_id == org.id).count()
        chat_count = db.query(ChatSession).filter(ChatSession.organization_id == org.id).count()
        
        result.append({
            "id": org.id,
            "name": org.name,
            "slug": org.slug,
            "description": org.description,
            "subscription_plan": org.subscription_plan.value,
            "is_active": org.is_active,
            "user_count": user_count,
            "chat_count": chat_count,
            "max_users": org.max_users,
            "max_chat_sessions": org.max_chat_sessions,
            "access_token": org.access_token,
            "created_at": org.created_at.isoformat()
        })
    
    return result


@app.get("/api/organizations/my-organization", tags=["Organizations"])
async def get_my_organization(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get current user's organization info"""
    if not current_user.organization_id:
        return {"message": "User not associated with any organization"}
    
    org = db.query(Organization).filter(Organization.id == current_user.organization_id).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    
    user_count = db.query(User).filter(User.organization_id == org.id).count()
    chat_count = db.query(ChatSession).filter(ChatSession.organization_id == org.id).count()
    
    return {
        "id": org.id,
        "name": org.name,
        "slug": org.slug,
        "description": org.description,
        "subscription_plan": org.subscription_plan.value,
        "primary_color": org.primary_color,
        "logo_url": org.logo_url,
        "user_count": user_count,
        "chat_count": chat_count,
        "max_users": org.max_users,
        "max_chat_sessions": org.max_chat_sessions,
        "is_active": org.is_active
    }


@app.get("/api/organizations/{org_id}", tags=["Organizations"])
async def get_organization(
    org_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_super_admin_user)
):
    """Get organization by ID (Super Admin only)"""
    org = db.query(Organization).filter(Organization.id == org_id).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    
    user_count = db.query(User).filter(User.organization_id == org.id).count()
    chat_count = db.query(ChatSession).filter(ChatSession.organization_id == org.id).count()
    
    return {
        "id": org.id,
        "name": org.name,
        "slug": org.slug,
        "description": org.description,
        "subscription_plan": org.subscription_plan.value,
        "max_users": org.max_users,
        "max_chat_sessions": org.max_chat_sessions,
        "primary_color": org.primary_color,
        "logo_url": org.logo_url,
        "is_active": org.is_active,
        "access_token": org.access_token,
        "user_count": user_count,
        "chat_count": chat_count,
        "created_at": org.created_at.isoformat(),
        "updated_at": org.updated_at.isoformat()
    }


@app.put("/api/organizations/{org_id}", tags=["Organizations"])
async def update_organization(
    org_id: int,
    org_data: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_org_admin_user)
):
    """Update organization (Org Admin or Super Admin)"""
    org = db.query(Organization).filter(Organization.id == org_id).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    
    # Verify user has permission to update this org
    if current_user.role != UserRole.SUPER_ADMIN:
        if current_user.organization_id != org_id:
            raise HTTPException(status_code=403, detail="Not authorized to update this organization")
    
    # Update fields
    if "name" in org_data:
        org.name = org_data["name"]
    if "description" in org_data:
        org.description = org_data["description"]
    if "subscription_plan" in org_data:
        try:
            org.subscription_plan = SubscriptionPlan[org_data["subscription_plan"].upper()]
        except KeyError:
            raise HTTPException(status_code=400, detail="Invalid subscription plan")
    if "max_users" in org_data:
        org.max_users = org_data["max_users"]
    if "max_chat_sessions" in org_data:
        org.max_chat_sessions = org_data["max_chat_sessions"]
    if "is_active" in org_data:
        org.is_active = org_data["is_active"]
    if "primary_color" in org_data:
        org.primary_color = org_data["primary_color"]
    if "logo_url" in org_data:
        org.logo_url = org_data["logo_url"]
    
    db.commit()
    db.refresh(org)
    
    return {"message": "Organization updated successfully", "id": org.id}


@app.patch("/api/organizations/{org_id}/subscription", tags=["Organizations"])
async def update_subscription_plan(
    org_id: int,
    plan_data: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_super_admin_user)
):
    """Update organization subscription plan (Super Admin only)"""
    org = db.query(Organization).filter(Organization.id == org_id).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    
    # Validate subscription plan
    plan_name = plan_data.get("subscription_plan", "").upper()
    if plan_name not in ["FREE", "SMALL_BUSINESS", "ENTERPRISE"]:
        raise HTTPException(status_code=400, detail="Invalid subscription plan. Must be: FREE, SMALL_BUSINESS, or ENTERPRISE")
    
    # Update subscription plan
    old_plan = org.subscription_plan.value
    org.subscription_plan = SubscriptionPlan[plan_name]
    
    # Auto-update limits based on plan
    plan_limits = {
        "FREE": {"max_users": 10, "max_chat_sessions": 1000},
        "SMALL_BUSINESS": {"max_users": 20, "max_chat_sessions": 5000},
        "ENTERPRISE": {"max_users": 100, "max_chat_sessions": 50000}
    }
    
    limits = plan_limits.get(plan_name, plan_limits["FREE"])
    org.max_users = limits["max_users"]
    org.max_chat_sessions = limits["max_chat_sessions"]
    
    db.commit()
    db.refresh(org)
    
    return {
        "message": "Subscription plan updated successfully",
        "organization": org.name,
        "old_plan": old_plan,
        "new_plan": org.subscription_plan.value,
        "max_users": org.max_users,
        "max_chat_sessions": org.max_chat_sessions
    }


@app.delete("/api/organizations/{org_id}", tags=["Organizations"])
async def delete_organization(
    org_id: int,
    request_data: OrgActionWithTwoFARequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_super_admin_user)
):
    """Delete organization (Super Admin only) - requires 2FA if enabled"""
    org = db.query(Organization).filter(Organization.id == org_id).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    
    # Check 2FA requirement for super admin
    if current_user.two_fa_enabled:
        if not request_data.two_fa_code:
            raise HTTPException(status_code=403, detail="2FA code is required for sensitive operations")
        
        # Verify the TOTP code
        totp = pyotp.TOTP(current_user.two_fa_secret)
        if not totp.verify(request_data.two_fa_code, valid_window=1):
            raise HTTPException(status_code=401, detail="Invalid 2FA code")
    
    # Delete all users in organization
    db.query(User).filter(User.organization_id == org_id).delete()
    
    # Delete all chat sessions
    db.query(ChatSession).filter(ChatSession.organization_id == org_id).delete()
    
    # Delete organization
    db.delete(org)
    db.commit()
    
    return {"message": "Organization deleted successfully"}


@app.get("/api/organizations/{org_id}/users", tags=["Organizations"])
async def list_organization_users(
    org_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_org_admin_user)
):
    """List all users in an organization"""
    # Verify user has permission
    if current_user.role != UserRole.SUPER_ADMIN:
        if current_user.organization_id != org_id:
            raise HTTPException(status_code=403, detail="Not authorized")
    
    users = db.query(User).filter(User.organization_id == org_id).all()
    
    import json
    return [{
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "full_name": user.full_name,
        "role": user.role.value,
        "assigned_communities": json.loads(user.assigned_communities) if user.assigned_communities else [],
        "is_active": user.is_active,
        "two_fa_enabled": user.two_fa_enabled,
        "created_at": user.created_at.isoformat(),
        "last_login": user.last_login.isoformat() if user.last_login else None
    } for user in users]


@app.post("/api/organizations/{org_id}/users", tags=["Organizations"])
async def create_organization_user(
    org_id: int,
    user_data: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_org_admin_user)
):
    """Create a new user in an organization (Org Admin or Super Admin)"""
    # Verify user has permission
    if current_user.role != UserRole.SUPER_ADMIN:
        if current_user.organization_id != org_id:
            raise HTTPException(status_code=403, detail="Not authorized to create users in this organization")
    
    # Get organization
    org = db.query(Organization).filter(Organization.id == org_id).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    
    if not org.is_active:
        raise HTTPException(status_code=403, detail="Organization is not active")
    
    # Check user limit
    user_count = db.query(User).filter(User.organization_id == org_id).count()
    if user_count >= org.max_users:
        raise HTTPException(
            status_code=403,
            detail=f"Organization has reached maximum user limit ({org.max_users})"
        )
    
    # Validate required fields
    required_fields = ["username", "email", "password", "full_name"]
    for field in required_fields:
        if field not in user_data or not user_data[field]:
            raise HTTPException(status_code=400, detail=f"Missing required field: {field}")
    
    # Check if email already exists
    if db.query(User).filter(User.email == user_data["email"]).first():
        raise HTTPException(status_code=400, detail="Email already registered")
    
    # Check if username exists within organization
    if db.query(User).filter(
        User.username == user_data["username"],
        User.organization_id == org_id
    ).first():
        raise HTTPException(status_code=400, detail="Username already taken in this organization")
    
    # Determine user role
    user_role = UserRole.USER
    assigned_communities = None
    
    if current_user.role == UserRole.SUPER_ADMIN or current_user.role == UserRole.ORG_ADMIN:
        # Super admins and org admins can specify role
        if user_data.get("role"):
            role_value = user_data["role"].upper()
            if role_value in ["ORG_ADMIN", "COMMUNITY_LEAD", "USER", "VIEWER"]:
                user_role = UserRole[role_value]
        
        # Handle community assignments for community leads and regular users
        if (user_role == UserRole.COMMUNITY_LEAD or user_role in {UserRole.USER, UserRole.VIEWER}) and user_data.get("assigned_communities"):
            import json
            assigned_communities = json.dumps(user_data["assigned_communities"])
        
        # Only super admins can create org admins
        if user_role == UserRole.ORG_ADMIN and current_user.role != UserRole.SUPER_ADMIN:
            raise HTTPException(status_code=403, detail="Only super admins can create org admins")
    
    # Create new user
    new_user = User(
        username=user_data["username"],
        email=user_data["email"],
        hashed_password=User.hash_password(user_data["password"]),
        full_name=user_data["full_name"],
        role=user_role,
        assigned_communities=assigned_communities,
        organization_id=org_id,
        is_active=True
    )
    
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    
    import json
    return {
        "message": "User created successfully",
        "user": {
            "id": new_user.id,
            "username": new_user.username,
            "email": new_user.email,
            "full_name": new_user.full_name,
            "role": new_user.role.value,
            "assigned_communities": json.loads(new_user.assigned_communities) if new_user.assigned_communities else [],
            "organization_id": new_user.organization_id,
            "is_active": new_user.is_active
        }
    }


@app.patch("/api/organizations/{org_id}/users/{user_id}", tags=["Organizations"])
async def update_organization_user(
    org_id: int,
    user_id: int,
    user_data: dict = Body(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_org_admin_user)
):
    """Update a user's role and assigned communities (Org Admin or Super Admin)"""
    try:
        # Debug: Log the received data
        print(f"[PATCH DEBUG] Received user_data: {user_data}")
        print(f"[PATCH DEBUG] Password field: {user_data.get('password', 'NOT PROVIDED')}")
        print(f"[PATCH DEBUG] Password length: {len(user_data.get('password', '')) if user_data.get('password') else 'N/A'}")
        
        # Verify user has permission
        if current_user.role != UserRole.SUPER_ADMIN:
            if current_user.organization_id != org_id:
                raise HTTPException(status_code=403, detail="Not authorized to update users in this organization")
        
        # Get user - Super admins can update any user, org admins only their org's users
        if current_user.role == UserRole.SUPER_ADMIN:
            user = db.query(User).filter(User.id == user_id).first()
        else:
            user = db.query(User).filter(User.id == user_id, User.organization_id == org_id).first()
        
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        # Update role if provided
        if user_data.get("role"):
            role_value = user_data["role"].upper()
            if role_value in ["ORG_ADMIN", "COMMUNITY_LEAD", "USER"]:
                new_role = UserRole[role_value]
                
                # Only super admins can create/update org admins
                if new_role == UserRole.ORG_ADMIN and current_user.role != UserRole.SUPER_ADMIN:
                    raise HTTPException(status_code=403, detail="Only super admins can create org admins")
                
                user.role = new_role
        
        # Update assigned communities for community leads and regular users
        if user_data.get("assigned_communities") is not None:
            if user.role == UserRole.COMMUNITY_LEAD or user.role in {UserRole.USER, UserRole.VIEWER}:
                import json
                user.assigned_communities = json.dumps(user_data["assigned_communities"])
            else:
                # Org admins and super admins don't have assigned communities
                user.assigned_communities = None
        
        # Update other fields if provided
        if user_data.get("full_name"):
            user.full_name = user_data["full_name"]
        
        if user_data.get("username"):
            user.username = user_data["username"]
        
        if user_data.get("email"):
            user.email = user_data["email"]
        
        if user_data.get("password"):
            # bcrypt has a 72-byte limit for passwords
            password = user_data["password"]
            password_bytes = password.encode('utf-8') if isinstance(password, str) else password
            password_len = len(password_bytes)
            print(f"[PATCH DEBUG] Password bytes length: {password_len}, Password type: {type(password)}")
            print(f"[PATCH DEBUG] About to hash password: '{password}'")
            print(f"[PATCH DEBUG] Current user hashed_password type: {type(user.hashed_password)}, length: {len(user.hashed_password) if user.hashed_password else 'None'}")
            
            if password_len > 72:
                raise HTTPException(
                    status_code=400,
                    detail=f"Password cannot exceed 72 bytes when encoded as UTF-8. Current length: {password_len} bytes"
                )
            try:
                user.hashed_password = pwd_context.hash(password)
                print("[PATCH DEBUG] Password hashed successfully")
            except ValueError as e:
                print(f"[PATCH DEBUG] pwd_context.hash() raised ValueError: {e}")
                raise
        
        if user_data.get("is_active") is not None:
            user.is_active = user_data["is_active"]
        
        # Update organization for org admins (super admin only)
        if user_data.get("organization_id") and current_user.role == UserRole.SUPER_ADMIN:
            if user.role == UserRole.ORG_ADMIN or user_data.get("role") == "org_admin":
                user.organization_id = user_data["organization_id"]
        
        db.commit()
        db.refresh(user)
        
        import json
        return {
            "message": "User updated successfully",
            "user": {
                "id": user.id,
                "username": user.username,
                "email": user.email,
                "full_name": user.full_name,
                "role": user.role.value,
                "assigned_communities": json.loads(user.assigned_communities) if user.assigned_communities else [],
                "organization_id": user.organization_id,
                "is_active": user.is_active
            }
        }
    except HTTPException:
        # Re-raise HTTPException without wrapping it
        raise
    except ValueError as e:
        error_msg = str(e)
        print(f"[PATCH ERROR] ValueError: {error_msg}")
        raise HTTPException(
            status_code=400,
            detail=f"Invalid data: {error_msg}"
        )
    except Exception as e:
        error_msg = str(e)
        print(f"[PATCH ERROR] Unexpected error: {error_msg}")
        raise HTTPException(
            status_code=500,
            detail=f"Internal server error: {error_msg}"
        )


@app.delete("/api/organizations/{org_id}/users/{user_id}", tags=["Organizations"])
async def delete_organization_user(
    org_id: int,
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_super_admin_user)
):
    """Delete a user from an organization (Super Admin only)"""
    # Get user
    user = db.query(User).filter(User.id == user_id, User.organization_id == org_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Prevent deleting super admins
    if user.role == UserRole.SUPER_ADMIN:
        raise HTTPException(status_code=403, detail="Cannot delete super admin users")
    
    # Prevent deleting yourself
    if user.id == current_user.id:
        raise HTTPException(status_code=403, detail="Cannot delete yourself")
    
    username = user.username
    
    # Delete user's chat sessions first (cascade)
    db.query(ChatSession).filter(ChatSession.user_id == user_id).delete()
    
    # Delete user
    db.delete(user)
    db.commit()
    
    return {
        "message": "User deleted successfully",
        "username": username
    }


@app.patch("/api/organizations/{org_id}/block", tags=["Organizations"])
async def block_organization(
    org_id: int,
    request_data: OrgActionWithTwoFARequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_super_admin_user)
):
    """Block an organization (Super Admin only) - requires 2FA if enabled"""
    org = db.query(Organization).filter(Organization.id == org_id).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    
    if org.id == 1:
        raise HTTPException(status_code=403, detail="Cannot block default organization")
    
    # Check 2FA requirement for super admin
    if current_user.two_fa_enabled:
        if not request_data.two_fa_code:
            raise HTTPException(status_code=403, detail="2FA code is required for sensitive operations")
        
        # Verify the TOTP code
        totp = pyotp.TOTP(current_user.two_fa_secret)
        if not totp.verify(request_data.two_fa_code, valid_window=1):
            raise HTTPException(status_code=401, detail="Invalid 2FA code")
    
    org.is_active = False
    db.commit()
    db.refresh(org)
    
    return {
        "message": "Organization blocked successfully",
        "organization": {
            "id": org.id,
            "name": org.name,
            "is_active": org.is_active
        }
    }


@app.patch("/api/organizations/{org_id}/unblock", tags=["Organizations"])
async def unblock_organization(
    org_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_super_admin_user)
):
    """Unblock an organization (Super Admin only)"""
    org = db.query(Organization).filter(Organization.id == org_id).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    
    org.is_active = True
    db.commit()
    db.refresh(org)
    
    return {
        "message": "Organization unblocked successfully",
        "organization": {
            "id": org.id,
            "name": org.name,
            "is_active": org.is_active
        }
    }


@app.get("/api/organizations/{org_id}/stats", tags=["Organizations"])
async def get_organization_stats(
    org_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_org_admin_user)
):
    """Get organization statistics"""
    # Verify user has permission
    if current_user.role != UserRole.SUPER_ADMIN:
        if current_user.organization_id != org_id:
            raise HTTPException(status_code=403, detail="Not authorized")
    
    org = db.query(Organization).filter(Organization.id == org_id).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    
    total_users = db.query(User).filter(User.organization_id == org_id).count()
    active_users = db.query(User).filter(
        User.organization_id == org_id,
        User.is_active
    ).count()
    total_chats = db.query(ChatSession).filter(ChatSession.organization_id == org_id).count()
    
    admin_count = db.query(User).filter(
        User.organization_id == org_id,
        User.role == UserRole.ORG_ADMIN
    ).count()
    
    return {
        "organization_name": org.name,
        "subscription_plan": org.subscription_plan.value,
        "total_users": total_users,
        "active_users": active_users,
        "inactive_users": total_users - active_users,
        "admin_count": admin_count,
        "total_chats": total_chats,
        "max_users": org.max_users,
        "max_chat_sessions": org.max_chat_sessions,
        "usage_percentage": {
            "users": round((total_users / org.max_users) * 100, 2) if org.max_users > 0 else 0,
            "chats": round((total_chats / org.max_chat_sessions) * 100, 2) if org.max_chat_sessions > 0 else 0
        }
    }

# ==================== FEATURE FLAGS & SUBSCRIPTION APIS ====================

@app.get("/api/features", tags=["Features"])
async def get_user_features_endpoint(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get all features available to current user based on subscription plan"""
    from core.feature_gates import get_user_features
    return get_user_features(current_user, db)


@app.get("/api/features/compare", tags=["Features"])
async def compare_subscription_plans():
    """Get feature comparison across all subscription plans"""
    from core.feature_flags import compare_plans
    return {
        "plans": ["free", "small_business", "enterprise"],
        "features": compare_plans()
    }


@app.get("/api/subscription-plans", tags=["Subscriptions"])
async def get_subscription_plans():
    """Get all available subscription plans with their limits and features"""
    from core.feature_flags import (
        FEATURE_DESCRIPTIONS,
        PLAN_LIMITS,
        compare_plans,
        get_plan_features,
    )
    
    plans_info = {}
    for plan_name in ["free", "small_business", "enterprise"]:
        features = get_plan_features(plan_name)
        limits = PLAN_LIMITS.get(plan_name, {})
        
        plans_info[plan_name] = {
            "name": plan_name.replace("_", " ").title(),
            "limits": limits,
            "features": [
                {
                    "id": f.value,
                    "name": f.value.replace("_", " ").title(),
                    "description": FEATURE_DESCRIPTIONS.get(f, "")
                }
                for f in features
            ],
            "feature_count": len(features)
        }
    
    return {
        "plans": plans_info,
        "comparison": compare_plans()
    }


@app.post("/api/features/{feature_name}/check", tags=["Features"])
async def check_feature_access_endpoint(
    feature_name: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Check if current user has access to a specific feature"""
    from core.feature_flags import Feature, has_feature
    
    # Convert feature_name to Feature enum
    try:
        feature = Feature[feature_name.upper()]
    except KeyError:
        raise HTTPException(status_code=400, detail=f"Invalid feature name: {feature_name}")
    
    if not current_user.organization_id:
        return {
            "has_access": False,
            "reason": "No organization membership"
        }
    
    org = db.query(Organization).filter(
        Organization.id == current_user.organization_id
    ).first()
    
    if not org:
        return {
            "has_access": False,
            "reason": "Organization not found"
        }
    
    subscription_plan = org.subscription_plan.value
    has_access = has_feature(subscription_plan, feature)
    
    return {
        "feature": feature_name,
        "has_access": has_access,
        "subscription_plan": subscription_plan,
        "organization": org.name
    }


if __name__ == "__main__":
    import uvicorn
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "8002"))
    print(f"🚀 Starting backend on {host}:{port}")
    uvicorn.run(app, host=host, port=port)
