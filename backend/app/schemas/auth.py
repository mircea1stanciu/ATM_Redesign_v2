from datetime import datetime
from typing import Optional, Union
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr


class UserCreate(BaseModel):
    email: EmailStr
    password: str
    full_name: Optional[str] = None


class AdminCreateUser(BaseModel):
    """Schema for admin/super_admin creating users"""
    email: EmailStr
    password: str
    full_name: str
    role: str = "user"  # Default role, can be overridden


class LoginRequest(BaseModel):
    """Schema for user login"""
    email: EmailStr
    password: str


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RefreshTokenRequest(BaseModel):
    refresh_token: str


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    
    id: Union[int, UUID]  # Support both Integer and UUID
    email: str
    full_name: Optional[str] = None
    role: str
    assigned_lead_id: Optional[str] = None
    assigned_lead_name: Optional[str] = None
    is_active: bool
    created_at: datetime
    assigned_communities: Optional[list] = None
    organization: Optional[dict] = None
