"""Crawl execution routes — start, stream (SSE), cancel, and status."""

import logging
import os
import re
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator
from sse_starlette.sse import EventSourceResponse

from api.models.crawl_request import (
    CrawlCancelResponse,
    CrawlRequest,
    CrawlStartResponse,
    LogEntry,
    ProgressUpdate,
    validate_external_url,
)
from api.routes.crawl_stream import crawl_event_generator
from api.service_auth import current_owner, require_admin_identity, require_owner, require_operator_identity

logger = logging.getLogger(__name__)
MAX_CRAWL_BATCH = int(os.getenv("MAX_CRAWL_BATCH", "10"))

router = APIRouter(prefix="/api/crawl", tags=["Crawl"])

_TRACEBACK_LOG_PATTERNS = (
    re.compile(r"^Traceback \(most recent call last\):"),
    re.compile(r'^\s*File ".*", line \d+, in '),
    re.compile(r"^\s*[A-Za-z_][A-Za-z0-9_]*(Error|Exception):"),
)
_INTERNAL_PATH_PATTERN = re.compile(r"/app/[^\s)'\"]+")


def _sanitize_log_line_for_ui(entry: LogEntry | str) -> LogEntry | str | None:
    if isinstance(entry, str):
        if any(pattern.search(entry) for pattern in _TRACEBACK_LOG_PATTERNS):
            return None
        return _INTERNAL_PATH_PATTERN.sub("[internal-path]", entry)

    if any(pattern.search(entry.message) for pattern in _TRACEBACK_LOG_PATTERNS):
        return None
    sanitized_message = _INTERNAL_PATH_PATTERN.sub("[internal-path]", entry.message)
    return LogEntry(
        timestamp=entry.timestamp,
        message=sanitized_message,
        level=entry.level,
    )


class InkittCookieUpdateRequest(BaseModel):
    cookies: str = Field(..., min_length=1, description="Inkitt cookies as Selenium JSON or a raw Cookie header.")
    user_agent: str | None = Field(None, description="The User-Agent matching the cookies.")


class InkittCookieUpdateResponse(BaseModel):
    updated: bool
    cookie_count: int


class InkittCookieStatusRequest(BaseModel):
    story_url: str | None = Field(default=None, description="Optional Inkitt story/chapter URL to test against.")

    @field_validator("story_url")
    @classmethod
    def _validate_story_url(cls, value: str | None) -> str | None:
        return validate_external_url(value, ("inkitt.com",), field_name="story_url")


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

    @field_validator("story_url")
    @classmethod
    def _validate_story_url(cls, value: str | None) -> str | None:
        return validate_external_url(value, ("scribblehub.com",), field_name="story_url")


class ScribbleHubCookieStatusResponse(BaseModel):
    valid: bool | None
    reason: str
    message: str
    cookie_count: int
    tested_url: str | None = None


class GoodNovelCookieUpdateRequest(BaseModel):
    cookies: str = Field(..., min_length=1, description="GoodNovel cookies as JSON (Selenium/EditThisCookie export) or a raw Cookie header. Include the TOKEN login cookie.")
    user_agent: str | None = Field(default=None, description="Optional User-Agent matching the cookies.")


class GoodNovelCookieUpdateResponse(BaseModel):
    updated: bool
    cookie_count: int
    has_token: bool


class GoodNovelCookieStatusRequest(BaseModel):
    story_url: str | None = Field(default=None, description="Optional GoodNovel book URL to verify how many chapters the cookies unlock.")

    @field_validator("story_url")
    @classmethod
    def _validate_story_url(cls, value: str | None) -> str | None:
        return validate_external_url(value, ("goodnovel.com",), field_name="story_url")


class GoodNovelCookieStatusResponse(BaseModel):
    valid: bool | None
    reason: str
    message: str
    cookie_count: int
    tested_url: str | None = None
    readable: int | None = None
    readable_without_login: int | None = None
    total: int | None = None
    extra_unlocked: int | None = None


class WebNovelCookieUpdateRequest(BaseModel):
    cookies: str = Field(..., min_length=1, description="WebNovel cookies as JSON, a name/value map, or a raw Cookie header.")
    user_agent: str | None = Field(default=None, description="The browser User-Agent matching the WebNovel cookies.")


