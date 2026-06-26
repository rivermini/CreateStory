"""JWT auth helpers and FastAPI dependencies."""

from __future__ import annotations

import uuid
import time
from collections import defaultdict, deque
from datetime import datetime, timezone
from threading import Lock
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from api.app_config import ACCESS_TOKEN_EXPIRES, JWT_ALGORITHM, JWT_SECRET_KEY
from api.db import get_db
from api.models.db_models import User
from api.repositories.auth_repository import AuthRepository
from api.service_client import set_request_identity

password_hasher = PasswordHasher()
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)
_job_rate_lock = Lock()
_job_rate_windows: dict[str, deque[float]] = defaultdict(deque)
_JOB_RATE_LIMIT = 10
_JOB_RATE_WINDOW_SECONDS = 60


def hash_password(password: str) -> str:
    return password_hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return password_hasher.verify(password_hash, password)
    except (InvalidHashError, VerificationError, VerifyMismatchError):
        return False


def create_access_token(user: User) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user.id),
        "email": user.email,
        "role": user.role,
        "iat": int(now.timestamp()),
        "exp": int((now + ACCESS_TOKEN_EXPIRES).timestamp()),
    }
    return jwt.encode(payload, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)


async def get_bearer_token(
    token: Annotated[str | None, Depends(oauth2_scheme)] = None,
) -> str:
    if token:
        return token
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Missing access token.",
        headers={"WWW-Authenticate": "Bearer"},
    )


async def get_current_user(
    token: Annotated[str, Depends(get_bearer_token)],
    db: Annotated[Session, Depends(get_db)],
) -> User:
    credentials_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired access token.",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
        subject = payload.get("sub")
        if subject is None:
            raise credentials_error
        user_id = uuid.UUID(subject)
    except (JWTError, ValueError):
        raise credentials_error

    user = AuthRepository(db).get_user_by_id(user_id)
    if user is None or not user.is_active:
        raise credentials_error
    set_request_identity(str(user.id), user.role)
    return user


async def require_active_user(current_user: Annotated[User, Depends(get_current_user)]) -> User:
    return current_user


async def require_operator(current_user: Annotated[User, Depends(get_current_user)]) -> User:
    if current_user.role not in {"operator", "admin"}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Operator role required.")
    return current_user


async def require_job_creation_rate(
    current_user: Annotated[User, Depends(require_operator)],
) -> User:
    now = time.monotonic()
    user_id = str(current_user.id)
    with _job_rate_lock:
        window = _job_rate_windows[user_id]
        while window and now - window[0] >= _JOB_RATE_WINDOW_SECONDS:
            window.popleft()
        if len(window) >= _JOB_RATE_LIMIT:
            retry_after = max(1, int(_JOB_RATE_WINDOW_SECONDS - (now - window[0])))
            raise HTTPException(
                status_code=429,
                detail="Job creation rate limit exceeded.",
                headers={"Retry-After": str(retry_after)},
            )
        window.append(now)
    return current_user


async def require_admin(current_user: Annotated[User, Depends(get_current_user)]) -> User:
    if current_user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required.")
    return current_user
