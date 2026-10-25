"""Notifications outside ATM (phase 20): e-mail through the SMTP server a Super Admin set, and Teams messages to the
user's own Teams workflow webhook. Sent in a background thread, so a slow mail server never holds up a request."""
import logging
import smtplib
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from email.message import EmailMessage
from typing import Optional

import httpx
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.crypto import SecretUnreadable, decrypt
from app.modules.notifications import teams
from app.modules.notifications.models import MailServer

logger = logging.getLogger("atm.notifications")
SMTP_TIMEOUT_SECONDS = 15
# Tests deliver in the calling thread and replace these so no message leaves the process.
INLINE = False
SMTP_CLASS: type[smtplib.SMTP] = smtplib.SMTP
SMTP_SSL_CLASS: type[smtplib.SMTP_SSL] = smtplib.SMTP_SSL
HTTP_TRANSPORT: Optional[httpx.BaseTransport] = None
_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="atm-notify")


class DeliveryError(Exception):
    """A message could not be sent; the text says why, for the person who set the server or webhook up."""


@dataclass
class Delivery:
    channel: str  # email | teams
    user_id: int
    title: str
    body: str
    link: Optional[str]


def absolute_link(link: Optional[str]) -> Optional[str]:
    """An ATM path made absolute with ATM_PUBLIC_URL (left out when that is not set); external URLs stay as they are."""
    if not link:
        return None
    if link.startswith(("http://", "https://")):
        return link
    base = settings.ATM_PUBLIC_URL.rstrip("/")
    return f"{base}{link}" if base else None


def mail_server(db: Session) -> Optional[MailServer]:
    return db.query(MailServer).order_by(MailServer.id).first()


def send_email(server: MailServer, to: str, subject: str, text: str) -> None:
    message = EmailMessage()
    message["From"] = server.sender
    message["To"] = to
    message["Subject"] = subject
    message.set_content(text)
    try:
        password = decrypt(server.password) if server.password else None
    except SecretUnreadable as exc:
        raise DeliveryError("The mail server's password cannot be decrypted; set it again in Admin › E-mail.") from exc
    try:
        if server.security == "ssl":
            client: smtplib.SMTP = SMTP_SSL_CLASS(server.host, server.port, timeout=SMTP_TIMEOUT_SECONDS)
        else:
            client = SMTP_CLASS(server.host, server.port, timeout=SMTP_TIMEOUT_SECONDS)
        with client:
            if server.security == "starttls":
                client.starttls()
            if server.username:
                client.login(server.username, password or "")
            client.send_message(message)
    except (OSError, smtplib.SMTPException) as exc:
        raise DeliveryError(f"The mail server refused the message: {exc.__class__.__name__}: {exc}"[:300]) from exc


def post_teams(encrypted_webhook: str, title: str, body: str, link: Optional[str]) -> None:
    try:
        url = decrypt(encrypted_webhook)
    except SecretUnreadable as exc:
        raise DeliveryError("Your Teams webhook cannot be decrypted; set it again in Notifications.") from exc
    try:
        with httpx.Client(timeout=teams.TIMEOUT_SECONDS, transport=HTTP_TRANSPORT) as client:
            response = client.post(url, json=teams.card(title, body, link))
    except httpx.HTTPError as exc:
        raise DeliveryError(f"Could not reach the Teams webhook: {exc.__class__.__name__}.") from exc
    if response.status_code >= 400:
        raise DeliveryError(f"The Teams webhook answered {response.status_code}.")


def email_text(body: str, link: Optional[str]) -> str:
    parts = [body] if body else []
    if link:
        parts.append(f"Open in ATM: {link}")
    settings_link = absolute_link("/notifications")
    parts.append("You get this e-mail because you chose it in ATM's notification settings"
                 + (f": {settings_link}" if settings_link else "."))
    return "\n\n".join(parts)


def deliver(deliveries: list[Delivery]) -> None:
    """Send each message; a failure is logged and never raised (the notification in ATM is what counts)."""
    from app.core.db import SessionLocal
    from app.modules.identity.models import User
    from app.modules.notifications.models import NotificationSubscription

    db = SessionLocal()
    try:
        server = mail_server(db)
        for item in deliveries:
            link = absolute_link(item.link)
            try:
                if item.channel == "email":
                    user = db.query(User).filter(User.id == item.user_id).first()
                    if server and user and user.email:
                        send_email(server, user.email, item.title, email_text(item.body, link))
                else:
                    choice = db.query(NotificationSubscription).filter(
                        NotificationSubscription.user_id == item.user_id).first()
                    if choice and choice.teams_webhook:
                        post_teams(choice.teams_webhook, item.title, item.body, link)
            except DeliveryError as exc:
                logger.warning("A %s notification to user %s was not sent: %s", item.channel, item.user_id, exc)
    except Exception:  # never let a background thread die silently
        logger.exception("Sending notifications outside ATM failed")
    finally:
        db.close()


def dispatch(deliveries: list[Delivery]) -> None:
    if not deliveries:
        return
    if INLINE:
        deliver(deliveries)
    else:
        _executor.submit(deliver, deliveries)
