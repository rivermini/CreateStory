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


@router.post("/inkitt-cookies", dependencies=[Depends(require_operator)])
async def update_inkitt_cookies(request: dict = Body(...)) -> JSONResponse:
    """Update saved Inkitt login cookies in the NovelCrawler service."""
    return await _forward_request("POST", "/api/crawl/inkitt-cookies", json_body=request)


@router.post("/inkitt-cookies/status", dependencies=[Depends(require_operator)])
async def check_inkitt_cookies(request: dict | None = Body(default=None)) -> JSONResponse:
    """Check saved Inkitt login cookies in the NovelCrawler service."""
    return await _forward_request("POST", "/api/crawl/inkitt-cookies/status", json_body=request or {})


@router.post("/scribblehub-cookies", dependencies=[Depends(require_operator)])
async def update_scribblehub_cookies(request: dict = Body(...)) -> JSONResponse:
    """Update saved ScribbleHub session cookies (cf_clearance + User-Agent) in the NovelCrawler service."""
    return await _forward_request("POST", "/api/crawl/scribblehub-cookies", json_body=request)


@router.post("/scribblehub-cookies/status", dependencies=[Depends(require_operator)])
async def check_scribblehub_cookies(request: dict | None = Body(default=None)) -> JSONResponse:
    """Check saved ScribbleHub session cookies in the NovelCrawler service."""
    return await _forward_request("POST", "/api/crawl/scribblehub-cookies/status", json_body=request or {})


@router.post("/goodnovel-cookies", dependencies=[Depends(require_operator)])
async def update_goodnovel_cookies(request: dict = Body(...)) -> JSONResponse:
    """Update saved GoodNovel session cookies in the NovelCrawler service."""
    return await _forward_request("POST", "/api/crawl/goodnovel-cookies", json_body=request)


@router.post("/goodnovel-cookies/status", dependencies=[Depends(require_operator)])
async def check_goodnovel_cookies(request: dict | None = Body(default=None)) -> JSONResponse:
    """Check saved GoodNovel session cookies in the NovelCrawler service."""
    return await _forward_request("POST", "/api/crawl/goodnovel-cookies/status", json_body=request or {})


@router.post("/webnovel-cookies", dependencies=[Depends(require_operator)])
async def update_webnovel_cookies(request: dict = Body(...)) -> JSONResponse:
    """Update saved WebNovel cookies in the NovelCrawler service."""
    return await _forward_request("POST", "/api/crawl/webnovel-cookies", json_body=request)


@router.post("/webnovel-cookies/status", dependencies=[Depends(require_operator)])
async def check_webnovel_cookies(request: dict | None = Body(default=None)) -> JSONResponse:
    """Check saved WebNovel cookies in the NovelCrawler service."""
    return await _forward_request("POST", "/api/crawl/webnovel-cookies/status", json_body=request or {})


@router.post("/goodnovel-batch/scan", dependencies=[Depends(require_job_creation_rate)])
async def start_goodnovel_batch_scan(request: dict = Body(...)) -> JSONResponse:
    """Start a GoodNovel title scan batch."""
    return await _forward_request("POST", "/api/crawl/goodnovel-batch/scan", json_body=request)


@router.post("/inkitt-batch/start", dependencies=[Depends(require_job_creation_rate)])
async def start_inkitt_batch(request: dict = Body(...)) -> JSONResponse:
    """Start an Inkitt free completed genre batch."""
    return await _forward_request("POST", "/api/crawl/inkitt-batch/start", json_body=request)


@router.get("/inkitt-batch")
async def list_inkitt_batches() -> JSONResponse:
    """Return Inkitt batch history."""
    return await _forward_request("GET", "/api/crawl/inkitt-batch")


@router.get("/inkitt-batch/{batch_id}")
async def get_inkitt_batch_status(batch_id: str) -> JSONResponse:
    """Return Inkitt batch status."""
    return await _forward_request("GET", f"/api/crawl/inkitt-batch/{batch_id}")


@router.post("/inkitt-batch/{batch_id}/crawl", dependencies=[Depends(require_job_creation_rate)])
async def crawl_inkitt_batch(batch_id: str, request: dict = Body(...)) -> JSONResponse:
    """Start or resume an Inkitt batch crawl."""
    return await _forward_request("POST", f"/api/crawl/inkitt-batch/{batch_id}/crawl", json_body=request)


@router.post("/inkitt-batch/{batch_id}/pause", dependencies=[Depends(require_operator)])
async def pause_inkitt_batch(batch_id: str) -> JSONResponse:
    """Gracefully pause an active Inkitt batch crawl."""
    return await _forward_request("POST", f"/api/crawl/inkitt-batch/{batch_id}/pause", json_body={})


@router.get("/inkitt-batch/{batch_id}/rows")
async def list_inkitt_batch_rows(
    batch_id: str,
    offset: int = Query(default=0),
    limit: int = Query(default=100),
    status: str = Query(default="all"),
) -> JSONResponse:
    """Return a paged slice of Inkitt batch rows."""
    return await _forward_request(
        "GET",
        f"/api/crawl/inkitt-batch/{batch_id}/rows",
        params={"offset": offset, "limit": limit, "status": status},
    )


@router.delete("/inkitt-batch/{batch_id}", dependencies=[Depends(require_operator)])
async def delete_inkitt_batch(batch_id: str) -> JSONResponse:
    """Delete an Inkitt batch history entry."""
    return await _forward_request("DELETE", f"/api/crawl/inkitt-batch/{batch_id}")


@router.get("/goodnovel-batch")
async def list_goodnovel_batches() -> JSONResponse:
    """Return GoodNovel batch history."""
    return await _forward_request("GET", "/api/crawl/goodnovel-batch")


@router.get("/goodnovel-batch/{batch_id}")
async def get_goodnovel_batch_status(batch_id: str) -> JSONResponse:
    """Return GoodNovel batch status."""
    return await _forward_request("GET", f"/api/crawl/goodnovel-batch/{batch_id}")


@router.get("/goodnovel-batch/{batch_id}/rows")
async def list_goodnovel_batch_rows(
    batch_id: str,
    offset: int = Query(default=0),
    limit: int = Query(default=100),
    status: str = Query(default="all"),
) -> JSONResponse:
    """Return a paged slice of GoodNovel batch rows."""
    return await _forward_request(
        "GET",
        f"/api/crawl/goodnovel-batch/{batch_id}/rows",
        params={"offset": offset, "limit": limit, "status": status},
    )


@router.delete("/goodnovel-batch/{batch_id}", dependencies=[Depends(require_operator)])
async def delete_goodnovel_batch(batch_id: str) -> JSONResponse:
    """Delete a GoodNovel batch history entry."""
    return await _forward_request("DELETE", f"/api/crawl/goodnovel-batch/{batch_id}")


@router.post("/goodnovel-batch/{batch_id}/crawl", dependencies=[Depends(require_job_creation_rate)])
async def start_goodnovel_batch_crawl(batch_id: str, request: dict = Body(...)) -> JSONResponse:
    """Start crawling found stories in a GoodNovel batch."""
    return await _forward_request("POST", f"/api/crawl/goodnovel-batch/{batch_id}/crawl", json_body=request)


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
