"""BedRead routes — story discovery and batch TTS generation."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Header, Query, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from api.service_auth import current_owner, require_owner
from api.services.bedread_service import BedReadCapacityError, get_bedread_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/bedread", tags=["BedRead"])

_stories_cache: Optional[dict] = None
_stories_cache_time: float = 0.0
_CACHE_TTL_SECONDS = 300


def _zip_filename(story_title: str) -> str:
    safe = "".join(c if (ord(c) < 128 and c.isalnum()) else "_" for c in story_title)
    return (safe.strip() or "voices") + "_Voices.zip"


class BatchGenerateRequest(BaseModel):
    story_id: str = Field(..., description="External story ID from the discover API.")
    story_title: str = Field(..., description="Display title for the story.")
    chapter_numbers: Optional[list[int]] = Field(
        default=None,
        max_length=500,
        description="Specific chapter numbers to generate. When provided, chapter_start/end are ignored.",
    )
    chapter_start: int = Field(default=1, ge=1, description="Starting chapter number (used when chapter_numbers is not set).")
    chapter_end: Optional[int] = Field(default=None, ge=1, description="Ending chapter number. None = all chapters.")
    voice: str = Field(default="af_heart", description="Voice ID.")
    lang: str = Field(default="en-us", description="Language code.")
    speed: float = Field(default=0.69, ge=0.5, le=2.0, description="Speech speed.")
    format: str = Field(default="wav", pattern="^(wav|mp3)$", description="Output format.")
    from_auto_mode: bool = Field(default=False, description="Whether this batch was triggered by auto audio mode.")


class BatchGenerateResponse(BaseModel):
    batch_id: str
    status: str
    total_chapters: int


class ChapterInfo(BaseModel):
    chapterNumber: int
    title: str
    plainContent: Optional[str] = None


class StoryInfo(BaseModel):
    storyId: str
    title: str
    author: str
    chapterCount: int
    coverUrl: Optional[str] = None
    description: Optional[str] = None
    tags: list[str] = Field(default_factory=list)


class StorySearchResponse(BaseModel):
    stories: list[StoryInfo]
    total: int
    page: int
    limit: int
    totalPages: int


@router.get("/stories", response_model=list[StoryInfo])
def list_stories() -> list[StoryInfo]:
    """Fetch story list from external discover API. Cached for 5 minutes."""
    global _stories_cache, _stories_cache_time
    import time

    now = time.time()
    if _stories_cache is not None and (now - _stories_cache_time) < _CACHE_TTL_SECONDS:
        return _stories_cache

    service = get_bedread_service()
    try:
        raw = service.fetch_stories()
    except Exception as exc:
        logger.exception("Failed to fetch stories from external API")
        raise HTTPException(status_code=502, detail=f"External API error: {exc}")

    stories = [
        StoryInfo(
            storyId=s.get("storyId", ""),
            title=s.get("title", "Untitled"),
            author=s.get("authorUsername", s.get("author", "Unknown")),
            chapterCount=s.get("chapterCount", 0),
            coverUrl=s.get("coverImageUrl") or s.get("coverUrl") or s.get("cover_url"),
            description=s.get("synopsis") or s.get("description"),
            tags=s.get("hashtags", []) or s.get("tags", []),
        )
        for s in raw
        if s.get("storyId") or s.get("story_id")
    ]

    _stories_cache = stories
    _stories_cache_time = now
    return stories


@router.get("/stories/search", response_model=StorySearchResponse)
def search_stories(
    keyword: Optional[str] = Query(default=None, description="Search by title or author."),
    categories: Optional[list[str]] = Query(default=None),
    status: Optional[str] = Query(default="all", description="Filter by status: all, ongoing, completed."),
    sort: Optional[str] = Query(default="release_date", description="Sort: release_date, title, chapter_count, popular."),
    min_chapters: Optional[int] = Query(default=None, alias="minChapters", description="Minimum chapter count."),
    published_within: Optional[int] = Query(default=None, alias="publishedWithin", description="Published within N days."),
    page: int = Query(default=1, ge=1, description="Page number."),
    limit: int = Query(default=20, ge=1, le=100, description="Items per page."),
) -> StorySearchResponse:
    """Search stories with pagination from external discover API."""
    service = get_bedread_service()
    try:
        data = service.search_stories(
            keyword=keyword,
            categories=categories,
            status=status,
            sort=sort,
            min_chapters=min_chapters,
            published_within=published_within,
            page=page,
            limit=limit,
        )
    except Exception as exc:
        logger.exception("Failed to search stories from external API")
        raise HTTPException(status_code=502, detail=f"External API error: {exc}")

    stories = [
        StoryInfo(
            storyId=s.get("storyId", ""),
            title=s.get("title", "Untitled"),
            author=s.get("authorUsername", s.get("author", "Unknown")),
            chapterCount=s.get("chapterCount", 0),
            coverUrl=s.get("coverImageUrl") or s.get("coverUrl") or s.get("cover_url"),
            description=s.get("synopsis") or s.get("description"),
            tags=s.get("hashtags", []) or s.get("tags", []),
        )
        for s in data.get("stories", [])
        if s.get("storyId") or s.get("story_id")
    ]

    return StorySearchResponse(
        stories=stories,
        total=data.get("total", 0),
        page=data.get("page", page),
        limit=data.get("limit", limit),
        totalPages=data.get("totalPages", 0),
    )


@router.get("/stories/{story_id}/chapters", response_model=list[ChapterInfo])
def get_story_chapters(
    story_id: str,
    x_user_id: Optional[str] = Header(default=None, alias="x-user-id"),
) -> list[ChapterInfo]:
    """Fetch all chapters for a story from the external API."""
    service = get_bedread_service()
    try:
        raw = service.fetch_chapters(story_id, user_id=x_user_id)
    except Exception as exc:
        logger.exception("Failed to fetch chapters for story %s", story_id)
        raise HTTPException(status_code=502, detail=f"External API error: {exc}")

    chapters = [
        ChapterInfo(
            chapterNumber=ch.get("index") or ch.get("chapterNumber") or ch.get("chapter_number") or i + 1,
            title=ch.get("title", f"Chapter {i + 1}"),
            plainContent=ch.get("content") or ch.get("plainContent") or ch.get("plain_content"),
        )
        for i, ch in enumerate(raw)
    ]
    return chapters


@router.post("/generate", response_model=BatchGenerateResponse)
def start_batch_generate(
    request: BatchGenerateRequest,
    http_request: Request,
    x_user_id: Optional[str] = Header(default=None, alias="x-user-id"),
) -> BatchGenerateResponse:
    """
    Start a batch TTS generation job for a story.

    Chapters are generated in parallel (each as a separate TTSService job).
    Poll GET /api/bedread/jobs/{batch_id} for progress.
    """
    service = get_bedread_service()

    chapter_list = service.fetch_chapters(request.story_id, user_id=x_user_id)
    if not chapter_list:
        raise HTTPException(status_code=404, detail="Story not found or has no chapters.")

    if request.chapter_numbers is not None:
        chapter_numbers = sorted(request.chapter_numbers)
        if not chapter_numbers:
            raise HTTPException(status_code=400, detail="chapter_numbers list is empty.")
    else:
        all_chapter_nums = sorted([
            ch.get("index") or ch.get("chapterNumber") or ch.get("chapter_number")
            for ch in chapter_list
            if ch.get("index") or ch.get("chapterNumber") or ch.get("chapter_number")
        ])
        if not all_chapter_nums:
            raise HTTPException(status_code=404, detail="No valid chapter numbers found.")

        start = max(request.chapter_start, min(all_chapter_nums))
        if request.chapter_end is None:
            end = max(all_chapter_nums)
        else:
            end = min(request.chapter_end, max(all_chapter_nums))

        chapter_numbers = [n for n in all_chapter_nums if start <= n <= end]

        if not chapter_numbers:
            raise HTTPException(status_code=400, detail="No chapters in the specified range.")

    if len(chapter_numbers) > 500:
        raise HTTPException(status_code=422, detail="A BedRead batch may contain at most 500 chapters.")

    try:
        batch_id = service.start_batch_job(
            story_id=request.story_id,
            story_title=request.story_title,
            chapter_numbers=chapter_numbers,
            voice=request.voice,
            lang=request.lang,
            speed=request.speed,
            format=request.format,
            from_auto_mode=request.from_auto_mode,
            created_by_user_id=current_owner(http_request),
        )
    except BedReadCapacityError as exc:
        raise HTTPException(
            status_code=429,
            detail=str(exc),
            headers={"Retry-After": "60"},
        ) from exc
    except Exception as exc:
        logger.exception("Failed to start batch job")
        raise HTTPException(status_code=500, detail=str(exc))

    return BatchGenerateResponse(
        batch_id=batch_id,
        status="running",
        total_chapters=len(chapter_numbers),
    )


@router.get("/jobs/{batch_id}")
def get_batch_status(batch_id: str, request: Request) -> dict:
    """Return current state of a batch job including per-chapter progress."""
    service = get_bedread_service()
    job = service.get_batch_job(batch_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Batch job '{batch_id}' not found.")
    require_owner(request, job.get("created_by_user_id"))
    return job


@router.get("/jobs")
def list_all_batch_jobs(request: Request) -> list[dict]:
    """Return all batch jobs for the management page."""
    service = get_bedread_service()
    jobs = service.list_batch_jobs()
    role = getattr(request.state, "create_story_role", None)
    owner_id = current_owner(request)
    if role == "admin" or (role is None and owner_id is None):
        return jobs
    return [job for job in jobs if job.get("created_by_user_id") == owner_id]


@router.delete("/jobs/{batch_id}")
def cancel_batch(batch_id: str, request: Request) -> dict:
    """Cancel a running batch job."""
    service = get_bedread_service()
    job = service.get_batch_job(batch_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Batch job '{batch_id}' not found.")
    require_owner(request, job.get("created_by_user_id"))
    cancelled = service.delete_batch_job(batch_id)
    if not cancelled:
        job = service.get_batch_job(batch_id)
        if job is None:
            raise HTTPException(status_code=404, detail=f"Batch job '{batch_id}' not found.")
        raise HTTPException(
            status_code=409,
            detail=f"Batch job '{batch_id}' cannot be cancelled (status={job['status']}).",
        )
    return {"batch_id": batch_id, "status": "cancelled"}


@router.delete("/jobs/{batch_id}/output")
def delete_batch_output(batch_id: str, request: Request) -> dict:
    """Delete the output directory for a batch job after all chapters have been uploaded by the consumer."""
    service = get_bedread_service()
    job = service.get_batch_job(batch_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Batch job '{batch_id}' not found.")
    require_owner(request, job.get("created_by_user_id"))
    deleted = service.delete_batch_output(batch_id)
    if not deleted:
        job = service.get_batch_job(batch_id)
        if job is None:
            raise HTTPException(status_code=404, detail=f"Batch job '{batch_id}' not found.")
        raise HTTPException(
            status_code=409,
            detail=f"Batch output for '{batch_id}' could not be deleted (status={job['status']}).",
        )
    return {"batch_id": batch_id, "status": "output_deleted"}


@router.post("/jobs/{batch_id}/remove")
def remove_batch(batch_id: str, request: Request) -> dict:
    """Remove a batch job from tracking (does not cancel active TTS jobs)."""
    service = get_bedread_service()
    job = service.get_batch_job(batch_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Batch job '{batch_id}' not found.")
    require_owner(request, job.get("created_by_user_id"))
    removed = service.remove_batch_job(batch_id)
    if not removed:
        raise HTTPException(status_code=404, detail=f"Batch job '{batch_id}' not found.")
    return {"batch_id": batch_id, "status": "removed"}


@router.get("/jobs/{batch_id}/download")
def download_chapter(
    batch_id: str,
    request: Request,
    chapter: int = Query(..., description="Chapter number to download."),
) -> FileResponse:
    """Stream a single chapter's audio file."""
    service = get_bedread_service()

    job = service.get_batch_job(batch_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Batch job '{batch_id}' not found.")
    require_owner(request, job.get("created_by_user_id"))

    file_path = service.get_chapter_file(batch_id, chapter)
    if file_path is None or not file_path.exists():
        raise HTTPException(status_code=404, detail=f"Audio file for chapter {chapter} not found.")

    fmt = job.get("format", "wav")
    mime_type = "audio/wav" if fmt == "wav" else "audio/mpeg"

    return FileResponse(
        file_path,
        media_type=mime_type,
        filename=file_path.name,
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/jobs/{batch_id}/zip")
def download_batch_zip(batch_id: str, request: Request) -> FileResponse:
    """Stream a ZIP file containing all completed chapter audio files."""
    service = get_bedread_service()

    job = service.get_batch_job(batch_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Batch job '{batch_id}' not found.")
    require_owner(request, job.get("created_by_user_id"))

    zip_path = job.get("zip_path")
    if zip_path:
        zip_path_obj = Path(zip_path)
        if zip_path_obj.exists():
            filename = _zip_filename(job.get("story_title", "voices"))
            return FileResponse(
                zip_path_obj,
                media_type="application/zip",
                filename=filename,
                headers={
                    "Cache-Control": "no-cache, no-transform",
                },
            )

    output_dir = service.get_output_dir(batch_id)
    if output_dir:
        from api.services.bedread_service import _safe_filename, _voice_display_name
        voice_name = _voice_display_name(job.get("voice", "af_sarah"))
        safe_title = _safe_filename(job.get("story_title", "story"))
        expected_zip_name = f"{safe_title}_{voice_name}.zip"
        existing_zip = output_dir / expected_zip_name
        if existing_zip.exists():
            filename = _zip_filename(job.get("story_title", "story"))
            return FileResponse(
                existing_zip,
                media_type="application/zip",
                filename=filename,
                headers={
                    "Cache-Control": "no-cache, no-transform",
                },
            )

    zip_path = service.build_batch_zip_on_disk(batch_id)
    if zip_path is None or not zip_path.exists():
        raise HTTPException(status_code=404, detail="No completed chapters available for zip.")

    filename = _zip_filename(job.get("story_title", "voices"))

    return FileResponse(
        zip_path,
        media_type="application/zip",
        filename=filename,
        headers={
            "Cache-Control": "no-cache, no-transform",
        },
    )
