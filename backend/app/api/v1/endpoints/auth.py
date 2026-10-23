import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel, EmailStr
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import create_access_token, create_refresh_token, decode_token
from app.db.session import get_db
from app.models.models import UserRole as AppUserRole
from app.schemas.auth import (
    LoginRequest,
    RefreshTokenRequest,
    TokenResponse,
    UserCreate,
    UserResponse,
)
from app.services import AuthService
from core.database import UserRole as CoreUserRole

router = APIRouter()
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db)
):
    """Dependency to get current authenticated user from JWT token."""
    payload = decode_token(token)
    token_type = payload.get("type") if payload else None
    # Legacy backend tokens (core.auth) carry "user_id" and no "type" claim.
    is_legacy_token = bool(payload) and token_type is None and payload.get("user_id") is not None
    if not payload or (token_type != "access" and not is_legacy_token):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    user_id = payload.get("user_id") if is_legacy_token else payload.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
        )
    
    user = await AuthService.get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        )
    
    return user


@router.post("/register", response_model=TokenResponse)
async def register(
    user_data: UserCreate,
    db: AsyncSession = Depends(get_db)
):
    """Register a new user."""
    try:
        user = await AuthService.register_user(db, user_data)
        access_token = create_access_token(str(user.id))
        refresh_token = create_refresh_token(str(user.id))
        return TokenResponse(
            access_token=access_token,
            refresh_token=refresh_token,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )


@router.post("/login", response_model=TokenResponse)
async def login(
    credentials: LoginRequest,
    db: AsyncSession = Depends(get_db)
):
    """Login with email and password."""
    user = await AuthService.authenticate_user(db, credentials.email, credentials.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    access_token = create_access_token(str(user.id))
    refresh_token = create_refresh_token(str(user.id))
    
    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh_token_endpoint(
    body: RefreshTokenRequest
):
    """Refresh access token using refresh token."""
    payload = decode_token(body.refresh_token)
    if not payload or payload.get("type") != "refresh":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token"
        )
    
    user_id = payload.get("sub")
    access_token = create_access_token(user_id)
    refresh_token = create_refresh_token(user_id)
    
    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
    )


@router.get("/me", response_model=UserResponse)
async def get_current_user_info(
    current_user = Depends(get_current_user)
):
    """Get current authenticated user info."""
    import json
    
    # Parse assigned_communities from JSON string
    assigned_communities = None
    if hasattr(current_user, 'assigned_communities') and current_user.assigned_communities:
        try:
            assigned_communities = json.loads(current_user.assigned_communities)
        except Exception:
            assigned_communities = []
    
    # Format organization data (handle lazy loading issues in async context)
    organization_data = None
    try:
        if hasattr(current_user, 'organization') and current_user.organization:
            org = current_user.organization
            organization_data = {
                "id": org.id,
                "name": org.name,
                "slug": org.slug,
                "subscription_plan": (
                    org.subscription_plan.value
                    if hasattr(org.subscription_plan, 'value') else str(org.subscription_plan)
                ),
            }
    except Exception:
        # If organization can't be loaded (lazy loading issue), just skip it
        pass
    
    return UserResponse(
        id=str(current_user.id),
        email=current_user.email,
        full_name=current_user.full_name,
        role=current_user.role.value,
        is_active=current_user.is_active,
        created_at=current_user.created_at.isoformat(),
        assigned_communities=assigned_communities,
        organization=organization_data,
    )


# ---------------------------------------------------------------------------
# Permission helpers
# ---------------------------------------------------------------------------

def require_role(*roles: CoreUserRole):
    """Dependency factory: raise 403 if current user's role is not in allowed roles."""
    async def _check(current_user=Depends(get_current_user)):
        # Get the role value as string (handles both UserRole enums)
        user_role_value = current_user.role.value if hasattr(current_user.role, 'value') else str(current_user.role)
        
        # Super admins have access to everything
        if user_role_value == "super_admin":
            return current_user
        
        # Convert allowed roles to string values for comparison
        allowed_role_values = [r.value if hasattr(r, 'value') else str(r) for r in roles]
        
        if user_role_value not in allowed_role_values:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions for this action",
            )
        return current_user
    return _check

require_admin = require_role(CoreUserRole.SUPER_ADMIN, CoreUserRole.ADMIN, CoreUserRole.ORG_ADMIN)
require_lead_or_above = require_role(
    CoreUserRole.SUPER_ADMIN,
    CoreUserRole.ADMIN,
    CoreUserRole.ORG_ADMIN,
    CoreUserRole.COMMUNITY_LEAD,
    CoreUserRole.AUTOMATION_LEAD,
)
require_user_or_above = require_role(
    CoreUserRole.SUPER_ADMIN,
    CoreUserRole.ADMIN,
    CoreUserRole.ORG_ADMIN,
    CoreUserRole.COMMUNITY_LEAD,
    CoreUserRole.AUTOMATION_LEAD,
    CoreUserRole.AUTOMATION_USER,
    CoreUserRole.USER,
)


