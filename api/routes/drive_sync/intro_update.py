"""Intro update endpoints for drive sync."""

import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from api.services.drive_service import get_drive_sync_service

logger = logging.getLogger(__name__)


class IntroUpdateStatus(BaseModel):
    story_id: Optional[str] = None
    story_title: str
    folder_id: str
    folder_name: str
    intro_file_name: Optional[str] = None
    status: str
    last_updated: Optional[str] = None


class CheckAllIntroResponse(BaseModel):
    can_update: list[IntroUpdateStatus]
    updated: list[IntroUpdateStatus]
    no_intro1_file: list[IntroUpdateStatus]
    no_server_match: list[IntroUpdateStatus]
    not_recommended: list[IntroUpdateStatus]


class CheckUpdatedIntroResponse(BaseModel):
    entries: list[IntroUpdateStatus]


class UploadIntroResponse(BaseModel):
    success: bool
    message: str
    intro_url: Optional[str] = None


router = APIRouter(prefix="/intro-update", tags=["Drive Sync"])


@router.get("/check-all", response_model=CheckAllIntroResponse, tags=["Drive Sync"])
async def check_all(intro_filename: str = "intro1.jpg") -> CheckAllIntroResponse:
    """
    Scan all DONE_/EXTENDED_ folders and return intro-update status for each.
    - can_update: folder has intro file, story exists on server, no prior update record
    - updated: folder has intro file, story exists, prior update record found
    - no_intro1_file: folder has no intro file
    - no_server_match: folder has intro file but no matching story on server
    - not_recommended: folder has intro file and story exists, but the story is not in the
      admin recommended list, so the intro cannot be uploaded
    """
    import asyncio
    import sys

    msg = f"[CHECK_ALL] intro-update received intro_filename={intro_filename!r}"
    logger.info(msg)
    print(msg, flush=True)

    service = get_drive_sync_service()
    if service.get_config() is None:
        raise HTTPException(status_code=400, detail="Drive sync not configured.")

    try:
        result = await asyncio.to_thread(service.check_extended_folders_for_intro, intro_filename)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Intro check failed: {exc}")

    summary = (
        f"[CHECK_ALL] intro-update done: intro_filename={intro_filename!r} "
        f"can_update={len(result.get('can_update', []))} "
        f"updated={len(result.get('updated', []))} "
        f"no_intro1_file={len(result.get('no_intro1_file', []))} "
        f"no_server_match={len(result.get('no_server_match', []))} "
        f"not_recommended={len(result.get('not_recommended', []))}"
    )
    logger.info(summary)
    print(summary, flush=True)
    sys.stdout.flush()

    def make_entry(d: dict) -> IntroUpdateStatus:
        return IntroUpdateStatus(
            story_id=d.get("story_id"),
            story_title=d.get("story_title", ""),
            folder_id=d.get("folder_id", ""),
            folder_name=d.get("folder_name", ""),
            intro_file_name=d.get("intro_file_name"),
            status=d.get("status", "unknown"),
            last_updated=d.get("last_updated"),
        )

    return CheckAllIntroResponse(
        can_update=[make_entry(e) for e in result.get("can_update", [])],
        updated=[make_entry(e) for e in result.get("updated", [])],
        no_intro1_file=[make_entry(e) for e in result.get("no_intro1_file", [])],
        no_server_match=[make_entry(e) for e in result.get("no_server_match", [])],
        not_recommended=[make_entry(e) for e in result.get("not_recommended", [])],
    )


@router.get("/check-updated", response_model=CheckUpdatedIntroResponse, tags=["Drive Sync"])
async def check_updated() -> CheckUpdatedIntroResponse:
    """Return all entries from intro_update_histories table."""
    import asyncio

    service = get_drive_sync_service()
    if service.get_config() is None:
        raise HTTPException(status_code=400, detail="Drive sync not configured.")

    try:
        histories = await asyncio.to_thread(service.get_intro_update_histories_for_intro_update_folders)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to load history: {exc}")

    def make_entry(d: dict) -> IntroUpdateStatus:
        return IntroUpdateStatus(
            story_id=d.get("story_id"),
            story_title=d.get("story_title", ""),
            folder_id=d.get("folder_id", ""),
            folder_name=d.get("folder_name", ""),
            intro_file_name=d.get("intro_file_name"),
            status=d.get("status", "updated"),
            last_updated=d.get("last_updated"),
        )

    return CheckUpdatedIntroResponse(entries=[make_entry(h) for h in histories])


@router.post("/upload/{folder_id}/{story_id}", response_model=UploadIntroResponse, tags=["Drive Sync"])
async def upload_intro(folder_id: str, story_id: str, intro_filename: str = "intro1.jpg") -> UploadIntroResponse:
    """
    Download the configured intro file from the given Drive folder and POST it to the main BE.
    Records the result in intro_update_histories.
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
        success, result = service._upload_story_intro_from_folder(story_id, folder_id, intro_filename, story_title)
        return success, result

    try:
        success, result = await asyncio.to_thread(_do_upload)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Intro upload failed: {exc}")

    if success:
        service._record_intro_update(
            story_id=story_id,
            story_title=story_title,
            folder_id=folder_id,
            folder_name=folder_name,
            status="updated",
            intro_file_name=intro_filename,
            intro_url=result,
        )
        return UploadIntroResponse(success=True, message="Intro uploaded successfully.", intro_url=result)
    else:
        service._record_intro_update(
            story_id=story_id,
            story_title=story_title,
            folder_id=folder_id,
            folder_name=folder_name,
            status="error",
            intro_file_name=intro_filename,
            error=result or "Upload failed.",
        )
        return UploadIntroResponse(success=False, message=result or "Upload failed.", intro_url=None)
