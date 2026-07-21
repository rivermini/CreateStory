"""Admin queue for repairing watermarks on pictures already stored by the main backend."""

from __future__ import annotations

import asyncio
import uuid
from math import ceil
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from api.models.drive_sync import JobCreateRequest, JobCreateResponse, JobKind, SyncJob
from api.services.drive_service import get_drive_sync_service


router = APIRouter(prefix="/watermark-picture-fix", tags=["Drive Sync"])

WatermarkAssetType = Literal["cover", "banner", "intro"]
_ALL_ASSET_TYPES: tuple[WatermarkAssetType, ...] = ("cover", "banner", "intro")


class WatermarkPictureStory(BaseModel):
    story_id: str
    title: str
    cover_url: Optional[str] = None
    banner_url: Optional[str] = None
    intro_url: Optional[str] = None
    updated_at: Optional[str] = None
    detail_error: Optional[str] = None
    latest_job: Optional[SyncJob] = None


class WatermarkPictureStoriesResponse(BaseModel):
    items: list[WatermarkPictureStory]
    page: int
    limit: int
    total: int
    pages: int
    queued: int = 0
    running: int = 0
    completed: int = 0
    failed: int = 0


class WatermarkPictureQueueRequest(BaseModel):
    title: Optional[str] = None
    asset_types: list[WatermarkAssetType] = Field(
        default_factory=lambda: list(_ALL_ASSET_TYPES),
        min_length=1,
    )


class WatermarkPictureSelection(BaseModel):
    story_id: str
    title: str
    asset_types: list[WatermarkAssetType] = Field(
        default_factory=lambda: list(_ALL_ASSET_TYPES),
        min_length=1,
    )


class WatermarkPictureBatchRequest(BaseModel):
    stories: list[WatermarkPictureSelection] = Field(default_factory=list)
    all_stories: bool = False
    keyword: str = ""
    client_batch_id: Optional[str] = None


class WatermarkPictureBatchResponse(BaseModel):
    client_batch_id: str
    queued_count: int
    existing_count: int
    job_ids: list[str]


class WatermarkPictureStatusRequest(BaseModel):
    story_ids: list[str] = Field(default_factory=list, max_length=48)


class WatermarkPictureStatusResponse(BaseModel):
    latest_jobs: dict[str, SyncJob]
    queued: int = 0
    running: int = 0
    completed: int = 0
    failed: int = 0


def _job_request(
    story_id: str,
    title: str,
    api_base_url: str,
    asset_types: list[WatermarkAssetType],
) -> JobCreateRequest:
    selected_assets = [asset for asset in _ALL_ASSET_TYPES if asset in asset_types]
    return JobCreateRequest(
        kind=JobKind.WATERMARK_PICTURE_FIX,
        folder_id=f"server:{story_id}",
        folder_name="server-story",
        display_name=f"{title} - Fix watermark pictures",
        main_be_api_base_url=api_base_url,
        payload={
            "story_id": story_id,
            "story_title": title,
            "selected_assets": selected_assets,
        },
    )


def _watermark_job_status(service, story_ids: set[str] | None = None) -> WatermarkPictureStatusResponse:
    jobs, _, _ = service.list_jobs(
        2000,
        0,
        None,
        [JobKind.WATERMARK_PICTURE_FIX],
    )
    latest_by_story: dict[str, SyncJob] = {}
    for job in jobs:
        story_id = str(job.payload.get("story_id") or "")
        if (
            story_id
            and story_id not in latest_by_story
            and (story_ids is None or story_id in story_ids)
        ):
            latest_by_story[story_id] = job
    return WatermarkPictureStatusResponse(
        latest_jobs=latest_by_story,
        queued=sum(1 for job in jobs if job.status == "queued"),
        running=sum(1 for job in jobs if job.status == "running"),
        completed=sum(1 for job in jobs if job.status == "success"),
        failed=sum(1 for job in jobs if job.status in {"error", "cancelled"}),
    )