class WebNovelCookieUpdateResponse(BaseModel):
    updated: bool
    cookie_count: int
    has_cf_clearance: bool
    has_user_agent: bool


class WebNovelCookieStatusRequest(BaseModel):
    story_url: str | None = Field(default=None, description="Optional WebNovel story/chapter URL to test against.")

    @field_validator("story_url")
    @classmethod
    def _validate_story_url(cls, value: str | None) -> str | None:
        return validate_external_url(value, ("webnovel.com",), field_name="story_url")


class WebNovelCookieStatusResponse(BaseModel):
    valid: bool | None
    reason: str
    message: str
    cookie_count: int
    tested_url: str | None = None


class GoodNovelBatchScanRequest(BaseModel):
    titles_text: str = Field(..., min_length=1, description="Story titles separated by the configured delimiter.")
    delimiter: str = Field(default=";", max_length=16, description="Delimiter between titles. Use ';' or 'newline'.")
    scan_concurrency: int = Field(default=4, ge=1, le=8)
    batch_name: str | None = Field(default=None, max_length=160, description="Optional label shown in batch history.")


class GoodNovelBatchCrawlRequest(BaseModel):
    split_mode: Literal["stories_per_folder", "folder_count"] = Field(default="stories_per_folder")
    stories_per_folder: int = Field(default=100, ge=1, le=1000)
    folder_count: int | None = Field(default=None, ge=1, le=10000)
    crawl_concurrency: int = Field(default=3, ge=1, le=8)
    request_delay_seconds: float = Field(default=0.15, ge=0, le=5)


class InkittBatchStartRequest(BaseModel):
    batch_name: str | None = Field(default=None, max_length=160)
    genres: list[str] | None = Field(default=None, description="Inkitt genre slugs. Empty means all supported genres.")
    max_pages_per_genre: int = Field(default=3, ge=1, le=1000)
    discover_concurrency: int = Field(default=4, ge=1, le=6)
    crawl_concurrency: int = Field(default=4, ge=1, le=5)
    request_delay_seconds: float = Field(default=1.0, ge=1, le=5)
    crawl_after_discovery: bool = Field(default=True)


class InkittBatchCrawlRequest(BaseModel):
    crawl_concurrency: int = Field(default=4, ge=1, le=5)
    request_delay_seconds: float = Field(default=1.0, ge=1, le=5)
    max_stories: int | None = Field(default=None, ge=1, le=10000)


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
        created_by_user_id=current_owner(http_request),
    )
    logger.info("Crawl started: %s", crawl_id)
    return CrawlStartResponse(crawl_id=crawl_id, status="running")


@router.post("/inkitt-cookies", response_model=InkittCookieUpdateResponse)
async def update_inkitt_cookies(request: InkittCookieUpdateRequest, http_request: Request) -> InkittCookieUpdateResponse:
    """Update the saved Inkitt login cookies used by the Inkitt spider."""
    require_operator_identity(http_request)
    from api.services.inkitt_cookie_service import update_inkitt_cookies as save_inkitt_cookies

    try:
        result = save_inkitt_cookies(request.cookies, request.user_agent)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    logger.info("Updated Inkitt cookies: %d cookie(s)", result["cookie_count"])
    return InkittCookieUpdateResponse(**result)


@router.post("/inkitt-cookies/status", response_model=InkittCookieStatusResponse)
async def check_inkitt_cookies(request: InkittCookieStatusRequest, http_request: Request) -> InkittCookieStatusResponse:
    """Check whether saved Inkitt cookies can access a likely login-gated page."""
    require_operator_identity(http_request)
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
    require_operator_identity(http_request)
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
    require_operator_identity(http_request)
    from api.services.scribblehub_cookie_service import check_scribblehub_cookies as run_check

    result = run_check(request.story_url)
    logger.info(
        "Checked ScribbleHub cookies: valid=%s reason=%s tested_url=%s",
        result["valid"],
        result["reason"],
        result.get("tested_url"),
    )
    return ScribbleHubCookieStatusResponse(**result)



