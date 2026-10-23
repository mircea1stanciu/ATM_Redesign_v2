"""Request dependencies shared by every module: the current user and role checks."""
from typing import Optional

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.security import decode_token, token_user_id
from app.modules.identity.models import User, UserRole

_bearer = HTTPBearer(auto_error=False)


def get_current_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
    db: Session = Depends(get_db),
) -> User:
    """The signed-in user, from the Authorization header or the access_token cookie."""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    token = credentials.credentials if credentials else request.cookies.get("access_token")
    if not token:
        raise credentials_exception

    payload = decode_token(token)
    user_id = token_user_id(payload) if payload else None
    if user_id is None:
        raise credentials_exception

    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise credentials_exception
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Inactive user")
    return user


def get_org_admin_user(current_user: User = Depends(get_current_user)) -> User:
    """Require ORG_ADMIN or SUPER_ADMIN (replaced by permissions in phase 04)."""
    if current_user.role not in [UserRole.ORG_ADMIN, UserRole.SUPER_ADMIN]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not enough permissions")
    return current_user


def get_super_admin_user(current_user: User = Depends(get_current_user)) -> User:
    """Require SUPER_ADMIN."""
    if current_user.role != UserRole.SUPER_ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Super admin access required")
    return current_user


def require_role(*roles: UserRole):
    """Dependency factory: 403 unless the user has one of `roles` (super admins always pass).

    Role sets are temporary; phase 04 replaces them with require("permission").
    """

    def _check(current_user: User = Depends(get_current_user)) -> User:
        if current_user.role == UserRole.SUPER_ADMIN or current_user.role in roles:
            return current_user
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions for this action")

    return _check


require_admin = require_role(UserRole.ADMIN, UserRole.ORG_ADMIN)
require_lead_or_above = require_role(
    UserRole.ADMIN, UserRole.ORG_ADMIN, UserRole.COMMUNITY_LEAD, UserRole.AUTOMATION_LEAD
)
require_user_or_above = require_role(
    UserRole.ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMMUNITY_LEAD,
    UserRole.AUTOMATION_LEAD,
    UserRole.AUTOMATION_USER,
    UserRole.USER,
)
