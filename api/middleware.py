"""Shared HTTP client and FastAPI middleware for FastAPIServer."""

from __future__ import annotations

import asyncio
import logging
import os
import uuid
from typing import TYPE_CHECKING

import httpx
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)

# Module-level shared client — initialized in lifespan, closed on shutdown.
_shared_client: httpx.AsyncClient | None = None


# ── Retry transport ──────────────────────────────────────────────────────────────


class _RetryTransport(httpx.AsyncBaseTransport):
    """Async transport wrapper that retries on transient failures.

    Retries on HTTP 502, 503, 504 and on network-level ``httpx.PoolTimeout``.
    Retries on any method, but only when the response is a retryable status
    code (GET / HEAD / OPTIONS on 5xx) — non-idempotent methods (POST / PUT /
    PATCH / DELETE) are never retried.
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
            except (httpx.PoolTimeout, httpx.ConnectError, httpx.ReadError) as exc:
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


def init_shared_http_client() -> None:
    """Create the module-level ``httpx.AsyncClient`` (call from lifespan startup)."""
    global _shared_client
    if _shared_client is not None:
        return
    _shared_client = httpx.AsyncClient(
        timeout=httpx.Timeout(30.0, connect=10.0),
        limits=httpx.Limits(max_connections=40, max_keepalive_connections=20),
        transport=_RetryTransport(),
    )
    logger.info("Shared httpx.AsyncClient initialised.")


async def close_shared_http_client() -> None:
    """Close the shared ``httpx.AsyncClient`` (call from lifespan shutdown)."""
    global _shared_client
    if _shared_client is not None:
        await _shared_client.aclose()
        _shared_client = None
        logger.info("Shared httpx.AsyncClient closed.")


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


# ── Request-ID middleware ───────────────────────────────────────────────────────


class RequestIDMiddleware(BaseHTTPMiddleware):
    """Add a ``X-Request-ID`` response header to every request.

    Uses the ``X-Request-ID`` header from the incoming request if present,
    otherwise generates a fresh UUID v4.  The resolved request id is stored
    on ``request.state.request_id`` and emitted on the access log line.
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
        request.state.request_id = request_id
        logger.info("[%s] %s %s", request_id, request.method, request.url.path)
        response: Response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        logger.info("[%s] %s %s -> %s", request_id, request.method, request.url.path, response.status_code)
        return response
