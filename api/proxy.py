"""Consistent JSON and streaming gateway proxy helpers."""

from __future__ import annotations

from typing import Any

import httpx
from fastapi.responses import JSONResponse, StreamingResponse
from starlette.background import BackgroundTask

from api.middleware import get_shared_http_client
from api.service_client import current_request_id

_SAFE_RESPONSE_HEADERS = {
    "accept-ranges",
    "cache-control",
    "content-disposition",
    "content-length",
    "content-range",
    "etag",
    "last-modified",
}


def _error_body(detail: str, code: str) -> dict[str, str]:
    return {
        "detail": detail,
        "code": code,
        "request_id": current_request_id(),
    }


def _upstream_json(response: httpx.Response) -> Any:
    try:
        return response.json()
    except ValueError:
        return None


def _upstream_error(response: httpx.Response) -> JSONResponse:
    body = _upstream_json(response)
    if isinstance(body, dict):
        body.setdefault("detail", response.reason_phrase or f"HTTP {response.status_code}")
        body.setdefault("code", "upstream_error")
        body.setdefault("request_id", current_request_id())
    else:
        body = _error_body(
            response.text or response.reason_phrase or f"HTTP {response.status_code}",
            "upstream_error",
        )
    return JSONResponse(status_code=response.status_code, content=body)


async def json_proxy(
    method: str,
    url: str,
    *,
    params: dict[str, Any] | None = None,
    json_body: Any = None,
    headers: dict[str, str] | None = None,
    timeout: float = 120.0,
) -> JSONResponse:
    client = get_shared_http_client()
    try:
        response = await client.request(
            method,
            url,
            params=params,
            json=json_body,
            headers=headers,
            timeout=timeout,
        )
    except httpx.TimeoutException:
        return JSONResponse(status_code=504, content=_error_body("Upstream request timed out.", "upstream_timeout"))
    except httpx.RequestError:
        return JSONResponse(status_code=502, content=_error_body("Upstream service is unavailable.", "upstream_unavailable"))

    if response.status_code >= 400:
        return _upstream_error(response)
    body = _upstream_json(response)
    if body is None:
        body = {}
    return JSONResponse(status_code=response.status_code, content=body)


async def streaming_proxy(
    method: str,
    url: str,
    *,
    params: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
    timeout: float = 300.0,
) -> StreamingResponse | JSONResponse:
    client = get_shared_http_client()
    request = client.build_request(method, url, params=params, headers=headers)
    request.extensions["timeout"] = httpx.Timeout(timeout).as_dict()
    try:
        response = await client.send(request, stream=True)
    except httpx.TimeoutException:
        return JSONResponse(status_code=504, content=_error_body("Upstream request timed out.", "upstream_timeout"))
    except httpx.RequestError:
        return JSONResponse(status_code=502, content=_error_body("Upstream service is unavailable.", "upstream_unavailable"))

    if response.status_code >= 400:
        await response.aread()
        result = _upstream_error(response)
        await response.aclose()
        return result

    response_headers = {
        key: value
        for key, value in response.headers.items()
        if key.lower() in _SAFE_RESPONSE_HEADERS
    }
    return StreamingResponse(
        response.aiter_bytes(),
        status_code=response.status_code,
        media_type=response.headers.get("content-type", "application/octet-stream"),
        headers=response_headers,
        background=BackgroundTask(response.aclose),
    )
