"""Authentication for requests from the CreateStory gateway."""

from __future__ import annotations

import os
import secrets
from pathlib import Path

from fastapi import HTTPException, Request, status
from fastapi.responses import JSONResponse

PUBLIC_HEALTH_PATHS = frozenset({"/", "/api"})


def internal_service_headers() -> dict[str, str]:
    token = _load_service_token()
    if not token:
        raise RuntimeError("INTERNAL_SERVICE_TOKEN is not configured.")
    return {"Authorization": f"Bearer {token}"}


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


def current_owner(request: Request) -> str | None:
    return getattr(request.state, "create_story_user_id", None)


def require_owner(request: Request, owner_id: str | None) -> None:
    role = getattr(request.state, "create_story_role", None)
    user_id = current_owner(request)
    if role in ("admin", "operator"):
        return
    if owner_id and owner_id == user_id:
        return
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found.")


def require_admin_identity(request: Request) -> None:
    if getattr(request.state, "create_story_role", None) != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required.")
