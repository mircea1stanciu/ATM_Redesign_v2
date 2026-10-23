"""
Authentication utilities for UnifiedWork
JWT token management and user authentication
"""
import os
from datetime import datetime, timedelta
from typing import Optional

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from .database import get_db

# JWT Configuration
SECRET_KEY = os.getenv("SECRET_KEY", "unifiedwork-secret-key-change-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30

# Password hashing
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Security scheme
security = HTTPBearer()


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    """Create JWT access token"""
    to_encode = data.copy()
    # Mirror app.core.security's claims so the v1 routers mounted in main.py
    # (which read "sub"/"type") accept tokens issued by this legacy backend.
    if to_encode.get("user_id") is not None:
        to_encode.setdefault("sub", str(to_encode["user_id"]))
        to_encode.setdefault("type", "access")
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


def verify_token(token: str) -> Optional[dict]:
    """Verify and decode JWT token"""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except JWTError:
        return None


def authenticate_user(db: Session, username: str, password: str, organization_slug: Optional[str] = None):
    """Authenticate user with optional organization context"""
    from .database import Organization, User
    
    # Build query
    query = db.query(User).filter(
        (User.username == username) | (User.email == username)
    )
    
    # Filter by organization if specified
    if organization_slug:
        org = db.query(Organization).filter(Organization.slug == organization_slug).first()
        if not org:
            return None
        query = query.filter(User.organization_id == org.id)
    
    user = query.first()
    
    if not user or not user.verify_password(password):
        return None
    
    if not user.is_active:
        return None
    
    return user


def get_organization_from_subdomain(slug: str, db: Session):
    """Get organization by slug/subdomain"""
    from .database import Organization
    return db.query(Organization).filter(Organization.slug == slug).first()


def get_current_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: Session = Depends(get_db)
):
    """Get current authenticated user from JWT token (cookie or header)"""
    from .database import User
    
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    
    # Try to get token from cookie first, then fall back to Authorization header
    token = request.cookies.get("access_token")
    if not token and credentials:
        token = credentials.credentials
    
    if not token:
        raise credentials_exception
    
    try:
        payload = verify_token(token)
        if payload is None:
            raise credentials_exception
            
        user_id: int = payload.get("user_id")
        if user_id is None:
            raise credentials_exception
            
    except JWTError:
        raise credentials_exception
    
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise credentials_exception
    
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Inactive user"
        )
    
    return user


def get_org_admin_user(current_user = Depends(get_current_user)):
    """Require ORG_ADMIN or SUPER_ADMIN role"""
    from .database import UserRole
    
    if current_user.role not in [UserRole.ORG_ADMIN, UserRole.SUPER_ADMIN]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not enough permissions"
        )
    return current_user


def get_community_lead_user(current_user = Depends(get_current_user)):
    """Require COMMUNITY_LEAD, ORG_ADMIN, or SUPER_ADMIN role"""
    from .database import UserRole
    
    if current_user.role not in [UserRole.COMMUNITY_LEAD, UserRole.ORG_ADMIN, UserRole.SUPER_ADMIN]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Community lead access required"
        )
    return current_user


def get_super_admin_user(current_user = Depends(get_current_user)):
    """Require SUPER_ADMIN role"""
    from .database import UserRole
    
    if current_user.role != UserRole.SUPER_ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Super admin access required"
        )
    return current_user
