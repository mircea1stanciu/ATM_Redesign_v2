"""Encryption of personal secrets at rest (Fernet: AES-128-CBC with an HMAC)."""
import base64
import hashlib
import logging
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings

logger = logging.getLogger("atm.crypto")


class SecretUnreadable(Exception):
    """A stored secret cannot be decrypted with the current key (ATM_SECRET_KEY changed)."""


@lru_cache(maxsize=1)
def _fernet() -> Fernet:
    secret = settings.ATM_SECRET_KEY
    if not secret:
        logger.warning("ATM_SECRET_KEY is not set; personal tokens are encrypted with a key derived from SECRET_KEY.")
        secret = settings.SECRET_KEY
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(secret.encode("utf-8")).digest()))


def encrypt(value: str) -> str:
    return _fernet().encrypt(value.encode("utf-8")).decode("ascii")


def decrypt(token: str) -> str:
    try:
        return _fernet().decrypt(token.encode("ascii")).decode("utf-8")
    except InvalidToken as exc:
        raise SecretUnreadable("A stored token cannot be decrypted; enter it again in Settings.") from exc
