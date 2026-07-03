"""Authentication for requests from trusted CreateStory services."""

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
    # AutoAudio is a trusted internal service acting on system-created batches
    # (which have no per-user owner). Identify as admin so the BedReadVoices
    # owner checks (require_owner) authorise its batch management/download calls;
    # otherwise they fail closed (404) with no identity present.
    return {
        "Authorization": f"Bearer {token}",
        "X-CreateStory-Role": "admin",
    }


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
    if role == "admin" or (role is None and user_id is None):
        return
    if owner_id is None:
        # System-owned sessions (e.g. scheduled auto-scan cycles) are visible to
        # any authenticated caller — they have no per-user owner to scope to.
        return
    if owner_id and owner_id == user_id:
        return
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found.")
