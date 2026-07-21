"""Admin endpoints for repairing watermarks on pictures already stored by the main server."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from api.auth import require_admin
from api.routes.drive_sync.proxy import drive_get, drive_post


router = APIRouter(tags=["Drive Sync"], dependencies=[Depends(require_admin)])


@router.get("/watermark-picture-fix/stories")
async def list_watermark_picture_stories(
    page: int = 1,
    limit: int = 24,
    keyword: str = "",
) -> JSONResponse:
    return await drive_get(
        "/api/drive-sync/watermark-picture-fix/stories",
        params={"page": page, "limit": limit, "keyword": keyword},
        timeout=180.0,
    )


@router.post("/watermark-picture-fix/status")
async def watermark_picture_status(body: dict) -> JSONResponse:
    return await drive_post(
        "/api/drive-sync/watermark-picture-fix/status",
        json_body=body,
        timeout=30.0,
    )


@router.get("/watermark-picture-fix/stories/{story_id}/pictures")
async def check_watermark_story_pictures(story_id: str) -> JSONResponse:
    return await drive_get(
        f"/api/drive-sync/watermark-picture-fix/stories/{story_id}/pictures",
        timeout=60.0,
    )


@router.post("/watermark-picture-fix/stories/{story_id}/job")
async def queue_watermark_picture_story(story_id: str, body: dict) -> JSONResponse:
    return await drive_post(
        f"/api/drive-sync/watermark-picture-fix/stories/{story_id}/job",
        json_body=body,
        timeout=30.0,
    )


@router.post("/watermark-picture-fix/jobs/batch")
async def queue_watermark_picture_batch(body: dict) -> JSONResponse:
    return await drive_post(
        "/api/drive-sync/watermark-picture-fix/jobs/batch",
        json_body=body,
        timeout=180.0,
    )
