"""Shared HTTP client and FastAPI middleware for FastAPIServer."""

from __future__ import annotations

import asyncio
import logging
import os
import uuid
from typing import TYPE_CHECKING

import httpx
from api.service_client import (
    clear_request_identity,
    inject_service_headers,
    reset_request_id,
    reset_request_identity,
    set_request_id,
)
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response
from starlette.responses import JSONResponse

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)
MAX_REQUEST_BODY_BYTES = int(os.getenv("MAX_REQUEST_BODY_BYTES", str(2 * 1024 * 1024)))

# Module-level shared client — initialized in lifespan, closed on shutdown.
_shared_client: httpx.AsyncClient | None = None
# Dedicated client + concurrency cap for long-lived streams (SSE / audio & zip
# downloads) so they cannot starve the JSON proxy pool.
_shared_stream_client: httpx.AsyncClient | None = None
_STREAM_MAX_CONCURRENT = int(os.getenv("STREAM_MAX_CONCURRENT", "24"))
_stream_semaphore: "asyncio.Semaphore | None" = None


# ── Retry transport ──────────────────────────────────────────────────────────────


class _RetryTransport(httpx.AsyncBaseTransport):
    """Async transport wrapper that retries on transient failures.

    Retries idempotent methods (GET / HEAD / OPTIONS) on retryable HTTP status
    codes (502, 503, 504) and on transient network errors: ``httpx.PoolTimeout``,
    ``httpx.ConnectError``, ``httpx.ReadError`` and ``httpx.RemoteProtocolError``
    — the "server disconnected without sending a response" race that happens when
    a pooled keep-alive connection is reused at the same moment the upstream
    closes it. Non-idempotent methods (POST / PUT / PATCH / DELETE) are never
    retried.
    """

    _IDEMPOTENT_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})

    def __init__(
        self,
        retries: int = 3,
        backoff_factor: float = 0.3,
        retry_on: tuple[int, ...] = (502, 503, 504),
    ) -> None:
        self._retries = retries
        self._backoff_factor = backoff_factor
        self._retry_on = retry_on
        self._inner = httpx.AsyncHTTPTransport()

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        method = request.method.upper()
        is_idempotent = method in self._IDEMPOTENT_METHODS
        last_exc: Exception | None = None
        max_attempts = self._retries + 1 if is_idempotent else 1

        for attempt in range(max_attempts):
            try:
                response = await self._inner.handle_async_request(request)
                if (
                    is_idempotent
                    and attempt < self._retries
                    and response.status_code in self._retry_on
                ):
                    await asyncio.sleep(self._backoff_factor * (2**attempt))
                    request = request.copy()
                    continue
                return response
            except (
                httpx.PoolTimeout,
                httpx.ConnectError,
                httpx.ReadError,
                httpx.RemoteProtocolError,
            ) as exc:
                last_exc = exc
                if is_idempotent and attempt < self._retries:
                    await asyncio.sleep(self._backoff_factor * (2**attempt))
                    request = request.copy()
                    continue
                raise
        raise last_exc or RuntimeError("RetryTransport: unexpected retry exhaustion")

    async def aclose(self) -> None:
        await self._inner.aclose()


# ── Shared client factory ───────────────────────────────────────────────────────


def get_shared_http_client() -> httpx.AsyncClient:
    """Return the lifespan-managed shared ``httpx.AsyncClient``."""
    if _shared_client is None:
        raise RuntimeError(
            "Shared HTTP client not initialised — call "
            "init_shared_http_client() in the FastAPI lifespan first."
        )
    return _shared_client


def get_shared_stream_http_client() -> httpx.AsyncClient:
    """Return the dedicated client for long-lived streaming proxies."""
    if _shared_stream_client is None:
        raise RuntimeError("Shared stream HTTP client not initialised.")
    return _shared_stream_client


def get_stream_semaphore() -> "asyncio.Semaphore":
    if _stream_semaphore is None:
        raise RuntimeError("Stream semaphore not initialised.")
    return _stream_semaphore


