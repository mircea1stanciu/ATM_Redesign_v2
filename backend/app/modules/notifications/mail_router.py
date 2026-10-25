"""Admin › E-mail (phase 20): the SMTP server ATM sends e-mail notifications through. Super Admins only."""
import asyncio
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.crypto import encrypt
from app.core.db import get_db
from app.core.permissions import require
from app.modules.identity.models import User
from app.modules.notifications import channels
from app.modules.notifications.models import MailServer

router = APIRouter(prefix="/api/admin/mail-server", tags=["Notifications"])


def _response(server: Optional[MailServer]) -> dict:
    if not server:
        return {"configured": False}
    return {"configured": True, "host": server.host, "port": server.port, "security": server.security,
            "username": server.username, "password_set": bool(server.password), "sender": server.sender,
            "updated_at": server.updated_at.isoformat()}


class MailServerUpdate(BaseModel):
    host: str = Field(min_length=1, max_length=255)
    port: int = Field(ge=1, le=65535)
    security: Literal["starttls", "ssl", "none"] = "starttls"
    username: Optional[str] = Field(default=None, max_length=255)
    password: Optional[str] = Field(default=None, max_length=1000)  # None keeps the saved one; "" removes it
    sender: str = Field(min_length=3, max_length=255)


@router.get("")
async def get_mail_server(_user: User = Depends(require("settings.system")), db: Session = Depends(get_db)):
    return _response(channels.mail_server(db))


@router.put("")
async def set_mail_server(payload: MailServerUpdate, current_user: User = Depends(require("settings.system")),
                          db: Session = Depends(get_db)):
    if "@" not in payload.sender:
        raise HTTPException(status_code=400, detail="The sender is an e-mail address, for example atm@example.com.")
    server = channels.mail_server(db)
    if not server:
        server = MailServer()
        db.add(server)
    server.host = payload.host.strip()
    server.port = payload.port
    server.security = payload.security
    server.username = (payload.username or "").strip() or None
    if payload.password is not None:
        server.password = encrypt(payload.password) if payload.password else None
    server.sender = payload.sender.strip()
    server.updated_by_id = current_user.id
    db.commit()
    return _response(server)


@router.delete("")
async def remove_mail_server(_user: User = Depends(require("settings.system")), db: Session = Depends(get_db)):
    db.query(MailServer).delete()
    db.commit()
    return _response(None)


@router.post("/test")
async def send_test_email(current_user: User = Depends(require("settings.system")), db: Session = Depends(get_db)):
    """A test e-mail to the signed-in Super Admin's own address."""
    server = channels.mail_server(db)
    if not server:
        raise HTTPException(status_code=400, detail="Set the mail server first.")
    text = channels.email_text("ATM can send e-mail notifications through this server.", None)
    try:
        await asyncio.to_thread(channels.send_email, server, current_user.email, "ATM test e-mail", text)
    except channels.DeliveryError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"sent_to": current_user.email}
