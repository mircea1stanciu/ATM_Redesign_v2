"""Posting to a project's Microsoft Teams channel through a Teams workflow webhook (open topic T3, after in-app)."""
import logging
from typing import Optional

import httpx

from app.core.crypto import SecretUnreadable, decrypt

logger = logging.getLogger("atm.notifications")
TIMEOUT_SECONDS = 10
# Tests replace this with httpx.MockTransport so no request leaves the process.
HTTP_TRANSPORT: Optional[httpx.AsyncBaseTransport] = None


def card(title: str, body: str, link: Optional[str]) -> dict:
    """A message with an Adaptive Card, the format Teams workflows ("When a Teams webhook request is received") post."""
    content: dict = {
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
        "type": "AdaptiveCard",
        "version": "1.4",
        "body": [
            {"type": "TextBlock", "text": title, "weight": "Bolder", "size": "Medium", "wrap": True},
            {"type": "TextBlock", "text": body, "wrap": True},
        ],
    }
    if link:
        content["actions"] = [{"type": "Action.OpenUrl", "title": "Open in ATM", "url": link}]
    return {"type": "message",
            "attachments": [{"contentType": "application/vnd.microsoft.card.adaptive", "content": content}]}


async def post(encrypted_webhook: Optional[str], title: str, body: str, link: Optional[str]) -> bool:
    """Post a card; a failure is logged, never raised (the in-app notification is what counts)."""
    if not encrypted_webhook:
        return False
    try:
        url = decrypt(encrypted_webhook)
    except SecretUnreadable:
        logger.warning("A project's Teams webhook cannot be decrypted; set it again in Admin › Projects.")
        return False
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS, transport=HTTP_TRANSPORT) as client:
            response = await client.post(url, json=card(title, body, link))
        if response.status_code >= 400:
            logger.warning("Teams answered %s to a notification", response.status_code)
            return False
        return True
    except httpx.HTTPError as exc:
        logger.warning("Could not post to Teams: %s", exc.__class__.__name__)
        return False