# ---------------------------------------------------------------------------
# Admin: user management
# ---------------------------------------------------------------------------

class UserCreateRequest(BaseModel):
    email: EmailStr
    full_name: str
    password: str
    role: str = "automation_user"
    assigned_lead_id: Optional[str] = None
    is_active: bool = True


class UserUpdateRequest(BaseModel):
    email: Optional[EmailStr] = None
    full_name: Optional[str] = None
    role: Optional[str] = None
    assigned_lead_id: Optional[str] = None
    is_active: Optional[bool] = None
    password: Optional[str] = None


VALID_ROLES = [r.value for r in AppUserRole] + [r.value for r in CoreUserRole]


@router.get("/users", response_model=list[UserResponse])
async def list_users(
    manager=Depends(require_lead_or_above),
    db: AsyncSession = Depends(get_db),
):
    """[Admin/Automation Lead] List users for management and lead assignments."""
    users = await AuthService.list_users(db)

    # Get manager role value
    manager_role_value = manager.role.value if hasattr(manager.role, 'value') else str(manager.role)
    
    # Filter users based on manager role
    if manager_role_value == "super_admin":
        # Super admins see all users
        pass
    elif manager_role_value == "admin":
        # Admins cannot see super_admin users
        users = [
            u for u in users
            if (u.role.value if hasattr(u.role, 'value') else str(u.role)) != "super_admin"
        ]
    elif manager_role_value == "org_admin":
        # Org admins cannot see admin and super_admin users
        users = [
            u for u in users
            if (u.role.value if hasattr(u.role, 'value') else str(u.role)) not in {"admin", "super_admin"}
        ]
    elif manager_role_value == "automation_lead":
        # Automation leads see only their own and unassigned automation_user/viewer
        manager_id = str(manager.id)
        users = [
            u for u in users
            if (
                str(u.id) == manager_id
                or str(getattr(u, 'assigned_lead_id', None) or "") == manager_id
                or (
                    hasattr(u.role, 'value') and u.role.value in {"automation_user", "viewer"}
                    and getattr(u, 'assigned_lead_id', None) is None
                )
            )
        ]

    users_by_id = {str(u.id): u for u in users}
    
    # Helper to safely extract organization data
    def get_org_data(user):
        try:
            if hasattr(user, 'organization') and user.organization:
                org = user.organization
                return {
                    "id": org.id,
                    "name": org.name,
                    "slug": org.slug,
                    "subscription_plan": (
                        org.subscription_plan.value
                        if hasattr(org.subscription_plan, 'value') else str(org.subscription_plan)
                    ),
                }
        except Exception:
            pass
        return None
    
    return [
        UserResponse(
            id=str(u.id),
            email=u.email,
            full_name=u.full_name,
            role=u.role.value if hasattr(u.role, 'value') else str(u.role),
            assigned_lead_id=(
                str(getattr(u, 'assigned_lead_id', None))
                if getattr(u, 'assigned_lead_id', None) is not None else None
            ),
            assigned_lead_name=(
                users_by_id[str(getattr(u, 'assigned_lead_id', None))].full_name
                or users_by_id[str(getattr(u, 'assigned_lead_id', None))].email
            )
            if getattr(u, 'assigned_lead_id', None) and str(getattr(u, 'assigned_lead_id', None)) in users_by_id
            else None,
            is_active=u.is_active,
            created_at=u.created_at.isoformat(),
            assigned_communities=(
                json.loads(u.assigned_communities)
                if hasattr(u, 'assigned_communities') and u.assigned_communities else None
            ),
            organization=get_org_data(u),
        )
        for u in users
    ]


