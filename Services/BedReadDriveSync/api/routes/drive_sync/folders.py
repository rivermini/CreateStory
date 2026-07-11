"""Folder listing and preview endpoints for drive sync."""

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


class FolderCountDebug(BaseModel):
    total_folders_in_drive: int
    folders_by_prefix: dict[str, int]
    sample_folders_by_prefix: dict[str, list[str]]
    folder_id: str


@router.get("/folders/count-debug", response_model=FolderCountDebug, tags=["Drive Sync"])
async def folder_count_debug() -> FolderCountDebug:
    """Debug endpoint: count folders by prefix (DONE_, EXTENDED_, ING_, INCOMPLETE_). Use to diagnose missing folders."""
    import time as _time
    from api.services.drive_service._paths import _RE_STATUS_PREFIX

    service = get_drive_sync_service()
    if service.get_config() is None:
        raise HTTPException(status_code=400, detail="Drive sync not configured.")

    try:
        drive_service = service._build_drive_service()
    except Exception as exc:
        raise RuntimeError(f"Failed to authenticate with Google Drive: {exc}")

    try:
        raw_folders = service._list_folders(drive_service, service._config.folder_id)
    except Exception as exc:
        raise RuntimeError(f"Google Drive API error: {exc}")

    counts: dict[str, int] = {}
    samples: dict[str, list[str]] = {}
    for f in raw_folders:
        prefix_match = _RE_STATUS_PREFIX.match(f.get("name", ""))
        prefix = prefix_match.group(1).rstrip("_") if prefix_match else "(no prefix)"
        counts[prefix] = counts.get(prefix, 0) + 1
        if prefix not in samples:
            samples[prefix] = []
        if len(samples[prefix]) < 3:
            samples[prefix].append(f.get("name", ""))

    return FolderCountDebug(
        total_folders_in_drive=len(raw_folders),
        folders_by_prefix=counts,
        sample_folders_by_prefix=samples,
        folder_id=service._config.folder_id,
    )


# POST /api/drive-sync/trigger
class DriveSyncTriggerResponse(BaseModel):
    message: str
    sync_id: str
    stories_found: Optional[int] = None


@router.post("/trigger", response_model=DriveSyncTriggerResponse, tags=["Drive Sync"])
async def trigger_sync() -> DriveSyncTriggerResponse:
    """Discover Drive stories and enqueue them in the persistent dispatcher."""
    service = get_drive_sync_service()
    if service.get_config() is None:
        raise HTTPException(
            status_code=400,
            detail="Drive sync not configured. POST /api/drive-sync/config first.",
        )

    from starlette.concurrency import run_in_threadpool

    try:
        sync_id, stories_found = await run_in_threadpool(service.enqueue_full_sync)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return DriveSyncTriggerResponse(
        message="Sync jobs queued in the persistent dispatcher.",
        sync_id=sync_id,
        stories_found=stories_found,
    )
