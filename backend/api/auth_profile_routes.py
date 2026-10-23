"""
User profile management endpoints (change password, update profile, profile
picture, delete account).

Ported from the legacy ``backend/main.py`` so the extended ``app.main`` backend
(served at ``/api/v1``) exposes the same profile-management contract the
frontend expects. Uses the synchronous ``core.database`` session and
``core.auth`` dependency, which coexist with the async ``app`` routers (FastAPI
runs sync dependencies in a threadpool).
"""
from typing import Optional

import pyotp
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from api.sync_auth import get_current_user
from core.database import ChatSession, User, get_db, pwd_context

router = APIRouter(tags=["Profile"])


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


def _verify_2fa(user: User, code: Optional[str]) -> None:
    """Raise if the user has 2FA enabled and the supplied code is missing/invalid."""
    if not user.two_fa_enabled:
        return
    if not code:
        raise HTTPException(status_code=403, detail="2FA code is required for sensitive operations")
    totp = pyotp.TOTP(user.two_fa_secret)
    if not totp.verify(code, valid_window=1):
        raise HTTPException(status_code=401, detail="Invalid 2FA code")


@router.post("/change-password")
async def change_password(
    change_pwd_request: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Change the current user's password."""
    if not change_pwd_request.current_password or not change_pwd_request.new_password:
        raise HTTPException(status_code=400, detail="Current password and new password are required")

    if not pwd_context.verify(change_pwd_request.current_password, current_user.hashed_password):
        raise HTTPException(status_code=401, detail="Current password is incorrect")

    _verify_2fa(current_user, change_pwd_request.two_fa_code)

    current_user.hashed_password = pwd_context.hash(change_pwd_request.new_password)
    db.add(current_user)
    db.commit()

    return {"message": "Password changed successfully", "status": "success"}


@router.put("/profile")
async def update_profile(
    profile_update: ProfileUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update the current user's username, full name and/or email."""
    _verify_2fa(current_user, profile_update.two_fa_code)

    if profile_update.username and profile_update.username != current_user.username:
        if db.query(User).filter(User.username == profile_update.username).first():
            raise HTTPException(status_code=400, detail="Username already taken")
        current_user.username = profile_update.username

    if profile_update.full_name is not None:
        current_user.full_name = profile_update.full_name

    if profile_update.email is not None and profile_update.email != current_user.email:
        if db.query(User).filter(User.email == profile_update.email).first():
            raise HTTPException(status_code=400, detail="Email already in use")
        current_user.email = profile_update.email

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
            "role": current_user.role.value,
        },
    }


@router.post("/profile/picture")
async def upload_profile_picture(
    file: UploadFile = File(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Upload a profile picture for the current user."""
    if not file:
        raise HTTPException(status_code=400, detail="No file provided")

    allowed_types = {"image/jpeg", "image/png", "image/gif", "image/webp"}
    if file.content_type not in allowed_types:
        raise HTTPException(status_code=400, detail="File must be an image (JPEG, PNG, GIF, or WebP)")

    contents = await file.read()
    if len(contents) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File must be less than 5MB")

    import hashlib

    file_hash = hashlib.md5(contents).hexdigest()
    picture_url = f"/uploads/profile-pictures/{current_user.id}-{file_hash}.png"

    settings = dict(current_user.settings_json or {})
    settings["profile_picture_url"] = picture_url
    current_user.settings_json = settings

    db.add(current_user)
    db.commit()
    db.refresh(current_user)

    return {"profile_picture_url": picture_url, "message": "Profile picture uploaded successfully"}


@router.delete("/profile/picture")
async def delete_profile_picture(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Remove the current user's profile picture."""
    settings = dict(current_user.settings_json or {})
    settings.pop("profile_picture_url", None)
    current_user.settings_json = settings

    db.add(current_user)
    db.commit()

    return {"message": "Profile picture removed successfully"}


@router.post("/delete-account")
async def delete_account(
    request: DeleteAccountRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Permanently delete the current user's account."""
    if not pwd_context.verify(request.password, current_user.hashed_password):
        raise HTTPException(status_code=401, detail="Password is incorrect")

    _verify_2fa(current_user, request.two_fa_code)

    user_id = current_user.id
    db.query(ChatSession).filter(ChatSession.user_id == user_id).delete()
    db.delete(current_user)
    db.commit()

    return {"message": "Account deleted successfully"}
