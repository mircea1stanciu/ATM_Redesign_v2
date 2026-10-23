"""
Feature Flags Configuration for UnifiedWork
Controls feature access based on subscription plan
"""
from enum import Enum


class Feature(Enum):
    """Available features in the system"""
    # Core Features (Available to all)
    BASIC_CHAT = "basic_chat"
    USER_MANAGEMENT = "user_management"
    COMMUNITY_ACCESS = "community_access"
    
    # Small Business Features
    CUSTOM_BRANDING = "custom_branding"
    BASIC_ANALYTICS = "basic_analytics"
    EMAIL_SUPPORT = "email_support"
    COMMUNITY_LEADS = "community_leads"
    PROJECT_MANAGEMENT = "project_management"
    
    # Enterprise Features
    ADVANCED_ANALYTICS = "advanced_analytics"
    PRIORITY_SUPPORT = "priority_support"
    CUSTOM_INTEGRATIONS = "custom_integrations"
    SSO_SAML = "sso_saml"
    AUDIT_LOGS = "audit_logs"
    API_ACCESS = "api_access"
    UNLIMITED_COMMUNITIES = "unlimited_communities"
    ADVANCED_SECURITY = "advanced_security"
    DEDICATED_SUPPORT = "dedicated_support"
    SLA_GUARANTEE = "sla_guarantee"


# Feature mapping by subscription plan
PLAN_FEATURES: dict[str, set[Feature]] = {
    "free": {
        Feature.BASIC_CHAT,
        Feature.USER_MANAGEMENT,
        Feature.COMMUNITY_ACCESS,
    },
    "small_business": {
        Feature.BASIC_CHAT,
        Feature.USER_MANAGEMENT,
        Feature.COMMUNITY_ACCESS,
        Feature.CUSTOM_BRANDING,
        Feature.BASIC_ANALYTICS,
        Feature.EMAIL_SUPPORT,
        Feature.COMMUNITY_LEADS,
        Feature.PROJECT_MANAGEMENT,
    },
    "enterprise": {
        # All features
        Feature.BASIC_CHAT,
        Feature.USER_MANAGEMENT,
        Feature.COMMUNITY_ACCESS,
        Feature.CUSTOM_BRANDING,
        Feature.BASIC_ANALYTICS,
        Feature.EMAIL_SUPPORT,
        Feature.COMMUNITY_LEADS,
        Feature.PROJECT_MANAGEMENT,
        Feature.ADVANCED_ANALYTICS,
        Feature.PRIORITY_SUPPORT,
        Feature.CUSTOM_INTEGRATIONS,
        Feature.SSO_SAML,
        Feature.AUDIT_LOGS,
        Feature.API_ACCESS,
        Feature.UNLIMITED_COMMUNITIES,
        Feature.ADVANCED_SECURITY,
        Feature.DEDICATED_SUPPORT,
        Feature.SLA_GUARANTEE,
    },
}

# Plan limits
PLAN_LIMITS = {
    "free": {
        "max_users": 10,
        "max_chat_sessions": 1000,
        "max_communities": 3,
        "max_projects": 5,
        "storage_gb": 1,
        "ai_models": ["gpt-4o-mini"],
    },
    "small_business": {
        "max_users": 20,
        "max_chat_sessions": 5000,
        "max_communities": 7,
        "max_projects": 25,
        "storage_gb": 10,
        "ai_models": ["gpt-4o-mini", "gpt-4o"],
    },
    "enterprise": {
        "max_users": 100,
        "max_chat_sessions": 50000,
        "max_communities": -1,  # Unlimited
        "max_projects": -1,  # Unlimited
        "storage_gb": 100,
        "ai_models": ["gpt-4o-mini", "gpt-4o", "gpt-4", "claude-3-opus"],
    },
}


def has_feature(subscription_plan: str, feature: Feature) -> bool:
    """
    Check if a subscription plan has access to a specific feature
    
    Args:
        subscription_plan: Plan name (free, small_business, enterprise)
        feature: Feature to check
    
    Returns:
        bool: True if plan has access to feature
    """
    plan = subscription_plan.lower()
    if plan not in PLAN_FEATURES:
        return False
    return feature in PLAN_FEATURES[plan]


def get_plan_features(subscription_plan: str) -> set[Feature]:
    """
    Get all features available for a subscription plan
    
    Args:
        subscription_plan: Plan name
    
    Returns:
        Set[Feature]: Set of available features
    """
    plan = subscription_plan.lower()
    return PLAN_FEATURES.get(plan, set())


def get_plan_limit(subscription_plan: str, limit_key: str) -> any:
    """
    Get a specific limit for a subscription plan
    
    Args:
        subscription_plan: Plan name
        limit_key: Limit to retrieve (max_users, max_chat_sessions, etc.)
    
    Returns:
        Limit value or None if not found
    """
    plan = subscription_plan.lower()
    if plan not in PLAN_LIMITS:
        return None
    return PLAN_LIMITS[plan].get(limit_key)


def get_all_plan_limits(subscription_plan: str) -> dict:
    """
    Get all limits for a subscription plan
    
    Args:
        subscription_plan: Plan name
    
    Returns:
        Dict: All limits for the plan
    """
    plan = subscription_plan.lower()
    return PLAN_LIMITS.get(plan, {})


# Feature descriptions for UI
FEATURE_DESCRIPTIONS = {
    Feature.BASIC_CHAT: "Access to AI-powered chat with specialized agents",
    Feature.USER_MANAGEMENT: "Create and manage users within your organization",
    Feature.COMMUNITY_ACCESS: "Access to tech community channels",
    Feature.CUSTOM_BRANDING: "Customize your workspace with logo and colors",
    Feature.BASIC_ANALYTICS: "View usage statistics and reports",
    Feature.EMAIL_SUPPORT: "Email support within 24 hours",
    Feature.COMMUNITY_LEADS: "Assign community lead roles",
    Feature.PROJECT_MANAGEMENT: "Create and manage projects",
    Feature.ADVANCED_ANALYTICS: "Advanced analytics with custom reports",
    Feature.PRIORITY_SUPPORT: "Priority support with 4-hour response time",
    Feature.CUSTOM_INTEGRATIONS: "Custom API integrations",
    Feature.SSO_SAML: "Single Sign-On with SAML",
    Feature.AUDIT_LOGS: "Complete audit trail of all actions",
    Feature.API_ACCESS: "Full REST API access",
    Feature.UNLIMITED_COMMUNITIES: "Create unlimited custom communities",
    Feature.ADVANCED_SECURITY: "Advanced security features and compliance",
    Feature.DEDICATED_SUPPORT: "Dedicated account manager",
    Feature.SLA_GUARANTEE: "99.9% uptime SLA guarantee",
}


def compare_plans() -> dict[str, dict[str, bool]]:
    """
    Generate a comparison matrix of all features across plans
    
    Returns:
        Dict: Feature comparison matrix
    """
    comparison = {}
    for feature in Feature:
        comparison[feature.value] = {
            "free": has_feature("free", feature),
            "small_business": has_feature("small_business", feature),
            "enterprise": has_feature("enterprise", feature),
            "description": FEATURE_DESCRIPTIONS.get(feature, ""),
        }
    return comparison
