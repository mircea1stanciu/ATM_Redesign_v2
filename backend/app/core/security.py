"""Access tokens (JWT, HS256) and password hashing."""
from datetime import datetime, timedelta
from typing import Optional

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.core.config import settings

ALGORITHM = "HS256"
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Create an access token. `data` carries user_id, username, role and organization_id."""
    to_encode = data.copy()
    if to_encode.get("user_id") is not None:
        to_encode.setdefault("sub", str(to_encode["user_id"]))
        to_encode.setdefault("type", "access")
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> Optional[dict]:
    """Return the token's claims, or None when it is invalid or expired."""
    try:
        return jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        return None


def token_user_id(payload: dict) -> Optional[int]:
    """User id of a token: the user_id claim, or sub for tokens issued by the removed second backend."""
    raw = payload.get("user_id")
    if raw is None and payload.get("type") == "access":
        raw = payload.get("sub")
    try:
        return int(raw) if raw is not None else None
    except (TypeError, ValueError):
        return None
