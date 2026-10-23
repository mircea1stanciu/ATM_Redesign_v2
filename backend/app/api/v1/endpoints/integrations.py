"""
Data, Integrations, and Billing API endpoints
"""

import hashlib
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.auth import get_current_user
from app.db.session import get_db
from app.models.models import BillingInvoice, DataExport, Integration, PaymentMethod, User, UserSubscription, Webhook

router = APIRouter()


# ── Data Export ──────────────────────────────────────────────────────────────

@router.post("/data/export-request")
async def request_data_export(
    export_type: str = "full",
    format: str = "json",
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    if export_type not in ["full", "minimal", "specific"]:
        raise HTTPException(status_code=400, detail="Invalid export type")
    if format not in ["json", "csv", "xml"]:
        raise HTTPException(status_code=400, detail="Invalid format")

    export = DataExport(
        user_id=current_user.id,
        export_type=export_type,
        format=format,
        status="processing"
    )
    db.add(export)
    await db.commit()
    await db.refresh(export)

    return {
        "id": export.id,
        "export_type": export.export_type,
        "format": export.format,
        "status": export.status,
        "requested_at": export.requested_at.isoformat(),
        "message": "Data export processing started."
    }


@router.get("/data/exports")
async def list_data_exports(
    status: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    q = select(DataExport).where(DataExport.user_id == current_user.id)
    if status:
        q = q.where(DataExport.status == status)
    q = q.order_by(DataExport.requested_at.desc())

    result = await db.execute(q)
    exports = result.scalars().all()

    return {
        "exports": [
            {
                "id": e.id,
                "export_type": e.export_type,
                "format": e.format,
                "status": e.status,
                "file_url": e.file_url,
                "file_size": e.file_size,
                "requested_at": e.requested_at.isoformat(),
                "completed_at": e.completed_at.isoformat() if e.completed_at else None,
                "expires_at": e.expires_at.isoformat() if e.expires_at else None,
            }
            for e in exports
        ]
    }


# ── Integrations ─────────────────────────────────────────────────────────────

@router.get("/integrations")
async def list_integrations(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(Integration).where(Integration.user_id == current_user.id)
    )
    integrations = result.scalars().all()

    return {
        "integrations": [
            {
                "id": i.id,
                "service": i.service,
                "status": i.status,
                "connected_at": i.connected_at.isoformat(),
                "last_sync": i.last_sync.isoformat() if i.last_sync else None,
            }
            for i in integrations
        ]
    }


@router.post("/integrations/{service}/connect")
async def connect_integration(
    service: str,
    auth_code: str,
    workspace_id: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    valid_services = ["github", "jira", "slack", "asana", "monday"]
    if service not in valid_services:
        raise HTTPException(status_code=400, detail=f"Invalid service: {service}")

    integration = Integration(
        user_id=current_user.id,
        service=service,
        status="connected",
        oauth_token=auth_code,
        workspace_id=workspace_id
    )
    db.add(integration)
    await db.commit()
    await db.refresh(integration)

    return {
        "id": integration.id,
        "service": integration.service,
        "status": integration.status,
        "connected_at": integration.connected_at.isoformat(),
        "message": f"Successfully connected {service}"
    }


@router.delete("/integrations/{integration_id}")
async def disconnect_integration(
    integration_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(Integration).where(
            Integration.id == integration_id,
            Integration.user_id == current_user.id
        )
    )
    integration = result.scalar_one_or_none()
    if not integration:
        raise HTTPException(status_code=404, detail="Integration not found")

    await db.delete(integration)
    await db.commit()
    return {"message": "Integration disconnected"}


# ── Webhooks ─────────────────────────────────────────────────────────────

@router.get("/integrations/{integration_id}/webhooks")
async def list_webhooks(
    integration_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    # Verify ownership
    result = await db.execute(
        select(Integration).where(
            Integration.id == integration_id,
            Integration.user_id == current_user.id
        )
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Integration not found")

    result = await db.execute(
        select(Webhook).where(Webhook.integration_id == integration_id)
    )
    webhooks = result.scalars().all()

    return {
        "webhooks": [
            {
                "id": w.id,
                "event_type": w.event_type,
                "target_url": w.target_url,
                "status": w.status,
                "delivery_count": w.delivery_count,
                "failure_count": w.failure_count,
                "last_delivery": w.last_delivery.isoformat() if w.last_delivery else None,
            }
            for w in webhooks
        ]
    }


@router.post("/integrations/{integration_id}/webhooks")
async def create_webhook(
    integration_id: int,
    event_type: str,
    target_url: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(Integration).where(
            Integration.id == integration_id,
            Integration.user_id == current_user.id
        )
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Integration not found")

    hmac_secret = hashlib.sha256(f"{integration_id}-{datetime.utcnow().timestamp()}".encode()).hexdigest()

    webhook = Webhook(
        integration_id=integration_id,
        event_type=event_type,
        target_url=target_url,
        hmac_secret=hmac_secret,
        status="active"
    )
    db.add(webhook)
    await db.commit()
    await db.refresh(webhook)

    return {
        "id": webhook.id,
        "event_type": webhook.event_type,
        "target_url": webhook.target_url,
        "hmac_secret": webhook.hmac_secret,
        "status": webhook.status,
    }


# ── Subscription ─────────────────────────────────────────────────────────────

@router.get("/subscription")
async def get_subscription(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(UserSubscription).where(UserSubscription.user_id == current_user.id)
    )
    subscription = result.scalar_one_or_none()

    if not subscription:
        subscription = UserSubscription(
            user_id=current_user.id,
            plan="free",
            status="active",
            price=0,
            billing_cycle="monthly"
        )
        db.add(subscription)
        await db.commit()
        await db.refresh(subscription)

    return {
        "plan": subscription.plan,
        "status": subscription.status,
        "price": subscription.price,
        "billing_cycle": subscription.billing_cycle,
        "trial_end": subscription.trial_end.isoformat() if subscription.trial_end else None,
        "renewal_date": subscription.renewal_date.isoformat() if subscription.renewal_date else None,
        "storage_gb": subscription.storage_gb,
        "team_members": subscription.team_members,
        "api_rate_limit": subscription.api_rate_limit,
    }


@router.post("/subscription/upgrade")
async def upgrade_subscription(
    plan: str,
    billing_cycle: str = "monthly",
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    valid_plans = ["free", "starter", "professional", "enterprise"]
    if plan not in valid_plans:
        raise HTTPException(status_code=400, detail=f"Invalid plan: {plan}")

    result = await db.execute(
        select(UserSubscription).where(UserSubscription.user_id == current_user.id)
    )
    subscription = result.scalar_one_or_none()

    if not subscription:
        subscription = UserSubscription(user_id=current_user.id)
        db.add(subscription)

    old_plan = subscription.plan
    subscription.plan = plan
    subscription.billing_cycle = billing_cycle
    subscription.status = "active"

    pricing = {"free": 0, "starter": 29 if billing_cycle == "monthly" else 290,
               "professional": 99 if billing_cycle == "monthly" else 990,
               "enterprise": 299 if billing_cycle == "monthly" else 2990}
    subscription.price = pricing.get(plan, 0)

    limits = {"free": (5, 3, 100), "starter": (50, 10, 1000),
              "professional": (500, 50, 10000), "enterprise": (5000, 500, 100000)}
    storage, members, rate = limits.get(plan, (5, 3, 100))
    subscription.storage_gb = storage
    subscription.team_members = members
    subscription.api_rate_limit = rate

    await db.commit()
    await db.refresh(subscription)

    return {"old_plan": old_plan, "new_plan": plan, "price": subscription.price,
            "billing_cycle": billing_cycle, "message": f"Upgraded to {plan}"}


# ── Billing ──────────────────────────────────────────────────────────────

@router.get("/billing/invoices")
async def list_invoices(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(BillingInvoice).where(BillingInvoice.user_id == current_user.id)
        .order_by(BillingInvoice.created_at.desc())
    )
    invoices = result.scalars().all()

    return {
        "invoices": [
            {
                "id": inv.id,
                "number": inv.invoice_number,
                "amount": inv.amount,
                "status": inv.status,
                "description": inv.description,
                "due_date": inv.due_date.isoformat() if inv.due_date else None,
                "created_at": inv.created_at.isoformat(),
            }
            for inv in invoices
        ]
    }


@router.get("/billing/payment-methods")
async def list_payment_methods(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(PaymentMethod).where(PaymentMethod.user_id == current_user.id)
    )
    methods = result.scalars().all()

    return {
        "payment_methods": [
            {
                "id": m.id,
                "type": m.payment_type,
                "masked_data": m.masked_data,
                "is_default": m.is_default,
                "created_at": m.created_at.isoformat(),
            }
            for m in methods
        ]
    }


@router.post("/billing/payment-methods")
async def add_payment_method(
    payment_type: str,
    masked_data: str,
    is_default: bool = False,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    valid_types = ["credit_card", "debit_card", "bank_account"]
    if payment_type not in valid_types:
        raise HTTPException(status_code=400, detail="Invalid payment type")

    if is_default:
        result = await db.execute(
            select(PaymentMethod).where(
                PaymentMethod.user_id == current_user.id,
                PaymentMethod.is_default.is_(True)
            )
        )
        for m in result.scalars().all():
            m.is_default = False

    method = PaymentMethod(
        user_id=current_user.id,
        payment_type=payment_type,
        masked_data=masked_data,
        is_default=is_default
    )
    db.add(method)
    await db.commit()
    await db.refresh(method)

    return {"id": method.id, "type": method.payment_type,
            "masked_data": method.masked_data, "is_default": method.is_default}


@router.delete("/billing/payment-methods/{method_id}")
async def delete_payment_method(
    method_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(PaymentMethod).where(
            PaymentMethod.id == method_id,
            PaymentMethod.user_id == current_user.id
        )
    )
    method = result.scalar_one_or_none()
    if not method:
        raise HTTPException(status_code=404, detail="Payment method not found")

    await db.delete(method)
    await db.commit()
    return {"message": "Payment method deleted"}
