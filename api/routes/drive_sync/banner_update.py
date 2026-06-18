"""Banner update endpoints for drive sync."""

import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from api.services.drive_service import get_drive_sync_service

logger = logging.getLogger(__name__)


class BannerUpdateStatus(BaseModel):
    story_id: Optional[str] = None
    story_title: str
    folder_id: str
    folder_name: str
    banner_file_name: Optional[str] = None
    status: str
    last_updated: Optional[str] = None


class CheckAllResponse(BaseModel):
    can_update: list[BannerUpdateStatus]
    updated: list[BannerUpdateStatus]
    no_banner1_file: list[BannerUpdateStatus]
    no_server_match: list[BannerUpdateStatus]


class CheckUpdatedResponse(BaseModel):
    entries: list[BannerUpdateStatus]


class UploadBannerResponse(BaseModel):
    success: bool
    message: str
    banner_url: Optional[str] = None


router = APIRouter(prefix="/banner-update", tags=["Drive Sync"])


@router.get("/check-all", response_model=CheckAllResponse, tags=["Drive Sync"])
async def check_all(banner_filename: str = "banner1.jpg") -> CheckAllResponse:
    """
    Scan all DONE_/EXTENDED_ folders and return banner-update status for each.
    - can_update: folder has banner file, story exists on server, no prior update record
    - updated: folder has banner file, story exists, prior update record found
    - no_banner1_file: folder has no banner file
    - no_server_match: folder has banner file but no matching story on server
    """
    import asyncio
    import sys

    msg = f"[CHECK_ALL] banner-update received banner_filename={banner_filename!r}"
    logger.info(msg)
    print(msg, flush=True)

    service = get_drive_sync_service()
    if service.get_config() is None:
        raise HTTPException(status_code=400, detail="Drive sync not configured.")

    try:
        result = await asyncio.to_thread(service.check_extended_folders_for_banner, banner_filename)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Banner check failed: {exc}")

    summary = (
        f"[CHECK_ALL] banner-update done: banner_filename={banner_filename!r} "
        f"can_update={len(result.get('can_update', []))} "
        f"updated={len(result.get('updated', []))} "
        f"no_banner1_file={len(result.get('no_banner1_file', []))} "
        f"no_server_match={len(result.get('no_server_match', []))}"
    )
    logger.info(summary)
    print(summary, flush=True)
    sys.stdout.flush()

    def make_entry(d: dict) -> BannerUpdateStatus:
        return BannerUpdateStatus(
            story_id=d.get("story_id"),
            story_title=d.get("story_title", ""),
            folder_id=d.get("folder_id", ""),
            folder_name=d.get("folder_name", ""),
            banner_file_name=d.get("banner_file_name"),
            status=d.get("status", "unknown"),
            last_updated=d.get("last_updated"),
        )

    return CheckAllResponse(
        can_update=[make_entry(e) for e in result.get("can_update", [])],
        updated=[make_entry(e) for e in result.get("updated", [])],
        no_banner1_file=[make_entry(e) for e in result.get("no_banner1_file", [])],
        no_server_match=[make_entry(e) for e in result.get("no_server_match", [])],
    )


@router.get("/check-updated", response_model=CheckUpdatedResponse, tags=["Drive Sync"])
async def check_updated() -> CheckUpdatedResponse:
    """Return all entries from banner_update_histories table."""
    import asyncio

    service = get_drive_sync_service()
    if service.get_config() is None:
        raise HTTPException(status_code=400, detail="Drive sync not configured.")

    try:
        histories = await asyncio.to_thread(service.get_banner_update_histories_for_banner_update_folders)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to load history: {exc}")

    def make_entry(d: dict) -> BannerUpdateStatus:
        # The history row from the repository uses the cover-shaped field name
        # 'cover_file_name' (kept for UI compatibility). The banner storage path
        # also uses 'banner_file_name'. Prefer the banner-named key when present.
        return BannerUpdateStatus(
            story_id=d.get("story_id"),
            story_title=d.get("story_title", ""),
            folder_id=d.get("folder_id", ""),
            folder_name=d.get("folder_name", ""),
            banner_file_name=d.get("banner_file_name") or d.get("cover_file_name"),
            status=d.get("status", "updated"),
            last_updated=d.get("last_updated"),
        )

    return CheckUpdatedResponse(entries=[make_entry(h) for h in histories])


@router.post("/upload/{folder_id}/{story_id}", response_model=UploadBannerResponse, tags=["Drive Sync"])
async def upload_banner(folder_id: str, story_id: str, banner_filename: str = "banner1.jpg") -> UploadBannerResponse:
    """
    Download the configured banner file from the given Drive folder and POST it to the main BE.
    Records the result in banner_update_histories.
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
        success, result = service._upload_story_banner_from_folder(story_id, folder_id, banner_filename)
        return success, result

    try:
        success, result = await asyncio.to_thread(_do_upload)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Banner upload failed: {exc}")

    if success:
        service._record_banner_update(
            story_id=story_id,
            story_title=story_title,
            folder_id=folder_id,
            folder_name=folder_name,
            status="updated",
            banner_file_name=banner_filename,
            banner_url=result,
        )
        return UploadBannerResponse(success=True, message="Banner uploaded successfully.", banner_url=result)
    else:
        service._record_banner_update(
            story_id=story_id,
            story_title=story_title,
            folder_id=folder_id,
            folder_name=folder_name,
            status="error",
            banner_file_name=banner_filename,
            error=result or "Upload failed.",
        )
        return UploadBannerResponse(success=False, message=result or "Upload failed.", banner_url=None)
