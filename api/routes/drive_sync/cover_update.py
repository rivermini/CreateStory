"""Cover update endpoints for drive sync."""

import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from api.services.drive_service import get_drive_sync_service

logger = logging.getLogger(__name__)


class CoverUpdateStatus(BaseModel):
    story_id: Optional[str] = None
    story_title: str
    folder_id: str
    folder_name: str
    cover_file_name: Optional[str] = None
    status: str
    last_updated: Optional[str] = None


class CheckAllResponse(BaseModel):
    can_update: list[CoverUpdateStatus]
    updated: list[CoverUpdateStatus]
    no_cover1_file: list[CoverUpdateStatus]
    no_server_match: list[CoverUpdateStatus]


class CheckUpdatedResponse(BaseModel):
    entries: list[CoverUpdateStatus]


class UploadCoverResponse(BaseModel):
    success: bool
    message: str
    cover_url: Optional[str] = None


router = APIRouter(prefix="/cover-update", tags=["Drive Sync"])


@router.get("/check-all", response_model=CheckAllResponse, tags=["Drive Sync"])
async def check_all(cover_filename: str = "cover1.jpg") -> CheckAllResponse:
    """
    Scan all DONE_/EXTENDED_ folders and return cover-update status for each.
    - can_update: folder has cover file, story exists on server, no prior update record
    - updated: folder has cover file, story exists, prior update record found
    - no_cover1_file: folder has no cover file
    - no_server_match: folder has cover file but no matching story on server
    """
    import asyncio

    service = get_drive_sync_service()
    if service.get_config() is None:
        raise HTTPException(status_code=400, detail="Drive sync not configured.")

    try:
        result = await asyncio.to_thread(service.check_extended_folders_for_cover, cover_filename)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Cover check failed: {exc}")

    def make_entry(d: dict) -> CoverUpdateStatus:
        return CoverUpdateStatus(
            story_id=d.get("story_id"),
            story_title=d.get("story_title", ""),
            folder_id=d.get("folder_id", ""),
            folder_name=d.get("folder_name", ""),
            cover_file_name=d.get("cover_file_name"),
            status=d.get("status", "unknown"),
            last_updated=d.get("last_updated"),
        )

    return CheckAllResponse(
        can_update=[make_entry(e) for e in result.get("can_update", [])],
        updated=[make_entry(e) for e in result.get("updated", [])],
        no_cover1_file=[make_entry(e) for e in result.get("no_cover1_file", [])],
        no_server_match=[make_entry(e) for e in result.get("no_server_match", [])],
    )


@router.get("/check-updated", response_model=CheckUpdatedResponse, tags=["Drive Sync"])
async def check_updated() -> CheckUpdatedResponse:
    """Return all entries from cover_update_histories table."""
    import asyncio

    service = get_drive_sync_service()
    if service.get_config() is None:
        raise HTTPException(status_code=400, detail="Drive sync not configured.")

    try:
        histories = await asyncio.to_thread(service.get_cover_update_histories_for_cover_update_folders)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to load history: {exc}")

    def make_entry(d: dict) -> CoverUpdateStatus:
        return CoverUpdateStatus(
            story_id=d.get("story_id"),
            story_title=d.get("story_title", ""),
            folder_id=d.get("folder_id", ""),
            folder_name=d.get("folder_name", ""),
            cover_file_name=d.get("cover_file_name"),
            status=d.get("status", "updated"),
            last_updated=d.get("last_updated"),
        )

    return CheckUpdatedResponse(entries=[make_entry(h) for h in histories])


@router.post("/upload/{folder_id}/{story_id}", response_model=UploadCoverResponse, tags=["Drive Sync"])
async def upload_cover(folder_id: str, story_id: str, cover_filename: str = "cover1.jpg") -> UploadCoverResponse:
    """
    Download the configured cover file from the given Drive folder and POST it to the main BE.
    Records the result in cover_update_histories.
    """
    import asyncio

    service = get_drive_sync_service()
    config = service.get_config()
    if config is None:
        raise HTTPException(status_code=400, detail="Drive sync not configured.")

    try:
        drive_folders_raw, _ = await asyncio.to_thread(service.list_drive_folders, limit=10000, offset=0)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    folder_info = None
    for f in drive_folders_raw:
        if f.get("id") == folder_id:
            folder_info = f
            break

    if folder_info is None:
        raise HTTPException(status_code=404, detail=f"Drive folder '{folder_id}' not found.")

    folder_name = folder_info.get("name", "")
    story_title = folder_info.get("display_name", "")

    def _do_upload():
        success, result = service._upload_story_cover_from_folder(story_id, folder_id, cover_filename)
        return success, result

    try:
        success, result = await asyncio.to_thread(_do_upload)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Cover upload failed: {exc}")

    if success:
        service._record_cover_update(
            story_id=story_id,
            story_title=story_title,
            folder_id=folder_id,
            folder_name=folder_name,
            status="updated",
            cover_file_name=cover_filename,
            cover_url=result,
        )
        return UploadCoverResponse(success=True, message="Cover uploaded successfully.", cover_url=result)
    else:
        service._record_cover_update(
            story_id=story_id,
            story_title=story_title,
            folder_id=folder_id,
            folder_name=folder_name,
            status="error",
            cover_file_name=cover_filename,
            error=result or "Upload failed.",
        )
        return UploadCoverResponse(success=False, message=result or "Upload failed.", cover_url=None)
