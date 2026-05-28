"""Crawl execution routes — start, stream (SSE), cancel, and status."""

import logging
import re
from typing import Annotated

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse
from sse_starlette.sse import EventSourceResponse

from api.models.crawl_request import (
    CrawlCancelResponse,
    CrawlRequest,
    CrawlStartResponse,
    ProgressUpdate,
)
from api.routes.crawl_stream import crawl_event_generator

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/crawl", tags=["Crawl"])


@router.post("/start", response_model=CrawlStartResponse)
async def start_crawl(request: CrawlRequest) -> CrawlStartResponse:
    """
    Start a new crawl session. Returns immediately with a crawl_id.

    Safety net: Wattpad Original (paywalled) stories are rejected with 400.
    """
    if request.spider_name == "wattpad":
        paywall_blocked = _check_and_reject_paywalled(request)
        if paywall_blocked:
            return paywall_blocked

    from api.services.crawler_service import get_crawl_service

    service = get_crawl_service()
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
    )
    logger.info("Crawl started: %s", crawl_id)
    return CrawlStartResponse(crawl_id=crawl_id, status="running")


@router.post("/start-batch", response_model=list[CrawlStartResponse])
async def start_batch_crawl(requests: list[CrawlRequest]) -> list[CrawlStartResponse]:
    """
    Start multiple crawl sessions in parallel.

    Each request in the list is started in parallel. Returns a list of crawl_id+status
    for every submitted entry (including entries that are paywalled — returned with status='blocked').
    """
    from api.services.crawler_service import get_crawl_service

    service = get_crawl_service()
    results: list[CrawlStartResponse] = []

    for request in requests:
        if request.spider_name == "wattpad":
            blocked = _check_and_reject_paywalled(request)
            if blocked:
                results.append(blocked)
                continue

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
        )
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
    crawl_id: str = Query(..., description="The crawl session ID returned by /start"),
):
    """
    Server-Sent Events stream for live crawl progress.

    Emits: log, progress, done, error event types.
    """
    from api.services.crawler_service import get_crawl_service

    service = get_crawl_service()

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
    crawl_id: str = Query(..., description="The crawl session ID to cancel"),
) -> CrawlCancelResponse:
    """Cancel a running crawl session."""
    from api.services.crawler_service import get_crawl_service

    service = get_crawl_service()
    cancelled = service.cancel_crawl(crawl_id)
    return CrawlCancelResponse(crawl_id=crawl_id, cancelled=cancelled)


@router.get("/status", response_model=ProgressUpdate)
async def crawl_status(
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
    return progress.to_progress_update()


@router.get("/status/{crawl_id}")
async def crawl_status_full(crawl_id: str) -> dict:
    """Return full crawl status including progress and recent logs."""
    from api.services.crawler_service import get_crawl_service

    service = get_crawl_service()
    session = service.get_progress(crawl_id)
    if session is None:
        return JSONResponse(
            status_code=404,
            content={"detail": f"Crawl '{crawl_id}' not found."},
        )
    return {
        "progress": session.to_progress_update(),
        "log_lines": session.log_lines[-100:],
    }


@router.get("/active")
async def active_crawls() -> list[dict]:
    """Return all running and recently finished crawl sessions."""
    from api.services.crawler_service import get_crawl_service

    service = get_crawl_service()
    sessions = service.get_all_sessions()
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
