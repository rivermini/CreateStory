"""Folder listing and preview endpoints for drive sync."""

import uuid
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from api.services.drive_service import get_drive_sync_service
from api.routes.drive_sync.utils import (
    DriveFolderEntry,
    DriveFolderListResponse,
    DriveStoryPreview,
)


router = APIRouter(tags=["Drive Sync"])


# GET /api/drive-sync/folders/all
@router.get("/folders/all", tags=["Drive Sync"])
async def list_all_drive_items():
    """
    Debug endpoint: returns ALL items (files + folders) in the root Drive folder,
    including those without a story prefix.
    """
    service = get_drive_sync_service()
    try:
        return service.list_all_drive_items()
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# GET /api/drive-sync/folders
@router.get("/folders", response_model=DriveFolderListResponse, tags=["Drive Sync"])
async def list_drive_folders(limit: int = 50, offset: int = 0, counts: bool = False) -> DriveFolderListResponse:
    """
    List story folders (DONE_/EXTENDED_/ING_/INCOMPLETE_) sorted by name.
    Pass `counts=true` to include chapter counts.
    """
    service = get_drive_sync_service()
    try:
        if counts:
            folders, total = service.list_drive_folders_with_counts(limit=limit, offset=offset)
        else:
            folders, total = service.list_drive_folders(limit=limit, offset=offset)
        return DriveFolderListResponse(
            folders=[DriveFolderEntry(**f) for f in folders],
            total=total,
            limit=limit,
            offset=offset,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# GET /api/drive-sync/folders/{folder_id}/preview
@router.get("/folders/{folder_id}/preview", response_model=DriveStoryPreview, tags=["Drive Sync"])
async def preview_story_folder(folder_id: str) -> DriveStoryPreview:
    """Preview a story folder — fetches chapter list WITHOUT posting to main BE."""
    service = get_drive_sync_service()
    try:
        preview = service.preview_story(folder_id)
        return DriveStoryPreview(**preview)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# POST /api/drive-sync/folders/{folder_id}/sync
class SingleSyncResult(BaseModel):
    success: bool
    message: str


@router.post("/folders/{folder_id}/sync", tags=["Drive Sync"])
async def sync_single_folder(folder_id: str):
    """Sync a single story folder to the main BE (used for testing)."""
    service = get_drive_sync_service()
    try:
        status = service.sync_single_folder(folder_id)
        errors = status.errors if hasattr(status, 'errors') else []
        if errors:
            return SingleSyncResult(
                success=False,
                message="Sync completed with errors: " + "; ".join(errors)
            )
        return SingleSyncResult(
            success=True,
            message=f"Synced {status.stories_created} stories, {status.chapters_added} chapters."
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


class FileContentResponse(BaseModel):
    success: bool
    content: str
    error: Optional[str] = None


@router.get("/folders/{folder_id}/file/{filename}", response_model=FileContentResponse, tags=["Drive Sync"])
async def get_folder_file_content(folder_id: str, filename: str) -> FileContentResponse:
    """Read the content of a metadata file inside a story folder."""
    service = get_drive_sync_service()
    try:
        content = service.get_file_content(folder_id, filename)
        return FileContentResponse(success=True, content=content)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        return FileContentResponse(success=False, content="", error=str(exc))


class ChapterBreakdownResponse(BaseModel):
    folder_id: str
    subfolder_found: bool
    subfolder_id: Optional[str]
    subfolder_name: Optional[str]
    total_md_files: int
    ext_count: int
    all_filenames: list[str]
    is_chapter_file_results: list[dict]
    is_valid_format_results: list[dict]
    chapter_indices: list[tuple[int, str]]
    format_errors: list[str]
    metadata_files_found: list[str]
    summary: str


@router.get("/folders/{folder_id}/chapter-breakdown", tags=["Drive Sync"])
async def get_folder_chapter_breakdown(folder_id: str) -> ChapterBreakdownResponse:
    """
    Debug endpoint: return a detailed breakdown of every .md file in the chapters-extended
    subfolder. Use to diagnose chapter count discrepancies.
    """
    service = get_drive_sync_service()
    try:
        breakdown = service.get_extended_chapter_breakdown(folder_id)
        return ChapterBreakdownResponse(folder_id=folder_id, **breakdown)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# POST /api/drive-sync/trigger
class DriveSyncTriggerResponse(BaseModel):
    message: str
    sync_id: str
    stories_found: Optional[int] = None


@router.post("/trigger", response_model=DriveSyncTriggerResponse, tags=["Drive Sync"])
async def trigger_sync() -> DriveSyncTriggerResponse:
    """Manually trigger a Google Drive sync immediately (background thread)."""
    service = get_drive_sync_service()
    if service.get_config() is None:
        raise HTTPException(
            status_code=400,
            detail="Drive sync not configured. POST /api/drive-sync/config first.",
        )

    import threading

    sync_id = str(uuid.uuid4())[:8]

    def run_sync():
        service.sync_all()

    thread = threading.Thread(target=run_sync, daemon=True)
    thread.start()

    status = service.get_status()
    return DriveSyncTriggerResponse(
        message="Sync started in background.",
        sync_id=sync_id,
        stories_found=status.stories_found,
    )