@router.post("/users", response_model=UserResponse)
async def create_user(
    body: UserCreateRequest,
    manager=Depends(require_lead_or_above),
    db: AsyncSession = Depends(get_db),
):
    """[Super Admin Only] Create a new user."""
    # Get manager role value
    manager_role_value = manager.role.value if hasattr(manager.role, 'value') else str(manager.role)
    
    # Only super_admin can create users
    if manager_role_value != "super_admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only super_admin can create new users",
        )
    
    # Validate role
    if body.role not in VALID_ROLES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid role. Valid roles: {VALID_ROLES}",
        )
    
    # If assigned_lead_id is provided, validate it
    if body.assigned_lead_id:
        if body.role not in {"automation_user", "viewer"}:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Only automation_user and viewer roles can be assigned to an Automation Lead",
            )
        assigned_lead = await AuthService.get_user_by_id(db, body.assigned_lead_id)
        assigned_lead_role = (
            assigned_lead.role.value if hasattr(assigned_lead.role, 'value') else str(assigned_lead.role)
        ) if assigned_lead else None
        if not assigned_lead or assigned_lead_role != "automation_lead":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="assigned_lead_id must reference an existing Automation Lead",
            )
    
    # Check if user already exists
    existing_user = await AuthService.get_user_by_email(db, body.email)
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User with this email already exists",
        )
    
    try:
        user = await AuthService.create_user(
            db,
            email=body.email,
            password=body.password,
            full_name=body.full_name,
            role=body.role,
            assigned_lead_id=body.assigned_lead_id,
            is_active=body.is_active,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    
    assigned_lead_name = None
    if getattr(user, 'assigned_lead_id', None):
        assigned_lead = await AuthService.get_user_by_id(db, str(user.assigned_lead_id))
        if assigned_lead:
            assigned_lead_name = assigned_lead.full_name or assigned_lead.email
    
    return UserResponse(
        id=str(user.id),
        email=user.email,
        full_name=user.full_name,
        role=user.role.value if hasattr(user.role, 'value') else str(user.role),
        assigned_lead_id=(
            str(getattr(user, 'assigned_lead_id', None))
            if getattr(user, 'assigned_lead_id', None) is not None else None
        ),
        assigned_lead_name=assigned_lead_name,
        is_active=user.is_active,
        created_at=user.created_at.isoformat(),
        assigned_communities=(
            json.loads(user.assigned_communities)
            if hasattr(user, 'assigned_communities') and user.assigned_communities else None
        ),
        organization=None,
    )


@router.patch("/users/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: str,
    body: UserUpdateRequest,
    manager=Depends(require_lead_or_above),
    db: AsyncSession = Depends(get_db),
):
    """[Admin/Automation Lead] Update a user. Leads can only assign automation users/viewers."""
    # Get manager role value
    manager_role_value = manager.role.value if hasattr(manager.role, 'value') else str(manager.role)
    
    if body.role is not None and body.role not in VALID_ROLES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid role. Valid roles: {VALID_ROLES}",
        )

    target_user = await AuthService.get_user_by_id(db, user_id)
    if not target_user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    effective_role_value = (
        body.role if body.role is not None
        else (target_user.role.value if hasattr(target_user.role, 'value') else str(target_user.role))
    )

    # Super admins bypass all checks
    if manager_role_value != "super_admin":
        if body.assigned_lead_id:
            if effective_role_value not in {"automation_user", "viewer"}:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Only Automation User and Viewer accounts can be assigned to an Automation Lead",
                )
            assigned_lead = await AuthService.get_user_by_id(db, body.assigned_lead_id)
            assigned_lead_role = (
                assigned_lead.role.value if hasattr(assigned_lead.role, 'value') else str(assigned_lead.role)
            )
            if not assigned_lead or assigned_lead_role != "automation_lead":
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="assigned_lead_id must reference an existing Automation Lead",
                )

    if manager_role_value == "automation_lead":
        # Leads can only manage assignment for automation users and viewers.
        if effective_role_value not in {"automation_user", "viewer"}:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Automation Leads can assign only Automation User or Viewer accounts",
            )

        if any([
            body.email is not None,
            body.full_name is not None,
            body.role is not None,
            body.is_active is not None,
            body.password is not None,
        ]):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Automation Leads can only update assigned_lead_id",
            )

        if body.assigned_lead_id and body.assigned_lead_id != str(manager.id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Automation Leads can assign users only to themselves",
            )

    try:
        user = await AuthService.update_user(
            db,
            user_id=user_id,
            email=body.email,
            full_name=body.full_name,
            role=body.role,
            assigned_lead_id=body.assigned_lead_id,
            is_active=body.is_active,
            password=body.password,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    assigned_lead_name = None
    if getattr(user, 'assigned_lead_id', None):
        assigned_lead = await AuthService.get_user_by_id(db, str(user.assigned_lead_id))
        if assigned_lead:
            assigned_lead_name = assigned_lead.full_name or assigned_lead.email

    return UserResponse(
        id=str(user.id),
        email=user.email,
        full_name=user.full_name,
        role=user.role.value if hasattr(user.role, 'value') else str(user.role),
        assigned_lead_id=(
            str(getattr(user, 'assigned_lead_id', None))
            if getattr(user, 'assigned_lead_id', None) is not None else None
        ),
        assigned_lead_name=assigned_lead_name,
        is_active=user.is_active,
        created_at=user.created_at.isoformat(),
        assigned_communities=(
            json.loads(user.assigned_communities)
            if hasattr(user, 'assigned_communities') and user.assigned_communities else None
        ),
        organization=None,
    )


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: str,
    manager=Depends(require_lead_or_above),
    db: AsyncSession = Depends(get_db),
):
    """[Admin/Automation Lead] Delete a user with scoped permissions."""
    # Get manager role value
    manager_role_value = manager.role.value if hasattr(manager.role, 'value') else str(manager.role)
    
    target_user = await AuthService.get_user_by_id(db, user_id)
    if not target_user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if str(target_user.id) == str(manager.id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You cannot delete your own account",
        )

    # Super admins can delete any user (except themselves)
    if manager_role_value == "automation_lead":
        if not target_user.assigned_lead_id or str(target_user.assigned_lead_id) != str(manager.id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Automation Leads can delete only users assigned to them",
            )

    success = await AuthService.delete_user(db, user_id)
    if not success:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    return None
