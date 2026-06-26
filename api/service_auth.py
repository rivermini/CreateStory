"""Authentication for requests from the CreateStory gateway."""

from __future__ import annotations

import os
import secrets
from contextvars import ContextVar
from pathlib import Path

from fastapi import Request
from fastapi.responses import JSONResponse

PUBLIC_HEALTH_PATHS = frozenset({"/", "/api"})
_request_owner: ContextVar[str | None] = ContextVar("drive_sync_request_owner", default=None)


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
    owner_id = request.headers.get("X-CreateStory-User-Id")
    request.state.create_story_user_id = owner_id
    request.state.create_story_role = request.headers.get("X-CreateStory-Role")
    reset_token = _request_owner.set(owner_id)
    try:
        return await call_next(request)
    finally:
        _request_owner.reset(reset_token)


def current_owner() -> str | None:
    return _request_owner.get()
