"""The notification centre: the signed-in user's notifications, what they are subscribed to, and the live socket."""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.db import SessionLocal, get_db
from app.core.deps import get_current_user
from app.core.permissions import visible_project_ids
from app.core.security import decode_token, token_user_id
from app.modules.identity.models import User
from app.modules.notifications.hub import hub
from app.modules.notifications.models import KINDS, Notification, NotificationSubscription
from app.modules.notifications.service import notification_response, subscription
from app.modules.projects.models import Project

router = APIRouter(prefix="/api/notifications", tags=["Notifications"])
socket_router = APIRouter(tags=["Notifications"])

KIND_LABELS = {
    "deployment": "Deployments to my projects' test environments",
    "deployment_check": "Environment checks after a deployment",
    "run_finished": "My runs finished",
    "review_request": "Pull requests waiting for my review",
    "review": "Reviews of my pull requests",
    "practice": "Feedback on my practice tasks",
    "promotion": "Changes to my role",
}
WS_TOKEN_PROTOCOL = "atm-token"


def _unread(db: Session, user_id: int) -> int:
    return db.query(Notification).filter(Notification.user_id == user_id, Notification.read_at.is_(None)).count()


@router.get("")
async def list_notifications(limit: int = Query(30, ge=1, le=200), unread_only: bool = False,
                             current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    query = db.query(Notification).filter(Notification.user_id == current_user.id)
    if unread_only:
        query = query.filter(Notification.read_at.is_(None))
    items = query.order_by(Notification.created_at.desc(), Notification.id.desc()).limit(limit).all()
    return {"items": [notification_response(n) for n in items], "unread": _unread(db, current_user.id)}


@router.post("/{notification_id}/read")
async def mark_read(notification_id: int, current_user: User = Depends(get_current_user),
                    db: Session = Depends(get_db)):
    notification = db.query(Notification).filter(Notification.id == notification_id,
                                                 Notification.user_id == current_user.id).first()
    if not notification:
        raise HTTPException(status_code=404, detail="Notification not found.")
    if notification.read_at is None:
        notification.read_at = datetime.utcnow()
        db.commit()
    return {"unread": _unread(db, current_user.id)}


@router.post("/read-all")
async def mark_all_read(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db.query(Notification).filter(Notification.user_id == current_user.id, Notification.read_at.is_(None)) \
        .update({"read_at": datetime.utcnow()})
    db.commit()
    return {"unread": 0}


def _visible_projects(db: Session, user: User) -> list[Project]:
    visible = visible_project_ids(db, user)
    query = db.query(Project).filter(Project.is_archived.isnot(True))
    if visible is not None:
        query = query.filter(Project.id.in_(visible))
    return query.order_by(Project.name).all()


def _subscriptions_response(db: Session, user: User) -> dict:
    choice = subscription(db, user.id)
    return {
        "kinds": [{"kind": kind, "label": KIND_LABELS[kind], "on": kind not in (choice.muted_kinds or [])}
                  for kind in KINDS],
        "projects": [{"id": p.id, "name": p.name, "on": p.id not in (choice.muted_project_ids or [])}
                     for p in _visible_projects(db, user)],
    }


class SubscriptionsUpdate(BaseModel):
    muted_kinds: list[str]
    muted_project_ids: list[int]


@router.get("/subscriptions")
async def get_subscriptions(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _subscriptions_response(db, current_user)


@router.put("/subscriptions")
async def update_subscriptions(payload: SubscriptionsUpdate, current_user: User = Depends(get_current_user),
                               db: Session = Depends(get_db)):
    unknown = sorted(set(payload.muted_kinds) - set(KINDS))
    if unknown:
        raise HTTPException(status_code=400, detail=f"Unknown notification kind: {', '.join(unknown)}.")
    choice = db.query(NotificationSubscription).filter(NotificationSubscription.user_id == current_user.id).first()
    if not choice:
        choice = NotificationSubscription(user_id=current_user.id)
        db.add(choice)
    choice.muted_kinds = sorted(set(payload.muted_kinds))
    choice.muted_project_ids = sorted(set(payload.muted_project_ids))
    db.commit()
    return _subscriptions_response(db, current_user)


def _socket_user_id(token: Optional[str]) -> Optional[int]:
    payload = decode_token(token) if token else None
    user_id = token_user_id(payload) if payload else None
    if user_id is None:
        return None
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.id == user_id).first()
        return user.id if user and user.is_active else None
    finally:
        db.close()


@socket_router.websocket("/api/ws/notifications")
async def notification_socket(websocket: WebSocket):
    """New notifications of the signed-in user, live. Authenticated like the run log socket (subprotocol or cookie)."""
    offered = list(websocket.scope.get("subprotocols") or [])
    token = None
    if WS_TOKEN_PROTOCOL in offered and offered.index(WS_TOKEN_PROTOCOL) + 1 < len(offered):
        token = offered[offered.index(WS_TOKEN_PROTOCOL) + 1]
    user_id = _socket_user_id(token or websocket.cookies.get("access_token"))
    if user_id is None:
        await websocket.close(code=1008)
        return
    await websocket.accept(subprotocol=WS_TOKEN_PROTOCOL if WS_TOKEN_PROTOCOL in offered else None)
    hub.connect(user_id, websocket)
    try:
        await websocket.send_json({"type": "hello"})
        while True:
            if await websocket.receive_text() == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        pass
    finally:
        hub.disconnect(user_id, websocket)
