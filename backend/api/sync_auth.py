"""
Synchronous auth dependency compatible with the extended ``app.main`` backend's
JWT tokens.

The ``app`` backend issues tokens via ``app.core.security`` (HS256, ``SECRET_KEY``
from ``.env``, subject in the ``sub`` claim). The legacy ``core.auth`` dependency
instead expects a ``user_id`` claim and a different secret, so it cannot validate
those tokens. This module bridges the gap: it validates app-issued tokens while
using the synchronous ``core.database`` session, so the ported sync routers can
perform ``db.add``/``db.commit`` writes on the same session their user was loaded
from.
"""
import os

from dotenv import load_dotenv
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from core.database import User, get_db

# Load .env so SECRET_KEY matches app.core.config.settings.SECRET_KEY.
load_dotenv()
SECRET_KEY = os.getenv("SECRET_KEY", "change-me-in-production")
ALGORITHM = "HS256"

_bearer = HTTPBearer(auto_error=False)


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
    db: Session = Depends(get_db),
) -> User:
    """Validate a legacy or app-issued JWT and return the corresponding ``core`` User."""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    if not credentials or not credentials.credentials:
        raise credentials_exception

    try:
        payload = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        raise credentials_exception

    user_id = None
    if payload.get("type") == "access":
        subject = payload.get("sub")
        if subject is not None:
            try:
                user_id = int(subject)
            except (TypeError, ValueError):
                user_id = None
    else:
        user_id = payload.get("user_id")

    if user_id is None:
        raise credentials_exception

    try:
        user_id = int(user_id)
    except (TypeError, ValueError):
        raise credentials_exception

    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise credentials_exception
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Inactive user")

    return user
