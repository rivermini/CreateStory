"""Authenticated HTTP client helpers for gateway-to-worker calls."""

from __future__ import annotations

from contextvars import ContextVar
from typing import Any

import httpx

from api.app_config import INTERNAL_SERVICE_TOKEN

_request_identity: ContextVar[tuple[str, str] | None] = ContextVar(
    "create_story_request_identity",
    default=None,
)
_request_id: ContextVar[str | None] = ContextVar("create_story_request_id", default=None)


def set_request_identity(user_id: str, role: str):
    return _request_identity.set((user_id, role))


def clear_request_identity():
    return _request_identity.set(None)


def reset_request_identity(token) -> None:
    _request_identity.reset(token)


def current_request_identity() -> tuple[str, str] | None:
    return _request_identity.get()


def set_request_id(request_id: str):
    return _request_id.set(request_id)


def reset_request_id(token) -> None:
    _request_id.reset(token)


def current_request_id() -> str:
    return _request_id.get() or "unknown"


async def inject_service_headers(request: httpx.Request) -> None:
    request.headers["Authorization"] = f"Bearer {INTERNAL_SERVICE_TOKEN}"
    request.headers["X-Request-ID"] = current_request_id()
    identity = _request_identity.get()
    if identity is not None:
        user_id, role = identity
        request.headers["X-CreateStory-User-Id"] = user_id
        request.headers["X-CreateStory-Role"] = role


def service_async_client(*args: Any, **kwargs: Any) -> httpx.AsyncClient:
    hooks = dict(kwargs.pop("event_hooks", {}) or {})
    hooks["request"] = [*hooks.get("request", []), inject_service_headers]
    return httpx.AsyncClient(*args, event_hooks=hooks, **kwargs)
