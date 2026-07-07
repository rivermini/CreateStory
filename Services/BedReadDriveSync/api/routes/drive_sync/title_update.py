"""Title update endpoints for drive sync."""

import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from api.services.drive_service import get_drive_sync_service
from api.models.drive_sync import JobKind

logger = logging.getLogger(__name__)


# -------------------------------------------------------------------------
# Pydantic models
# -------------------------------------------------------------------------


class TitleChapterEntry(BaseModel):
    chapter_number: int
    file_name: Optional[str] = None
    drive_title: str = ""
    server_title: Optional[str] = None
    status: str
    message: Optional[str] = None


class TitleFolderEntry(BaseModel):
    story_id: Optional[str] = None
    story_title: str = ""
    folder_id: str
    folder_name: str
    folder_status: str
    matched_count: int = 0
    can_update_count: int = 0
    missing_drive_count: int = 0
    drive_only_count: int = 0
    error_count: int = 0
    chapters: list[TitleChapterEntry] = []


class CheckAllTitleResponse(BaseModel):
    can_update: list[TitleFolderEntry] = []
    all_match: list[TitleFolderEntry] = []
    no_server_match: list[TitleFolderEntry] = []
    empty_chapters: list[TitleFolderEntry] = []


class TitleUpdateChapterResponse(BaseModel):
    success: bool
    message: str
    chapter: Optional[TitleChapterEntry] = None


class TitleUpdateChapterResult(BaseModel):
    chapter_number: int
    success: bool
    message: str


class TitleFolderUpdateResult(BaseModel):
    folder_id: str
    folder_name: str
    story_id: Optional[str] = None
    story_title: str = ""
    update_results: list[TitleUpdateChapterResult] = []
    stopped_at: Optional[int] = None
    stop_reason: Optional[str] = None
    success_count: int = 0
    failed_count: int = 0


class BatchTitleUpdateRequest(BaseModel):
    folder_ids: list[str] = []
    concurrency: Optional[int] = None


class BatchTitleUpdateResponse(BaseModel):
    results: list[TitleFolderUpdateResult] = []


# -------------------------------------------------------------------------
# Router
# -------------------------------------------------------------------------


router = APIRouter(prefix="/title-update", tags=["Drive Sync"])


def _title_history_names(service, folder_id: str, story_title: str = "") -> tuple[str, str]:
    try:
        folders, _ = service.list_drive_folders(limit=10000, offset=0)
        for folder in folders:
            if folder.get("id") == folder_id:
                folder_name = folder.get("name") or folder_id
                display_title = story_title or folder.get("display_name") or folder_name
                return folder_name, f"{display_title} - Title update"
    except Exception:
        pass
    display_title = story_title or folder_id
    return folder_id, f"{display_title} - Title update"


def _record_title_history(
    service,
    *,
    folder_id: str,
    folder_name: str,
    display_name: str,
    result_message: str = "",
    chapters_added: int = 0,
    chapters_skipped: int = 0,
    error: Optional[str] = None,
) -> None:
    try:
        service.record_completed_job(
            kind=JobKind.TITLE_UPDATE,
            folder_id=folder_id,
            folder_name=folder_name,
            display_name=display_name,
            result_message=result_message,
            chapters_added=chapters_added,
            chapters_skipped=chapters_skipped,
            error=error,
        )
    except Exception:
        logger.exception("Failed to record title update history for folder %s", folder_id)


def _to_folder_entry(d: dict) -> TitleFolderEntry:
    chapters = [
        TitleChapterEntry(
            chapter_number=ch.get("chapter_number", 0),
            file_name=ch.get("file_name"),
            drive_title=ch.get("drive_title", ""),
            server_title=ch.get("server_title"),
            status=ch.get("status", "error"),
            message=ch.get("message"),
        )
        for ch in d.get("chapters", [])
    ]
    return TitleFolderEntry(
        story_id=d.get("story_id"),
        story_title=d.get("story_title", ""),
        folder_id=d.get("folder_id", ""),
        folder_name=d.get("folder_name", ""),
        folder_status=d.get("folder_status", "empty_chapters"),
        matched_count=d.get("matched_count", 0),
        can_update_count=d.get("can_update_count", 0),
        missing_drive_count=d.get("missing_drive_count", 0),
        drive_only_count=d.get("drive_only_count", 0),
        error_count=d.get("error_count", 0),
        chapters=chapters,
    )


