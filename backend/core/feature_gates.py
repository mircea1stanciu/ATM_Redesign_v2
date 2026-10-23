"""
Feature Gates - Middleware and decorators for feature access control
"""
from functools import wraps
from typing import Callable

from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session

from core.auth import get_current_user
from core.database import Organization, User, get_db
from core.feature_flags import Feature, has_feature


def require_feature(feature: Feature):
    """
    Decorator to require a specific feature for an endpoint
    
    Usage:
        @app.get("/api/advanced-analytics")
        @require_feature(Feature.ADVANCED_ANALYTICS)
        async def get_analytics(current_user: User = Depends(get_current_user)):
            ...
    """
    def decorator(func: Callable):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            # Extract current_user from kwargs
            current_user: User = kwargs.get('current_user')
            db: Session = kwargs.get('db')
            
            if not current_user:
                raise HTTPException(status_code=401, detail="Authentication required")
            
            # Get organization subscription plan
            if not current_user.organization_id:
                raise HTTPException(
                    status_code=403, 
                    detail="Feature requires organization membership"
                )
            
            if not db:
                raise HTTPException(status_code=500, detail="Database session required")
            
            org = db.query(Organization).filter(
                Organization.id == current_user.organization_id
            ).first()
            
            if not org:
                raise HTTPException(status_code=404, detail="Organization not found")
            
            # Check if organization has access to feature
            subscription_plan = org.subscription_plan.value
            if not has_feature(subscription_plan, feature):
                raise HTTPException(
                    status_code=403,
                    detail=(
                        f"Feature '{feature.value}' not available in {subscription_plan.upper()} plan. "
                        "Upgrade to access this feature."
                    )
                )
            
            return await func(*args, **kwargs)
        
        return wrapper
    return decorator


async def check_feature_access(
    feature: Feature,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
) -> bool:
    """
    Dependency to check if user has access to a feature
    
    Usage:
        @app.get("/api/feature")
        async def feature_endpoint(
            has_access: bool = Depends(lambda: check_feature_access(Feature.CUSTOM_BRANDING))
        ):
            if not has_access:
                raise HTTPException(403, "Feature not available")
    """
    if not current_user.organization_id:
        return False
    
    org = db.query(Organization).filter(
        Organization.id == current_user.organization_id
    ).first()
    
    if not org:
        return False
    
    return has_feature(org.subscription_plan.value, feature)


def get_user_features(current_user: User, db: Session) -> dict:
    """
    Get all features available to a user based on their organization's plan
    
    Args:
        current_user: Current user
        db: Database session
    
    Returns:
        dict: Available features and plan info
    """
    if not current_user.organization_id:
        return {
            "subscription_plan": "none",
            "features": {},
            "limits": {}
        }
    
    org = db.query(Organization).filter(
        Organization.id == current_user.organization_id
    ).first()
    
    if not org:
        return {
            "subscription_plan": "none",
            "features": {},
            "limits": {}
        }
    
    from core.feature_flags import FEATURE_DESCRIPTIONS, get_all_plan_limits, get_plan_features
    
    subscription_plan = org.subscription_plan.value
    available_features = get_plan_features(subscription_plan)
    plan_limits = get_all_plan_limits(subscription_plan)
    
    # Format features for frontend
    features_dict = {}
    for feature in Feature:
        features_dict[feature.value] = {
            "enabled": feature in available_features,
            "description": FEATURE_DESCRIPTIONS.get(feature, "")
        }
    
    return {
        "subscription_plan": subscription_plan,
        "features": features_dict,
        "limits": plan_limits
    }
