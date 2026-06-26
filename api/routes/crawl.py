"""Crawl routes — proxy to NovelCrawler."""

from __future__ import annotations

import os
from typing import Any

from fastapi import APIRouter, Body, Depends, Query
from fastapi.responses import JSONResponse, StreamingResponse

from api.auth import require_active_user, require_admin, require_job_creation_rate, require_operator
from api.proxy import json_proxy, streaming_proxy

router = APIRouter(prefix="/api/crawl", tags=["Crawl"], dependencies=[Depends(require_active_user)])


def _nc_url() -> str:
    return os.environ.get("SERVICE_URLS_NovelCrawler", "http://localhost:8002").rstrip("/")


async def _forward_request(
    method: str,
    path: str,
    json_body: Any = None,
    params: dict | None = None,
) -> JSONResponse | StreamingResponse:
    """Forward an HTTP request to NovelCrawler."""
    url = f"{_nc_url()}{path}"
    if path == "/api/crawl/stream":
        return await streaming_proxy(method, url, params=params, timeout=300.0)
    return await json_proxy(method, url, params=params, json_body=json_body, timeout=300.0)


@router.post("/start", dependencies=[Depends(require_job_creation_rate)])
async def start_crawl(request: dict = Body(...)) -> JSONResponse:
    """Start a new crawl session."""
    result = await _forward_request("POST", "/api/crawl/start", json_body=request)
    return result


@router.post("/start-batch", dependencies=[Depends(require_job_creation_rate)])
async def start_batch_crawl(request: list[dict] = Body(...)) -> JSONResponse:
    """Start multiple crawl sessions at once."""
    result = await _forward_request("POST", "/api/crawl/start-batch", json_body=request)
    return result


@router.post("/inkitt-cookies", dependencies=[Depends(require_admin)])
async def update_inkitt_cookies(request: dict = Body(...)) -> JSONResponse:
    """Update saved Inkitt login cookies in the NovelCrawler service."""
    import httpx

    url = f"{_nc_url()}/api/crawl/inkitt-cookies"
    async with service_async_client(timeout=30.0) as client:
        resp = await client.post(url, json=request)
        try:
            content = resp.json()
        except ValueError:
            content = {"detail": resp.text or f"HTTP {resp.status_code}"}
        return JSONResponse(content=content, status_code=resp.status_code)


@router.post("/inkitt-cookies/status", dependencies=[Depends(require_admin)])
async def check_inkitt_cookies(request: dict | None = Body(default=None)) -> JSONResponse:
    """Check saved Inkitt login cookies in the NovelCrawler service."""
    import httpx

    url = f"{_nc_url()}/api/crawl/inkitt-cookies/status"
    async with service_async_client(timeout=45.0) as client:
        resp = await client.post(url, json=request or {})
        try:
            content = resp.json()
        except ValueError:
            content = {"detail": resp.text or f"HTTP {resp.status_code}"}
        return JSONResponse(content=content, status_code=resp.status_code)


@router.post("/scribblehub-cookies", dependencies=[Depends(require_admin)])
async def update_scribblehub_cookies(request: dict = Body(...)) -> JSONResponse:
    """Update saved ScribbleHub session cookies (cf_clearance + User-Agent) in the NovelCrawler service."""
    import httpx

    url = f"{_nc_url()}/api/crawl/scribblehub-cookies"
    async with service_async_client(timeout=30.0) as client:
        resp = await client.post(url, json=request)
        try:
            content = resp.json()
        except ValueError:
            content = {"detail": resp.text or f"HTTP {resp.status_code}"}
        return JSONResponse(content=content, status_code=resp.status_code)


@router.post("/scribblehub-cookies/status", dependencies=[Depends(require_admin)])
async def check_scribblehub_cookies(request: dict | None = Body(default=None)) -> JSONResponse:
    """Check saved ScribbleHub session cookies in the NovelCrawler service."""
    import httpx

    url = f"{_nc_url()}/api/crawl/scribblehub-cookies/status"
    async with service_async_client(timeout=45.0) as client:
        resp = await client.post(url, json=request or {})
        try:
            content = resp.json()
        except ValueError:
            content = {"detail": resp.text or f"HTTP {resp.status_code}"}
        return JSONResponse(content=content, status_code=resp.status_code)


@router.get("/stream")
async def crawl_stream(crawl_id: str = Query(...)) -> StreamingResponse:
    """Server-Sent Events stream for live crawl progress."""
    result = await _forward_request("GET", "/api/crawl/stream", params={"crawl_id": crawl_id})
    return result


@router.delete("/cancel", dependencies=[Depends(require_operator)])
async def cancel_crawl(crawl_id: str = Query(...)) -> JSONResponse:
    """Cancel a running crawl session."""
    result = await _forward_request("DELETE", "/api/crawl/cancel", params={"crawl_id": crawl_id})
    return result


@router.get("/status")
async def crawl_status(crawl_id: str = Query(...)) -> JSONResponse:
    """Return the current progress for a crawl."""
    result = await _forward_request("GET", "/api/crawl/status", params={"crawl_id": crawl_id})
    return result


@router.get("/status/{crawl_id}")
async def crawl_status_full(crawl_id: str) -> JSONResponse:
    """Return full crawl status including progress and recent logs."""
    result = await _forward_request("GET", f"/api/crawl/status/{crawl_id}")
    return result


@router.get("/active")
async def active_crawls() -> JSONResponse:
    """Return all running and recently finished crawl sessions."""
    result = await _forward_request("GET", "/api/crawl/active")
    return result
