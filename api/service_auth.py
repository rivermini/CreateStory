"""Authentication for requests from the CreateStory gateway."""

from __future__ import annotations

import os
import secrets
from pathlib import Path

from fastapi import HTTPException, Request, status
from fastapi.responses import JSONResponse

PUBLIC_HEALTH_PATHS = frozenset({"/", "/api"})


def _load_service_token() -> str:
    value = os.getenv("INTERNAL_SERVICE_TOKEN", "").strip()
    file_path = os.getenv("INTERNAL_SERVICE_TOKEN_FILE", "").strip()
    if not value and file_path:
        value = Path(file_path).read_text(encoding="utf-8").strip()
    return value


async def enforce_service_auth(request: Request, call_next):
    if request.url.path in PUBLIC_HEALTH_PATHS:
        return await call_next(request)
    token = _load_service_token()
    supplied = request.headers.get("Authorization", "")
    if not token or not secrets.compare_digest(supplied, f"Bearer {token}"):
        return JSONResponse(status_code=401, content={"detail": "Invalid service credentials."})
    request.state.create_story_user_id = request.headers.get("X-CreateStory-User-Id")
    request.state.create_story_role = request.headers.get("X-CreateStory-Role")
    return await call_next(request)


def require_owner(request: Request, owner_id: str | None) -> None:
    role = getattr(request.state, "create_story_role", None)
    user_id = getattr(request.state, "create_story_user_id", None)
    if role == "admin":
        return
    if owner_id and user_id == owner_id:
        return
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Crawl not found.")


def current_owner(request: Request) -> str:
    user_id = getattr(request.state, "create_story_user_id", None)
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing user identity.")
    return user_id


def require_admin_identity(request: Request) -> None:
    if getattr(request.state, "create_story_role", None) != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required.")


def require_operator_identity(request: Request) -> None:
    role = getattr(request.state, "create_story_role", None)
    if role not in ("admin", "operator"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Operator role required.")

