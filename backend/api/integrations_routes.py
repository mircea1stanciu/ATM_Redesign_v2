"""
Data, Integrations, and Billing API endpoints
"""

import hashlib
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from api.sync_auth import get_current_user
from core.database import BillingInvoice, DataExport, Integration, PaymentMethod, Subscription, User, Webhook, get_db

router = APIRouter(tags=["Integrations & Billing"])


# ── Data Export ──────────────────────────────────────────────────────────────

@router.post("/data/export-request", tags=["Data"])
async def request_data_export(
    export_type: str = "full",
    format: str = "json",
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Request a data export"""
    if export_type not in ["full", "minimal", "specific"]:
        raise HTTPException(status_code=400, detail="Invalid export type")
    
    if format not in ["json", "csv", "xml"]:
        raise HTTPException(status_code=400, detail="Invalid format")
    
    # Create export request
    export = DataExport(
        user_id=current_user.id,
        export_type=export_type,
        format=format,
        status="processing"
    )
    
    db.add(export)
    db.commit()
    db.refresh(export)
    
    return {
        "id": export.id,
        "export_type": export.export_type,
        "format": export.format,
        "status": export.status,
        "requested_at": export.requested_at.isoformat(),
        "message": "Data export processing started. You'll receive email when ready."
    }


@router.get("/data/exports", tags=["Data"])
async def list_data_exports(
    status: str = Query(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List user's data exports"""
    query = db.query(DataExport).filter(DataExport.user_id == current_user.id)
    
    if status:
        query = query.filter(DataExport.status == status)
    
    exports = query.order_by(DataExport.requested_at.desc()).all()
    
    return {
        "exports": [
            {
                "id": exp.id,
                "export_type": exp.export_type,
                "format": exp.format,
                "status": exp.status,
                "file_url": exp.file_url,
                "file_size": exp.file_size,
                "requested_at": exp.requested_at.isoformat(),
                "completed_at": exp.completed_at.isoformat() if exp.completed_at else None,
                "expires_at": exp.expires_at.isoformat() if exp.expires_at else None,
            }
            for exp in exports
        ]
    }


# ── Integrations ─────────────────────────────────────────────────────────────

@router.get("/integrations", tags=["Integrations"])
async def list_integrations(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List user's connected integrations"""
    integrations = db.query(Integration).filter(
        Integration.user_id == current_user.id
    ).order_by(Integration.created_at.desc()).all()
    
    return {
        "integrations": [
            {
                "id": integ.id,
                "service_name": integ.service_name,
                "service_type": integ.service_type,
                "external_workspace_name": integ.external_workspace_name,
                "is_active": integ.is_active,
                "last_sync": integ.last_sync.isoformat() if integ.last_sync else None,
                "created_at": integ.created_at.isoformat(),
            }
            for integ in integrations
        ]
    }


@router.post("/integrations/{service}/connect", tags=["Integrations"])
async def connect_integration(
    service: str,
    auth_code: str,
    workspace_id: str = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Connect a new integration"""
    if service not in ["github", "jira", "slack", "asana", "monday"]:
        raise HTTPException(status_code=400, detail="Service not supported")
    
    # Check if already connected
    existing = db.query(Integration).filter(
        Integration.user_id == current_user.id,
        Integration.service_name == service
    ).first()
    
    if existing:
        raise HTTPException(status_code=400, detail=f"{service} already connected")
    
    # In production, exchange auth_code for tokens via service's OAuth API
    # For demo, we'll store the code as-is (not recommended in production)
    
    integration = Integration(
        user_id=current_user.id,
        service_name=service,
        service_type=get_service_type(service),
        client_id=service,
        access_token=auth_code,
        external_workspace_id=workspace_id,
        is_active=True
    )
    
    db.add(integration)
    db.commit()
    db.refresh(integration)
    
    return {
        "id": integration.id,
        "service_name": integration.service_name,
        "is_active": integration.is_active,
        "created_at": integration.created_at.isoformat(),
        "message": f"{service} successfully connected!"
    }


@router.delete("/integrations/{integration_id}", tags=["Integrations"])
async def disconnect_integration(
    integration_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Disconnect an integration"""
    integration = db.query(Integration).filter(
        Integration.id == integration_id,
        Integration.user_id == current_user.id
    ).first()
    
    if not integration:
        raise HTTPException(status_code=404, detail="Integration not found")
    
    db.delete(integration)
    db.commit()
    
    return {"message": f"{integration.service_name} disconnected successfully"}


@router.get("/integrations/{integration_id}/webhooks", tags=["Webhooks"])
async def list_webhooks(
    integration_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List webhooks for an integration"""
    integration = db.query(Integration).filter(
        Integration.id == integration_id,
        Integration.user_id == current_user.id
    ).first()
    
    if not integration:
        raise HTTPException(status_code=404, detail="Integration not found")
    
    webhooks = db.query(Webhook).filter(
        Webhook.integration_id == integration_id
    ).all()
    
    return {
        "webhooks": [
            {
                "id": webhook.id,
                "event_type": webhook.event_type,
                "target_url": webhook.target_url,
                "is_active": webhook.is_active,
                "last_delivery": webhook.last_delivery.isoformat() if webhook.last_delivery else None,
                "delivery_count": webhook.delivery_count,
                "failure_count": webhook.failure_count,
                "created_at": webhook.created_at.isoformat(),
            }
            for webhook in webhooks
        ]
    }


@router.post("/integrations/{integration_id}/webhooks", tags=["Webhooks"])
async def create_webhook(
    integration_id: int,
    event_type: str,
    target_url: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create a webhook for an integration"""
    integration = db.query(Integration).filter(
        Integration.id == integration_id,
        Integration.user_id == current_user.id
    ).first()
    
    if not integration:
        raise HTTPException(status_code=404, detail="Integration not found")
    
    # Generate webhook secret
    secret = hashlib.sha256(f"{integration_id}{event_type}{target_url}".encode()).hexdigest()[:32]
    
    webhook = Webhook(
        integration_id=integration_id,
        user_id=current_user.id,
        event_type=event_type,
        target_url=target_url,
        secret=secret,
        is_active=True
    )
    
    db.add(webhook)
    db.commit()
    db.refresh(webhook)
    
    return {
        "id": webhook.id,
        "event_type": webhook.event_type,
        "target_url": webhook.target_url,
        "secret": secret,
        "is_active": webhook.is_active,
        "created_at": webhook.created_at.isoformat(),
        "message": "Webhook created successfully. Store the secret for HMAC verification."
    }


# ── Subscription & Billing ───────────────────────────────────────────────────

@router.get("/subscription", tags=["Subscription"])
async def get_subscription(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get user's subscription details"""
    subscription = db.query(Subscription).filter(
        Subscription.user_id == current_user.id
    ).first()
    
    if not subscription:
        # Return default free plan
        return {
            "plan": "free",
            "status": "active",
            "billing_cycle": "monthly",
            "monthly_cost": "0.00",
            "yearly_cost": "0.00",
            "storage_limit_gb": 5,
            "max_team_members": 1,
            "api_rate_limit": 1000,
            "is_trial": False,
            "trial_ends_at": None,
            "renewal_date": None
        }
    
    return {
        "plan": subscription.plan,
        "status": subscription.status,
        "billing_cycle": subscription.billing_cycle,
        "monthly_cost": subscription.monthly_cost,
        "yearly_cost": subscription.yearly_cost,
        "storage_limit_gb": subscription.storage_limit_gb,
        "max_team_members": subscription.max_team_members,
        "api_rate_limit": subscription.api_rate_limit,
        "is_trial": subscription.is_trial,
        "trial_ends_at": subscription.trial_ends_at.isoformat() if subscription.trial_ends_at else None,
        "current_period_start": subscription.current_period_start.isoformat()
        if subscription.current_period_start
        else None,
        "current_period_end": subscription.current_period_end.isoformat() if subscription.current_period_end else None,
        "renewal_date": subscription.renewal_date.isoformat() if subscription.renewal_date else None,
    }


@router.post("/subscription/upgrade", tags=["Subscription"])
async def upgrade_subscription(
    plan: str,
    billing_cycle: str = "monthly",
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Upgrade subscription plan"""
    if plan not in ["starter", "professional", "enterprise"]:
        raise HTTPException(status_code=400, detail="Invalid plan")
    
    subscription = db.query(Subscription).filter(
        Subscription.user_id == current_user.id
    ).first()
    
    if not subscription:
        subscription = Subscription(user_id=current_user.id)
    
    # Set pricing based on plan
    pricing = {
        "starter": {"monthly": "29.00", "yearly": "290.00"},
        "professional": {"monthly": "99.00", "yearly": "990.00"},
        "enterprise": {"monthly": "299.00", "yearly": "2990.00"},
    }
    
    plan_pricing = pricing[plan]
    subscription.plan = plan
    subscription.billing_cycle = billing_cycle
    subscription.monthly_cost = plan_pricing["monthly"]
    subscription.yearly_cost = plan_pricing["yearly"]
    subscription.status = "active"
    subscription.current_period_start = datetime.utcnow()
    subscription.current_period_end = datetime.utcnow() + timedelta(days=30 if billing_cycle == "monthly" else 365)
    subscription.renewal_date = subscription.current_period_end
    
    # Set limits based on plan
    limits = {
        "starter": {"storage": 50, "team": 5, "rate": 10000},
        "professional": {"storage": 500, "team": 50, "rate": 100000},
        "enterprise": {"storage": 5000, "team": 500, "rate": 1000000},
    }
    
    plan_limits = limits[plan]
    subscription.storage_limit_gb = plan_limits["storage"]
    subscription.max_team_members = plan_limits["team"]
    subscription.api_rate_limit = plan_limits["rate"]
    
    if not subscription.organization_id:
        subscription.organization_id = current_user.organization_id
    
    db.add(subscription)
    db.commit()
    db.refresh(subscription)
    
    return {
        "plan": subscription.plan,
        "status": subscription.status,
        "monthly_cost": subscription.monthly_cost,
        "message": f"Subscription upgraded to {plan} plan!"
    }


@router.get("/billing/invoices", tags=["Billing"])
async def list_invoices(
    status: str = Query(None),
    limit: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List user's billing invoices"""
    query = db.query(BillingInvoice).filter(BillingInvoice.user_id == current_user.id)
    
    if status:
        query = query.filter(BillingInvoice.status == status)
    
    invoices = query.order_by(BillingInvoice.issued_at.desc()).limit(limit).all()
    
    return {
        "invoices": [
            {
                "id": invoice.id,
                "invoice_number": invoice.invoice_number,
                "amount": invoice.amount,
                "currency": invoice.currency,
                "description": invoice.description,
                "status": invoice.status,
                "period_start": invoice.period_start.isoformat() if invoice.period_start else None,
                "period_end": invoice.period_end.isoformat() if invoice.period_end else None,
                "due_date": invoice.due_date.isoformat() if invoice.due_date else None,
                "paid_at": invoice.paid_at.isoformat() if invoice.paid_at else None,
                "issued_at": invoice.issued_at.isoformat(),
            }
            for invoice in invoices
        ]
    }


@router.get("/billing/payment-methods", tags=["Billing"])
async def list_payment_methods(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List saved payment methods"""
    methods = db.query(PaymentMethod).filter(
        PaymentMethod.user_id == current_user.id
    ).order_by(PaymentMethod.is_default.desc()).all()
    
    return {
        "payment_methods": [
            {
                "id": method.id,
                "type": method.type,
                "card_brand": method.card_brand,
                "card_last4": method.card_last4,
                "card_exp_month": method.card_exp_month,
                "card_exp_year": method.card_exp_year,
                "bank_name": method.bank_name,
                "bank_account_last4": method.bank_account_last4,
                "is_default": method.is_default,
                "is_valid": method.is_valid,
                "billing_name": method.billing_name,
                "created_at": method.created_at.isoformat(),
            }
            for method in methods
        ]
    }


@router.post("/billing/payment-methods", tags=["Billing"])
async def add_payment_method(
    method_type: str,
    card_last4: str = None,
    billing_name: str = None,
    set_as_default: bool = False,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Add a payment method"""
    if method_type not in ["credit_card", "debit_card", "bank_account"]:
        raise HTTPException(status_code=400, detail="Invalid payment method type")
    
    if set_as_default:
        # Unset other defaults
        db.query(PaymentMethod).filter(
            PaymentMethod.user_id == current_user.id,
            PaymentMethod.is_default.is_(True)
        ).update({"is_default": False})
    
    payment_method = PaymentMethod(
        user_id=current_user.id,
        type=method_type,
        card_last4=card_last4,
        billing_name=billing_name,
        is_default=set_as_default,
        is_valid=True
    )
    
    db.add(payment_method)
    db.commit()
    db.refresh(payment_method)
    
    return {
        "id": payment_method.id,
        "type": payment_method.type,
        "card_last4": payment_method.card_last4,
        "is_default": payment_method.is_default,
        "created_at": payment_method.created_at.isoformat(),
        "message": "Payment method added successfully"
    }


@router.delete("/billing/payment-methods/{method_id}", tags=["Billing"])
async def delete_payment_method(
    method_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete a payment method"""
    method = db.query(PaymentMethod).filter(
        PaymentMethod.id == method_id,
        PaymentMethod.user_id == current_user.id
    ).first()
    
    if not method:
        raise HTTPException(status_code=404, detail="Payment method not found")
    
    db.delete(method)
    db.commit()
    
    return {"message": "Payment method deleted successfully"}


def get_service_type(service: str) -> str:
    """Get service type for a service name"""
    service_types = {
        "github": "vcs",
        "jira": "issue-tracking",
        "slack": "messaging",
        "asana": "project-management",
        "monday": "project-management",
    }
    return service_types.get(service, "other")
