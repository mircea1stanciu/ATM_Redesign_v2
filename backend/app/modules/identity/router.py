"""Sign-in, two-factor authentication, profile and user management endpoints."""
import base64
import io
import json
import logging
from datetime import datetime
from typing import Optional

import pyotp
import qrcode
from fastapi import APIRouter, Depends, HTTPException, Request, Response, UploadFile
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import get_current_user
from app.core.rate_limit import limiter
from app.core.security import create_access_token, pwd_context
from app.modules.identity.models import User, UserRole
from app.modules.identity.service import authenticate_user, get_default_organization
from app.modules.identity.users_router import me_payload

logger = logging.getLogger("atm.auth")
router = APIRouter()


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
@router.post("/api/auth/login", response_model=TokenResponse, tags=["Authentication"])
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

@router.post("/api/auth/login/verify-2fa", response_model=TokenResponse, tags=["Authentication"])
@limiter.limit("5/minute")  # Max 5 verification attempts per minute per IP
async def login_verify_2fa(
    request: Request, login_data: Login2FARequest, response: Response, db: Session = Depends(get_db)
):
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
        logger.warning(
            f"Failed 2FA verification - Username: {login_data.username}, IP: {client_ip}, Reason: Invalid credentials"
        )
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    # Check if user has 2FA enabled
    if not user.two_fa_enabled:
        raise HTTPException(status_code=400, detail="2FA is not enabled for this user")
    
    # Verify the TOTP code
    if not user.two_fa_secret:
        raise HTTPException(status_code=500, detail="2FA secret not found")
    
    totp = pyotp.TOTP(user.two_fa_secret)
    if not totp.verify(login_data.totp_code, valid_window=1):
        logger.warning(
            f"Failed 2FA verification - Username: {login_data.username}, IP: {client_ip}, Reason: Invalid TOTP code"
        )
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

@router.post("/api/auth/logout", tags=["Authentication"])
async def logout(response: Response):
    """Logout by clearing the HTTPOnly cookie"""
    response.delete_cookie(key="access_token")
    return {"message": "Logged out successfully"}

@router.get("/api/auth/me", tags=["Authentication"])
async def get_current_user_info(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Same as /api/me (kept for existing clients)."""
    return me_payload(db, current_user)


@router.post("/api/auth/change-password", tags=["Authentication"])
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

@router.put("/api/auth/profile", tags=["Authentication"])
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

@router.post("/api/auth/2fa/setup", response_model=Enable2FAResponse, tags=["Authentication"])
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

@router.post("/api/auth/2fa/enable", tags=["Authentication"])
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

@router.post("/api/auth/2fa/disable", tags=["Authentication"])
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

@router.get("/api/auth/2fa/status", tags=["Authentication"])
async def get_2fa_status(
    current_user: User = Depends(get_current_user)
):
    """Get 2FA status for current user"""
    return {
        "enabled": current_user.two_fa_enabled,
        "user_id": current_user.id
    }

@router.post("/api/auth/profile/picture", tags=["Authentication"])
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

@router.delete("/api/auth/profile/picture", tags=["Authentication"])
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

@router.post("/api/auth/delete-account", tags=["Authentication"])
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

@router.post("/api/auth/register", response_model=TokenResponse, tags=["Authentication"])
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
        role=UserRole.VIEWER,  # self-registered people see nothing until a lead assigns a role and projects
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