@router.get("/check-all", response_model=CheckAllTitleResponse, tags=["Drive Sync"])
async def check_all() -> CheckAllTitleResponse:
    """Scan DONE_/EXTENDED_ folders and partition them by chapter-title status."""
    service = get_drive_sync_service()
    if service.get_config() is None:
        raise HTTPException(status_code=400, detail="Drive sync not configured.")

    try:
        result = await asyncio.to_thread(service.check_extended_folders_for_title_update)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.exception("Title check failed")
        raise HTTPException(status_code=500, detail="Title check failed.")

    return CheckAllTitleResponse(
        can_update=[_to_folder_entry(d) for d in result.get("can_update", [])],
        all_match=[_to_folder_entry(d) for d in result.get("all_match", [])],
        no_server_match=[_to_folder_entry(d) for d in result.get("no_server_match", [])],
        empty_chapters=[_to_folder_entry(d) for d in result.get("empty_chapters", [])],
    )


@router.get("/folder/{folder_id}/detail", response_model=TitleFolderEntry, tags=["Drive Sync"])
async def get_folder_detail(folder_id: str) -> TitleFolderEntry:
    """Return a single folder's full chapter-title detail."""
    service = get_drive_sync_service()
    if service.get_config() is None:
        raise HTTPException(status_code=400, detail="Drive sync not configured.")

    try:
        result = await asyncio.to_thread(service.get_title_update_detail_for_folder, folder_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.exception("Title detail failed")
        raise HTTPException(status_code=500, detail="Title detail failed.")

    return _to_folder_entry(result)


@router.post(
    "/update-chapter/{story_id}/{folder_id}/{chapter_number}",
    response_model=TitleUpdateChapterResponse,
    tags=["Drive Sync"],
)
async def update_chapter_title(story_id: str, folder_id: str, chapter_number: int) -> TitleUpdateChapterResponse:
    """Push a single chapter's title from Drive to the main BE."""
    service = get_drive_sync_service()
    if service.get_config() is None:
        raise HTTPException(status_code=400, detail="Drive sync not configured.")

    try:
        result = await asyncio.to_thread(
            service.update_chapter_title_from_drive, story_id, folder_id, chapter_number
        )
    except RuntimeError as exc:
        folder_name, display_name = _title_history_names(service, folder_id)
        _record_title_history(
            service,
            folder_id=folder_id,
            folder_name=folder_name,
            display_name=display_name,
            error=str(exc),
        )
        return TitleUpdateChapterResponse(success=False, message=str(exc))
    except Exception as exc:
        logger.exception("Chapter title update failed")
        raise HTTPException(status_code=500, detail="Chapter title update failed.")

    folder_name, display_name = _title_history_names(service, folder_id)
    _record_title_history(
        service,
        folder_id=folder_id,
        folder_name=folder_name,
        display_name=display_name,
        result_message=f"Chapter {chapter_number} title updated.",
        chapters_added=1,
    )

    chapter = TitleChapterEntry(
        chapter_number=result.get("chapter_number", chapter_number),
        file_name=None,
        drive_title=result.get("new_title", ""),
        server_title=result.get("new_title", ""),
        status="matched",
        message="Title updated.",
    )
    return TitleUpdateChapterResponse(
        success=True, message=f"Chapter {chapter_number} title updated.", chapter=chapter
    )


@router.post(
    "/update-folder/{story_id}/{folder_id}",
    response_model=TitleFolderUpdateResult,
    tags=["Drive Sync"],
)
async def update_folder_titles(story_id: str, folder_id: str) -> TitleFolderUpdateResult:
    """Update every can_update chapter in one folder (sequential, 404 stops)."""
    service = get_drive_sync_service()
    if service.get_config() is None:
        raise HTTPException(status_code=400, detail="Drive sync not configured.")

    try:
        result = await asyncio.to_thread(service.update_folder_titles, story_id, folder_id)
    except RuntimeError as exc:
        folder_name, display_name = _title_history_names(service, folder_id)
        _record_title_history(
            service,
            folder_id=folder_id,
            folder_name=folder_name,
            display_name=display_name,
            error=str(exc),
        )
        return TitleFolderUpdateResult(
            folder_id=folder_id,
            folder_name=folder_name,
            story_id=story_id,
            stop_reason=str(exc),
            success_count=0,
            failed_count=0,
        )
    except Exception as exc:
        logger.exception("Folder title update failed")
        raise HTTPException(status_code=500, detail="Folder title update failed.")

    success_count = result.get("success_count", 0)
    failed_count = result.get("failed_count", 0)
    folder_name, display_name = _title_history_names(service, folder_id)
    _record_title_history(
        service,
        folder_id=folder_id,
        folder_name=folder_name,
        display_name=display_name,
        result_message=f"Titles updated: {success_count} succeeded, {failed_count} failed.",
        chapters_added=success_count,
        chapters_skipped=failed_count,
        error=result.get("stop_reason") if failed_count > 0 else None,
    )

    return TitleFolderUpdateResult(
        folder_id=folder_id,
        folder_name=folder_name,
        story_id=story_id,
        update_results=[
            TitleUpdateChapterResult(
                chapter_number=r.get("chapter_number", 0),
                success=bool(r.get("success")),
                message=r.get("message", ""),
            )
            for r in result.get("results", [])
        ],
        stopped_at=result.get("stopped_at"),
        stop_reason=result.get("stop_reason"),
        success_count=success_count,
        failed_count=failed_count,
    )


@router.post("/batch-update", response_model=BatchTitleUpdateResponse, tags=["Drive Sync"])
async def batch_update(body: BatchTitleUpdateRequest) -> BatchTitleUpdateResponse:
    """Update multiple folders with bounded concurrency (default 2 at a time)."""
    service = get_drive_sync_service()
    if service.get_config() is None:
        raise HTTPException(status_code=400, detail="Drive sync not configured.")

    folder_ids = [fid for fid in (body.folder_ids or []) if fid]
    if not folder_ids:
        raise HTTPException(status_code=400, detail="No folder IDs provided.")

    concurrency = body.concurrency or 2
    try:
        result = await asyncio.to_thread(
            service.batch_update_folders_titles, folder_ids, concurrency
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.exception("Batch title update failed")
        raise HTTPException(status_code=500, detail="Batch title update failed.")

    # Record each folder result to sync history
    for r in result.get("results", []):
        sc = r.get("success_count", 0)
        fc = r.get("failed_count", 0)
        _record_title_history(
            service,
            folder_id=r.get("folder_id", ""),
            folder_name=r.get("folder_name", ""),
            display_name=f"{r.get('story_title') or r.get('folder_name', '')} - Title update",
            result_message=f"Titles updated: {sc} succeeded, {fc} failed.",
            chapters_added=sc,
            chapters_skipped=fc,
            error=r.get("stop_reason") if fc > 0 else None,
        )

    return BatchTitleUpdateResponse(
        results=[
            TitleFolderUpdateResult(
                folder_id=r.get("folder_id", ""),
                folder_name=r.get("folder_name", ""),
                story_id=r.get("story_id"),
                story_title=r.get("story_title", ""),
                update_results=[
                    TitleUpdateChapterResult(
                        chapter_number=ur.get("chapter_number", 0),
                        success=bool(ur.get("success")),
                        message=ur.get("message", ""),
                    )
                    for ur in r.get("update_results", [])
                ],
                stopped_at=r.get("stopped_at"),
                stop_reason=r.get("stop_reason"),
                success_count=r.get("success_count", 0),
                failed_count=r.get("failed_count", 0),
            )
            for r in result.get("results", [])
        ]
    )
