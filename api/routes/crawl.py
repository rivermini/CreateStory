"""Crawl execution routes — start, stream (SSE), cancel, and status."""

import logging
import os
import re

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from api.models.crawl_request import (
    CrawlCancelResponse,
    CrawlRequest,
    CrawlStartResponse,
    ProgressUpdate,
)
from api.routes.crawl_stream import crawl_event_generator
from api.service_auth import current_owner, require_admin_identity, require_owner

logger = logging.getLogger(__name__)
MAX_CRAWL_BATCH = int(os.getenv("MAX_CRAWL_BATCH", "10"))

router = APIRouter(prefix="/api/crawl", tags=["Crawl"])


class InkittCookieUpdateRequest(BaseModel):
    cookies: str = Field(..., min_length=1, description="Inkitt cookies as Selenium JSON or a raw Cookie header.")


class InkittCookieUpdateResponse(BaseModel):
    updated: bool
    cookie_count: int


class InkittCookieStatusRequest(BaseModel):
    story_url: str | None = Field(default=None, description="Optional Inkitt story/chapter URL to test against.")


class InkittCookieStatusResponse(BaseModel):
    valid: bool | None
    reason: str
    message: str
    cookie_count: int
    tested_url: str | None = None


class ScribbleHubCookieUpdateRequest(BaseModel):
    cookies: str = Field(..., min_length=1, description="ScribbleHub cookies as Selenium JSON or a raw Cookie header (must include cf_clearance).")
    user_agent: str | None = Field(default=None, description="The exact browser User-Agent that generated cf_clearance.")


class ScribbleHubCookieUpdateResponse(BaseModel):
    updated: bool
    cookie_count: int
    has_cf_clearance: bool


class ScribbleHubCookieStatusRequest(BaseModel):
    story_url: str | None = Field(default=None, description="Optional ScribbleHub story/chapter URL to test against.")


class ScribbleHubCookieStatusResponse(BaseModel):
    valid: bool | None
    reason: str
    message: str
    cookie_count: int
    tested_url: str | None = None


@router.post("/start", response_model=CrawlStartResponse)
async def start_crawl(request: CrawlRequest, http_request: Request) -> CrawlStartResponse:
    """
    Start a new crawl session. Returns immediately with a crawl_id.

    Safety net: Wattpad Original (paywalled) stories are rejected with 400.
    """
    if request.spider_name == "wattpad":
        paywall_blocked = _check_and_reject_paywalled(request)
        if paywall_blocked:
            return paywall_blocked

    from api.services.crawler_service import CrawlCapacityError, get_crawl_service

    service = get_crawl_service()
    try:
        crawl_id = service.start_crawl(
            spider_name=request.spider_name,
            site_name=request.site_name,
            novel=request.novel,
            limit=request.limit,
            output_format=request.output_format,
            chapter_range=request.chapter_range,
            novel_name=request.novel_name,
            completed=request.completed,
            combine_chapters=request.combine_chapters,
            source_url=request.source_url,
            created_by_user_id=current_owner(http_request),
        )
    except CrawlCapacityError as exc:
        raise HTTPException(status_code=429, detail=str(exc), headers={"Retry-After": "30"}) from exc
    logger.info("Crawl started: %s", crawl_id)
    return CrawlStartResponse(crawl_id=crawl_id, status="running")


@router.post("/inkitt-cookies", response_model=InkittCookieUpdateResponse)
async def update_inkitt_cookies(request: InkittCookieUpdateRequest, http_request: Request) -> InkittCookieUpdateResponse:
    """Update the saved Inkitt login cookies used by the Inkitt spider."""
    require_admin_identity(http_request)
    from api.services.inkitt_cookie_service import update_inkitt_cookies as save_inkitt_cookies

    try:
        result = save_inkitt_cookies(request.cookies)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    logger.info("Updated Inkitt cookies: %d cookie(s)", result["cookie_count"])
    return InkittCookieUpdateResponse(**result)