@router.post("/goodnovel-cookies", response_model=GoodNovelCookieUpdateResponse)
async def update_goodnovel_cookies(request: GoodNovelCookieUpdateRequest, http_request: Request) -> GoodNovelCookieUpdateResponse:
    """Update the saved GoodNovel session cookies used by the GoodNovel spider."""
    require_operator_identity(http_request)
    from api.services.goodnovel_cookie_service import update_goodnovel_cookies as save_cookies

    try:
        result = save_cookies(request.cookies, request.user_agent)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    logger.info("Updated GoodNovel cookies: %d cookie(s), token=%s", result["cookie_count"], result["has_token"])
    return GoodNovelCookieUpdateResponse(**result)


@router.post("/goodnovel-cookies/status", response_model=GoodNovelCookieStatusResponse)
async def check_goodnovel_cookies(request: GoodNovelCookieStatusRequest, http_request: Request) -> GoodNovelCookieStatusResponse:
    """Check saved GoodNovel cookies and report how many chapters they unlock."""
    require_operator_identity(http_request)
    from api.services.goodnovel_cookie_service import check_goodnovel_cookies as run_check

    result = run_check(request.story_url)
    logger.info(
        "Checked GoodNovel cookies: valid=%s reason=%s tested_url=%s",
        result["valid"],
        result["reason"],
        result.get("tested_url"),
    )
    return GoodNovelCookieStatusResponse(**result)


@router.post("/webnovel-cookies", response_model=WebNovelCookieUpdateResponse)
async def update_webnovel_cookies(request: WebNovelCookieUpdateRequest, http_request: Request) -> WebNovelCookieUpdateResponse:
    """Update the saved WebNovel cookies used by the WebNovel spider."""
    require_operator_identity(http_request)
    from api.services.webnovel_cookie_service import update_webnovel_cookies as save_cookies

    try:
        result = save_cookies(request.cookies, request.user_agent)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    logger.info(
        "Updated WebNovel cookies: %d cookie(s), cf_clearance=%s, user_agent=%s",
        result["cookie_count"],
        result["has_cf_clearance"],
        result["has_user_agent"],
    )
    return WebNovelCookieUpdateResponse(**result)


@router.post("/webnovel-cookies/status", response_model=WebNovelCookieStatusResponse)
async def check_webnovel_cookies(request: WebNovelCookieStatusRequest, http_request: Request) -> WebNovelCookieStatusResponse:
    """Check whether saved WebNovel cookies clear the Cloudflare challenge."""
    require_operator_identity(http_request)
    from api.services.webnovel_cookie_service import check_webnovel_cookies as run_check

    result = run_check(request.story_url)
    logger.info(
        "Checked WebNovel cookies: valid=%s reason=%s tested_url=%s",
        result["valid"],
        result["reason"],
        result.get("tested_url"),
    )
    return WebNovelCookieStatusResponse(**result)