def init_shared_http_client() -> None:
    """Create the module-level ``httpx.AsyncClient`` (call from lifespan startup)."""
    global _shared_client, _shared_stream_client, _stream_semaphore
    if _shared_client is not None:
        return
    _shared_client = httpx.AsyncClient(
        timeout=httpx.Timeout(30.0, connect=10.0),
        limits=httpx.Limits(max_connections=40, max_keepalive_connections=20),
        transport=_RetryTransport(),
        event_hooks={"request": [inject_service_headers]},
    )
    # Separate pool for long-lived streams so a burst can't starve JSON calls.
    _shared_stream_client = httpx.AsyncClient(
        timeout=httpx.Timeout(300.0, connect=10.0),
        limits=httpx.Limits(max_connections=_STREAM_MAX_CONCURRENT, max_keepalive_connections=0),
        transport=_RetryTransport(),
        event_hooks={"request": [inject_service_headers]},
    )
    _stream_semaphore = asyncio.Semaphore(_STREAM_MAX_CONCURRENT)
    logger.info("Shared httpx clients initialised (json + stream, stream cap=%d).", _STREAM_MAX_CONCURRENT)


async def close_shared_http_client() -> None:
    """Close the shared ``httpx.AsyncClient`` (call from lifespan shutdown)."""
    global _shared_client, _shared_stream_client
    if _shared_client is not None:
        await _shared_client.aclose()
        _shared_client = None
    if _shared_stream_client is not None:
        await _shared_stream_client.aclose()
        _shared_stream_client = None
    logger.info("Shared httpx clients closed.")


# ── Security-headers middleware ────────────────────────────────────────────────


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Inject HTTP security headers on every response.

    Applies the following response headers:

    - ``Strict-Transport-Security``  — enforce HTTPS (including subdomains, 1-year max-age)
    - ``X-Content-Type-Options``     — disable MIME sniffing
    - ``X-Frame-Options``            — prevent clickjacking via iframe embedding
    - ``Referrer-Policy``            — limit referrer information sent to third parties
    - ``Content-Security-Policy``    — basic restrictive policy (upgrade-insecure-requests
      in production; looser default for local dev)
    """

    _CSP_DEV = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws: wss:; frame-ancestors 'none'"
    _CSP_PROD = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; upgrade-insecure-requests"

    # Paths that serve Swagger UI / ReDoc and need to load assets from CDNs.
    _DOCS_PATHS = ("/docs", "/redoc", "/openapi.json")

    async def dispatch(self, request: Request, call_next) -> Response:
        response: Response = await call_next(request)
        is_prod = os.environ.get("ENVIRONMENT", "development").lower() in ("production", "prod")
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        if not any(request.url.path.startswith(p) for p in self._DOCS_PATHS):
            response.headers["Content-Security-Policy"] = self._CSP_PROD if is_prod else self._CSP_DEV
        return response


class RequestBodyLimitMiddleware(BaseHTTPMiddleware):
    """Reject request bodies larger than the configured gateway limit."""

    async def dispatch(self, request: Request, call_next) -> Response:
        content_length = request.headers.get("content-length")
        if content_length:
            try:
                if int(content_length) > MAX_REQUEST_BODY_BYTES:
                    request_id = getattr(request.state, "request_id", "unknown")
                    return JSONResponse(
                        status_code=413,
                        content={
                            "detail": "Request body exceeds the 2 MiB limit.",
                            "code": "request_too_large",
                            "request_id": request_id,
                        },
                    )
            except ValueError:
                pass
        return await call_next(request)


# ── Request-ID middleware ───────────────────────────────────────────────────────


class RequestIDMiddleware(BaseHTTPMiddleware):
    """Add a ``X-Request-ID`` response header to every request.

    Uses the ``X-Request-ID`` header from the incoming request if present,
    otherwise generates a fresh UUID v4.  The resolved request id is stored
    on ``request.state.request_id`` and emitted on the access log line.
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        identity_token = clear_request_identity()
        try:
            request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
            request_id_token = set_request_id(request_id)
            request.state.request_id = request_id
            logger.info("[%s] %s %s", request_id, request.method, request.url.path)
            response: Response = await call_next(request)
            if request.url.path.startswith("/internal/"):
                for header in (
                    "access-control-allow-origin",
                    "access-control-allow-credentials",
                    "access-control-expose-headers",
                ):
                    if header in response.headers:
                        del response.headers[header]
            response.headers["X-Request-ID"] = request_id
            logger.info("[%s] %s %s -> %s", request_id, request.method, request.url.path, response.status_code)
            return response
        finally:
            if "request_id_token" in locals():
                reset_request_id(request_id_token)
            reset_request_identity(identity_token)