@router.post("/inkitt-cookies/status", response_model=InkittCookieStatusResponse)
async def check_inkitt_cookies(request: InkittCookieStatusRequest, http_request: Request) -> InkittCookieStatusResponse:
    """Check whether saved Inkitt cookies can access a likely login-gated page."""
    require_admin_identity(http_request)
    from api.services.inkitt_cookie_service import check_inkitt_cookies as run_check

    result = run_check(request.story_url)
    logger.info(
        "Checked Inkitt cookies: valid=%s reason=%s tested_url=%s",
        result["valid"],
        result["reason"],
        result.get("tested_url"),
    )
    return InkittCookieStatusResponse(**result)


@router.post("/scribblehub-cookies", response_model=ScribbleHubCookieUpdateResponse)
async def update_scribblehub_cookies(request: ScribbleHubCookieUpdateRequest, http_request: Request) -> ScribbleHubCookieUpdateResponse:
    """Update the saved ScribbleHub session cookies (cf_clearance + matching User-Agent)."""
    require_admin_identity(http_request)
    from api.services.scribblehub_cookie_service import update_scribblehub_cookies as save_cookies

    try:
        result = save_cookies(request.cookies, request.user_agent)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    logger.info(
        "Updated ScribbleHub cookies: %d cookie(s), cf_clearance=%s",
        result["cookie_count"],
        result["has_cf_clearance"],
    )
    return ScribbleHubCookieUpdateResponse(**result)


@router.post("/scribblehub-cookies/status", response_model=ScribbleHubCookieStatusResponse)
async def check_scribblehub_cookies(request: ScribbleHubCookieStatusRequest, http_request: Request) -> ScribbleHubCookieStatusResponse:
    """Check whether saved ScribbleHub cookies clear the Cloudflare challenge."""
    require_admin_identity(http_request)
    from api.services.scribblehub_cookie_service import check_scribblehub_cookies as run_check

    result = run_check(request.story_url)
    logger.info(
        "Checked ScribbleHub cookies: valid=%s reason=%s tested_url=%s",
        result["valid"],
        result["reason"],
        result.get("tested_url"),
    )
    return ScribbleHubCookieStatusResponse(**result)


@router.post("/start-batch", response_model=list[CrawlStartResponse])
async def start_batch_crawl(requests: list[CrawlRequest], http_request: Request) -> list[CrawlStartResponse]:
    """
    Start multiple crawl sessions in parallel.

    Each request in the list is started in parallel. Returns a list of crawl_id+status
    for every submitted entry (including entries that are paywalled — returned with status='blocked').
    """
    from api.services.crawler_service import CrawlCapacityError, get_crawl_service

    if not requests or len(requests) > MAX_CRAWL_BATCH:
        raise HTTPException(
            status_code=422,
            detail=f"Batch must contain between 1 and {MAX_CRAWL_BATCH} crawl requests.",
        )

    service = get_crawl_service()
    results: list[CrawlStartResponse] = []

    for request in requests:
        if request.spider_name == "wattpad":
            blocked = _check_and_reject_paywalled(request)
            if blocked:
                results.append(blocked)
                continue

        try:
            crawl_id = service.start_crawl(
                spider_name=request.spider_name,
                site_name=request.site_name,
                novel=request.novel,
                limit=request.limit,
                output_format=request.output_format,
                chapter_range=request.chapter_range,
                novel_name=request.novel_name,
                completed=request.completed,
                combine_chapters=request.combine_chapters,
                source_url=request.source_url,
                created_by_user_id=current_owner(http_request),
            )
        except CrawlCapacityError as exc:
            raise HTTPException(status_code=429, detail=str(exc), headers={"Retry-After": "30"}) from exc
        logger.info("Batch crawl started: %s", crawl_id)
        results.append(CrawlStartResponse(crawl_id=crawl_id, status="running"))

    return results