def _require_goodnovel_batch_owner(batch_id: str, request: Request):
    from api.services.goodnovel_batch_service import get_goodnovel_batch_service

    service = get_goodnovel_batch_service()
    try:
        service.require_owner(
            batch_id=batch_id,
            user_id=getattr(request.state, "create_story_user_id", None),
            role=getattr(request.state, "create_story_role", None),
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return service


def _require_inkitt_batch_owner(batch_id: str, request: Request):
    from api.services.inkitt_batch_service import get_inkitt_batch_service

    service = get_inkitt_batch_service()
    try:
        service.require_owner(
            batch_id=batch_id,
            user_id=getattr(request.state, "create_story_user_id", None),
            role=getattr(request.state, "create_story_role", None),
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return service


@router.post("/goodnovel-batch/scan")
async def start_goodnovel_batch_scan(
    request: GoodNovelBatchScanRequest,
    http_request: Request,
) -> dict:
    """Start a GoodNovel title scan job for semicolon/newline separated story titles."""
    require_operator_identity(http_request)
    from api.services.goodnovel_batch_service import get_goodnovel_batch_service

    service = get_goodnovel_batch_service()
    try:
        state = service.start_scan(
            titles_text=request.titles_text,
            delimiter=request.delimiter,
            scan_concurrency=request.scan_concurrency,
            created_by_user_id=current_owner(http_request),
            batch_name=request.batch_name or "",
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return service.get_status(state.batch_id)


@router.post("/inkitt-batch/start")
async def start_inkitt_batch(
    request: InkittBatchStartRequest,
    http_request: Request,
) -> dict:
    """Start a one-click Inkitt batch for free completed stories grouped by genre."""
    require_operator_identity(http_request)
    from api.services.inkitt_batch_service import get_inkitt_batch_service

    service = get_inkitt_batch_service()
    try:
        state = service.start(
            created_by_user_id=current_owner(http_request),
            batch_name=request.batch_name or "",
            genres=request.genres,
            max_pages_per_genre=request.max_pages_per_genre,
            discover_concurrency=request.discover_concurrency,
            crawl_concurrency=request.crawl_concurrency,
            request_delay_seconds=request.request_delay_seconds,
            crawl_after_discovery=request.crawl_after_discovery,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return service.get_status(state.batch_id)


@router.post("/inkitt-batch/{batch_id}/crawl")
async def crawl_inkitt_batch(
    batch_id: str,
    request: InkittBatchCrawlRequest,
    http_request: Request,
) -> dict:
    """Start or resume crawling a discovered Inkitt batch queue."""
    require_operator_identity(http_request)
    service = _require_inkitt_batch_owner(batch_id, http_request)
    try:
        state = service.start_crawl(
            batch_id=batch_id,
            crawl_concurrency=request.crawl_concurrency,
            request_delay_seconds=request.request_delay_seconds,
            max_stories=request.max_stories,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return service.get_status(state.batch_id)


@router.post("/inkitt-batch/{batch_id}/pause")
async def pause_inkitt_batch(batch_id: str, http_request: Request) -> dict:
    """Gracefully pause an active Inkitt batch crawl."""
    require_operator_identity(http_request)
    service = _require_inkitt_batch_owner(batch_id, http_request)
    try:
        state = service.pause_crawl(batch_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return service.get_status(state.batch_id)


@router.post("/inkitt-batch/{batch_id}/retry-failed")
async def retry_failed_inkitt_batch_rows(batch_id: str, payload: dict, http_request: Request) -> dict:
    """Move failed Inkitt stories to the front of the next crawl queue."""
    require_operator_identity(http_request)
    service = _require_inkitt_batch_owner(batch_id, http_request)
    row_index_raw = payload.get("row_index") if isinstance(payload, dict) else None
    try:
        row_index = int(row_index_raw) if row_index_raw is not None else None
        state = service.retry_failed(batch_id, row_index=row_index)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return service.get_status(state.batch_id)


@router.get("/inkitt-batch")
async def list_inkitt_batches(request: Request) -> list[dict]:
    """Return Inkitt batch history for the current user."""
    from api.services.inkitt_batch_service import get_inkitt_batch_service

    service = get_inkitt_batch_service()
    return service.list_batches(
        user_id=getattr(request.state, "create_story_user_id", None),
        role=getattr(request.state, "create_story_role", None),
    )


@router.get("/inkitt-batch/catalog/export")
async def export_inkitt_discovered_catalog(http_request: Request) -> dict:
    """Export all discovered Inkitt story metadata for backup/restore."""
    require_operator_identity(http_request)
    from api.services.inkitt_batch_service import get_inkitt_batch_service

    return get_inkitt_batch_service().export_discovered_catalog()


@router.get("/inkitt-batch/{batch_id}/catalog/export")
async def export_inkitt_batch_catalog(batch_id: str, request: Request) -> dict:
    """Export discovered Inkitt story metadata from one selected batch."""
    service = _require_inkitt_batch_owner(batch_id, request)
    try:
        return service.export_batch_catalog(batch_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/inkitt-batch/catalog/import")
async def import_inkitt_discovered_catalog(payload: dict, http_request: Request) -> dict:
    """Import and merge a discovered Inkitt story catalog backup."""
    require_operator_identity(http_request)
    from api.services.inkitt_batch_service import get_inkitt_batch_service

    try:
        return get_inkitt_batch_service().import_discovered_catalog(
            payload,
            created_by_user_id=current_owner(http_request),
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/inkitt-batch/{batch_id}")
async def get_inkitt_batch_status(batch_id: str, request: Request) -> dict:
    """Return current Inkitt batch status."""
    service = _require_inkitt_batch_owner(batch_id, request)
    try:
        return service.get_status(batch_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/inkitt-batch/{batch_id}/rows")
async def list_inkitt_batch_rows(
    batch_id: str,
    request: Request,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
    status: str = Query(default="all"),
) -> dict:
    """Return a lazy page of Inkitt batch rows."""
    service = _require_inkitt_batch_owner(batch_id, request)
    try:
        return service.list_rows(batch_id, offset=offset, limit=limit, status_filter=status)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/inkitt-batch/{batch_id}/logs")
async def get_inkitt_batch_logs(batch_id: str, request: Request) -> dict:
    """Return the full retained Inkitt batch log."""
    service = _require_inkitt_batch_owner(batch_id, request)
    try:
        return service.get_full_logs(batch_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/inkitt-batch/{batch_id}")
async def delete_inkitt_batch(batch_id: str, http_request: Request) -> dict:
    """Delete a completed Inkitt batch history entry and generated output files."""
    require_operator_identity(http_request)
    service = _require_inkitt_batch_owner(batch_id, http_request)
    try:
        service.delete_batch(batch_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"deleted": True, "batch_id": batch_id}


@router.get("/goodnovel-batch")
async def list_goodnovel_batches(request: Request) -> list[dict]:
    """Return GoodNovel batch history for the current user."""
    from api.services.goodnovel_batch_service import get_goodnovel_batch_service

    service = get_goodnovel_batch_service()
    return service.list_batches(
        user_id=getattr(request.state, "create_story_user_id", None),
        role=getattr(request.state, "create_story_role", None),
    )


@router.get("/goodnovel-batch/{batch_id}")
async def get_goodnovel_batch_status(batch_id: str, request: Request) -> dict:
    """Return scan/crawl summary for a GoodNovel batch."""
    service = _require_goodnovel_batch_owner(batch_id, request)
    try:
        return service.get_status(batch_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/goodnovel-batch/{batch_id}/rows")
async def list_goodnovel_batch_rows(
    batch_id: str,
    request: Request,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
    status: str = Query(default="all"),
) -> dict:
    """Return a lazy page of GoodNovel batch title rows."""
    service = _require_goodnovel_batch_owner(batch_id, request)
    try:
        return service.list_rows(batch_id, offset=offset, limit=limit, status_filter=status)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/goodnovel-batch/{batch_id}")
async def delete_goodnovel_batch(batch_id: str, http_request: Request) -> dict:
    """Delete a completed GoodNovel batch history entry and generated output files."""
    require_operator_identity(http_request)
    service = _require_goodnovel_batch_owner(batch_id, http_request)
    try:
        service.delete_batch(batch_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"deleted": True, "batch_id": batch_id}


@router.post("/goodnovel-batch/{batch_id}/crawl")
async def start_goodnovel_batch_crawl(
    batch_id: str,
    request: GoodNovelBatchCrawlRequest,
    http_request: Request,
) -> dict:
    """Start crawling free GoodNovel chapters for found rows in a scanned batch."""
    require_operator_identity(http_request)
    service = _require_goodnovel_batch_owner(batch_id, http_request)
    try:
        state = service.start_crawl(
            batch_id=batch_id,
            split_mode=request.split_mode,
            stories_per_folder=request.stories_per_folder,
            folder_count=request.folder_count,
            crawl_concurrency=request.crawl_concurrency,
            request_delay_seconds=request.request_delay_seconds,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return service.get_status(state.batch_id)


@router.post("/start-batch", response_model=list[CrawlStartResponse])
async def start_batch_crawl(requests: list[CrawlRequest], http_request: Request) -> list[CrawlStartResponse]:
    """
    Start multiple crawl sessions in parallel.

    Each request in the list is started in parallel. Returns a list of crawl_id+status
    for every submitted entry (including entries that are paywalled — returned with status='blocked').
    """
    from api.services.crawler_service import get_crawl_service

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
    log_lines = [
        sanitized
        for line in session.log_lines[-100:]
        if (sanitized := _sanitize_log_line_for_ui(line)) is not None
    ]
    return {
        "progress": session.to_progress_update(),
        "log_lines": log_lines,
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
