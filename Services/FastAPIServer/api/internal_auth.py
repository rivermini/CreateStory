"""Authentication for private gateway-to-worker APIs."""

from __future__ import annotations

import secrets
from typing import Annotated

from fastapi import Header, HTTPException, status

from api.app_config import INTERNAL_SERVICE_TOKEN


def require_internal_service(
    authorization: Annotated[str | None, Header()] = None,
) -> None:
    expected = f"Bearer {INTERNAL_SERVICE_TOKEN}"
    if not authorization or not secrets.compare_digest(authorization, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid service credentials.",
            headers={"WWW-Authenticate": "Bearer"},
        )