def _check_and_reject_paywalled(request: CrawlRequest) -> CrawlStartResponse | None:
    """
    Safety-net check: if the Wattpad URL resolves to a paywalled story, reject the request.

    Returns a CrawlStartResponse with status='blocked' if blocked, None if allowed to proceed.
    """
    match = re.search(r"/story/(\d+)", request.novel)
    if not match:
        match = re.search(r"wattpad\.com/(\d+)-", request.novel)
    if not match:
        return None

    story_id = match.group(1)
    api_url = (
        f"https://www.wattpad.com/api/v3/stories/{story_id}"
        "?fields=id,title,isPaywalled"
    )

    try:
        from api.services.wattpad_api import get
        resp = get(api_url, story_id=story_id, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            if data.get("isPaywalled"):
                logger.warning(
                    "Rejected crawl for Wattpad Original story %s (%s) — paywalled.",
                    story_id,
                    data.get("title", ""),
                )
                return CrawlStartResponse(
                    crawl_id="",
                    status="blocked",
                )
    except Exception:
        pass

    return None


@router.get("/stream")
async def crawl_stream(
    request: Request,
    crawl_id: str = Query(..., description="The crawl session ID returned by /start"),
):
    """
    Server-Sent Events stream for live crawl progress.

    Emits: log, progress, done, error event types.
    """
    from api.services.crawler_service import get_crawl_service

    service = get_crawl_service()
    progress = service.get_progress(crawl_id)
    if progress is not None:
        require_owner(request, progress.created_by_user_id)

    async def _make_response(crawl_id: str):
        generator = crawl_event_generator(crawl_id)
        response = EventSourceResponse(generator)
        response.headers["X-Accel-Buffering"] = "no"
        response.headers["Cache-Control"] = "no-cache, no-transform"
        return response

    if crawl_id not in service._sessions:
        async def not_found_generator():
            import json
            yield {"event": "error", "data": json.dumps({"message": f"Crawl '{crawl_id}' not found."})}

        response = EventSourceResponse(not_found_generator())
        response.headers["X-Accel-Buffering"] = "no"
        response.headers["Cache-Control"] = "no-cache, no-transform"
        return response

    return await _make_response(crawl_id)


@router.delete("/cancel", response_model=CrawlCancelResponse)
async def cancel_crawl(
    request: Request,
    crawl_id: str = Query(..., description="The crawl session ID to cancel"),
) -> CrawlCancelResponse:
    """Cancel a running crawl session."""
    from api.services.crawler_service import get_crawl_service

    service = get_crawl_service()
    progress = service.get_progress(crawl_id)
    if progress is None:
        raise HTTPException(status_code=404, detail=f"Crawl '{crawl_id}' not found.")
    require_owner(request, progress.created_by_user_id)
    cancelled = service.cancel_crawl(crawl_id)
    return CrawlCancelResponse(crawl_id=crawl_id, cancelled=cancelled)


@router.get("/status", response_model=ProgressUpdate)
async def crawl_status(
    request: Request,
    crawl_id: str = Query(..., description="The crawl session ID"),
) -> ProgressUpdate:
    """Return the current progress for a crawl (polling fallback)."""
    from api.services.crawler_service import get_crawl_service

    service = get_crawl_service()
    progress = service.get_progress(crawl_id)
    if progress is None:
        return JSONResponse(
            status_code=404,
            content={"detail": f"Crawl '{crawl_id}' not found."},
        )
    require_owner(request, progress.created_by_user_id)
    return progress.to_progress_update()


@router.get("/status/{crawl_id}")
async def crawl_status_full(crawl_id: str, request: Request) -> dict:
    """Return full crawl status including progress and recent logs."""
    from api.services.crawler_service import get_crawl_service

    service = get_crawl_service()
    session = service.get_progress(crawl_id)
    if session is None:
        return JSONResponse(
            status_code=404,
            content={"detail": f"Crawl '{crawl_id}' not found."},
        )
    require_owner(request, session.created_by_user_id)
    return {
        "progress": session.to_progress_update(),
        "log_lines": session.log_lines[-100:],
    }


@router.get("/active")
async def active_crawls(request: Request) -> list[dict]:
    """Return all running and recently finished crawl sessions."""
    from api.services.crawler_service import get_crawl_service

    service = get_crawl_service()
    sessions = service.get_all_sessions()
    role = getattr(request.state, "create_story_role", None)
    user_id = getattr(request.state, "create_story_user_id", None)
    sessions = [
        session
        for session in sessions
        if role == "admin" or (session.created_by_user_id and session.created_by_user_id == user_id)
    ]
    return [
        {
            "crawl_id": s.crawl_id,
            "status": s.status,
            "chapters_crawled": s.chapters_crawled,
            "chapters_total": s.chapters_total,
            "current_title": s.current_title,
            "error_message": s.error_message,
            "started_at": s.started_at,
            "finished_at": s.finished_at,
            "novel_name": s.novel_name,
        }
        for s in sessions
    ]