@router.get("/stories", response_model=WatermarkPictureStoriesResponse)
async def list_watermark_picture_stories(
    page: int = Query(1, ge=1),
    limit: int = Query(24, ge=1, le=48),
    keyword: str = Query("", max_length=200),
) -> WatermarkPictureStoriesResponse:
    service = get_drive_sync_service()
    if service.get_config() is None:
        raise HTTPException(status_code=400, detail="Drive sync not configured.")
    try:
        data = await asyncio.to_thread(
            service.list_server_stories_with_pictures,
            page,
            limit,
            keyword,
        )
        status = await asyncio.to_thread(
            _watermark_job_status,
            service,
            {str(item["story_id"]) for item in data["items"]},
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    items = [
        WatermarkPictureStory(**item, latest_job=status.latest_jobs.get(item["story_id"]))
        for item in data["items"]
    ]
    return WatermarkPictureStoriesResponse(
        items=items,
        page=data["page"],
        limit=data["limit"],
        total=data["total"],
        pages=max(1, ceil(data["total"] / data["limit"])),
        queued=status.queued,
        running=status.running,
        completed=status.completed,
        failed=status.failed,
    )


@router.post("/status", response_model=WatermarkPictureStatusResponse)
async def watermark_picture_status(
    body: WatermarkPictureStatusRequest,
) -> WatermarkPictureStatusResponse:
    """Poll queue state without re-fetching picture details from the main server."""
    service = get_drive_sync_service()
    return await asyncio.to_thread(_watermark_job_status, service, set(body.story_ids))


@router.get("/stories/{story_id}/pictures", response_model=WatermarkPictureStory)
async def check_watermark_story_pictures(story_id: str) -> WatermarkPictureStory:
    """Return a fresh server snapshot before the user is allowed to queue repairs."""
    service = get_drive_sync_service()
    try:
        item = await asyncio.to_thread(service.get_server_story_pictures, story_id)
        status = await asyncio.to_thread(_watermark_job_status, service, {story_id})
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return WatermarkPictureStory(**item, latest_job=status.latest_jobs.get(story_id))


@router.post("/stories/{story_id}/job", response_model=JobCreateResponse)
async def queue_watermark_picture_story(
    story_id: str,
    body: WatermarkPictureQueueRequest,
) -> JobCreateResponse:
    service = get_drive_sync_service()
    config = service.get_config()
    if config is None:
        raise HTTPException(status_code=400, detail="Drive sync not configured.")
    title = (body.title or story_id).strip()
    request = _job_request(
        story_id,
        title,
        config.main_be_api_base_url,
        body.asset_types,
    )
    try:
        job, created = service.create_job_once(**request.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return JobCreateResponse(
        id=job.id,
        status=job.status,
        message=(
            f"Picture repair queued for '{title}'."
            if created
            else f"Picture repair is already queued or running for '{title}'."
        ),
    )


@router.post("/jobs/batch", response_model=WatermarkPictureBatchResponse)
async def queue_watermark_picture_batch(
    body: WatermarkPictureBatchRequest,
) -> WatermarkPictureBatchResponse:
    service = get_drive_sync_service()
    config = service.get_config()
    if config is None:
        raise HTTPException(status_code=400, detail="Drive sync not configured.")
    if body.all_stories:
        try:
            raw_stories = await asyncio.to_thread(service.get_all_server_stories)
        except RuntimeError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        keyword = body.keyword.strip().lower()
        selections = [
            WatermarkPictureSelection(story_id=str(story["id"]), title=str(story["title"]))
            for story in raw_stories
            if story.get("id")
            and (not keyword or keyword in str(story.get("title") or "").lower())
        ]
    else:
        selections = body.stories
    deduplicated: dict[str, WatermarkPictureSelection] = {
        item.story_id: item for item in selections if item.story_id
    }
    if not deduplicated:
        raise HTTPException(status_code=400, detail="Select at least one story.")
    if len(deduplicated) > 2000:
        raise HTTPException(status_code=400, detail="A picture-repair batch can contain at most 2000 stories.")

    active_jobs, _, _ = service.list_jobs(
        2000,
        0,
        ["queued", "running"],
        [JobKind.WATERMARK_PICTURE_FIX],
    )
    active_by_story = {
        str(job.payload.get("story_id") or ""): job
        for job in active_jobs
        if job.payload.get("story_id")
    }
    existing_jobs = [
        active_by_story[story_id]
        for story_id in deduplicated
        if story_id in active_by_story
    ]
    pending_selections = [
        item for story_id, item in deduplicated.items()
        if story_id not in active_by_story
    ]

    batch_id = (body.client_batch_id or f"watermark-fix-{uuid.uuid4()}").strip()
    requests = [
        _job_request(
            item.story_id,
            item.title,
            config.main_be_api_base_url,
            item.asset_types,
        )
        for item in pending_selections
    ]
    all_jobs: list[SyncJob] = []
    existing_count = len(existing_jobs)
    queued_count = 0
    try:
        for chunk_index, start in enumerate(range(0, len(requests), 500)):
            chunk = requests[start:start + 500]
            chunk_jobs, created = service.create_job_batch(
                f"{batch_id}:{chunk_index}",
                chunk,
            )
            all_jobs.extend(chunk_jobs)
            if created:
                queued_count += len(chunk_jobs)
            else:
                existing_count += len(chunk_jobs)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return WatermarkPictureBatchResponse(
        client_batch_id=batch_id,
        queued_count=queued_count,
        existing_count=existing_count,
        job_ids=[job.id for job in existing_jobs] + [job.id for job in all_jobs],
    )
