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

from api import ai_routes, project_routes, settings_routes
from core.auth import (
    authenticate_user,
    create_access_token,
    get_current_user,
    get_org_admin_user,
    get_super_admin_user,
    pwd_context,
)

# Import core modules
from core.database import (
    Organization,
    User,
    UserRole,
    get_db,
    get_default_organization,
    init_db,
)

# Initialize rate limiter
limiter = Limiter(key_func=get_remote_address)

# Initialize FastAPI app
app = FastAPI(
    title="ATM API",
    description="AutomationTestManager: run, review and report automated tests.",
    version="3.0.0",
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
app.include_router(settings_routes.router, prefix="/api")

# Jira/Confluence/GitHub/Zephyr settings (incl. Jira project search) and mobile
# device management exist only in the v1 app; expose them here too so the
# frontend's /api/settings/* and /api/devices/* calls work.
from app.api.v1.endpoints import devices as v1_devices_routes
from app.api.v1.endpoints import settings as v1_settings_routes

app.include_router(v1_settings_routes.router, prefix="/api/settings", tags=["settings"])
app.include_router(v1_devices_routes.router, prefix="/api/devices", tags=["devices"])

@app.on_event("startup")
async def startup_event():
    """Initialize the database and resume running executions on startup"""
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
    
# Pydantic models
class LoginRequest(BaseModel):
    username: str
    password: str

class RegisterRequest(BaseModel):
    username: str
    email: EmailStr
    password: str
    full_name: Optional[str] = None

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

class Login2FARequest(BaseModel):
    username: str
    password: str
    totp_code: str  # 6-digit TOTP code for 2FA

class TokenResponse(BaseModel):
    access_token: str
    token_type: str
    user: dict
    requires_2fa: Optional[bool] = False  # Indicates if 2FA is required

# Authentication endpoints
@app.post("/api/auth/login", response_model=TokenResponse, tags=["Authentication"])
@limiter.limit("5/minute")  # Max 5 login attempts per minute per IP
async def login(request: Request, login_data: LoginRequest, response: Response, db: Session = Depends(get_db)):
    """Login with username or email and password"""
    client_ip = request.client.host if request.client else "unknown"
    
    # Log login attempt
    logger.info(f"Login attempt - Username: {login_data.username}, IP: {client_ip}")
    
    user = authenticate_user(
        db, 
        login_data.username, 
        login_data.password,
    )
    
    if not user:
        # Log failed login
        logger.warning(f"Failed login - Username: {login_data.username}, IP: {client_ip}, Reason: Invalid credentials")
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    
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
            "slug": user.organization.slug
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
            "slug": user.organization.slug
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
                "slug": org.slug
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
    
    # Delete the user
    db.delete(current_user)
    db.commit()
    
    return {
        "message": "Account deleted successfully"
    }

@app.post("/api/auth/register", response_model=TokenResponse, tags=["Authentication"])
async def register(register_data: RegisterRequest, db: Session = Depends(get_db)):
    """Register a new user"""
    # Check if email exists
    if db.query(User).filter(User.email == register_data.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")

    organization_id = get_default_organization(db).id

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
            "slug": new_user.organization.slug
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

# Health check
@app.get("/api/health", tags=["Health"])
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "timestamp": datetime.now().isoformat()}


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
    
    # Delete user
    db.delete(user)
    db.commit()
    
    return {
        "message": "User deleted successfully",
        "username": username
    }



if __name__ == "__main__":
    import uvicorn
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "8002"))
    print(f"🚀 Starting backend on {host}:{port}")
    uvicorn.run(app, host=host, port=port)
