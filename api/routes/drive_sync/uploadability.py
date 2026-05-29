"""Uploadability check and chapter update endpoints for drive sync."""

import asyncio
import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from api.models.drive_sync import JobCreateRequest, JobCreateResponse
from api.services.drive_service import get_drive_sync_service
from api.routes.drive_sync.utils import (
    DriveFolderEntry,
    DriveFolderListResponse,
    ServerStoryRef,
    CheckUploadableResponse,
    UpdatableStoryEntry,
    ServerOnlyStoryEntry,
    CheckUpdatableResponse,
    _is_valid_upload_format,
)

logger = logging.getLogger(__name__)


def _normalize(s: str) -> str:
    """Normalize a story title for comparison."""
    for ch in ("\u2019", "\u2018", "\u201A", "\u201B", "\u02BC", "\u02BB", "\uFF07"):
        s = s.replace(ch, "'")
    return s.strip().lower()


router = APIRouter(tags=["Drive Sync"])


# GET /api/drive-sync/check-uploadable
@router.get("/check-uploadable", response_model=CheckUploadableResponse, tags=["Drive Sync"])
async def check_uploadable() -> CheckUploadableResponse:
    """
    Cross-reference Drive folders (DONE_/ING_/INCOMPLETE_) with the main BE's
    story list. Returns which Drive folders are not yet on the server (uploadable).
    """
    service = get_drive_sync_service()
    if service.get_config() is None:
        raise HTTPException(status_code=400, detail="Drive sync not configured.")

    try:
        drive_folders_raw, _ = await asyncio.to_thread(service.list_drive_folders, limit=10000, offset=0)
        server_stories = await asyncio.to_thread(service.get_all_server_stories)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    uploadable_prefixes = {"DONE"}
    candidate_folders = [f for f in drive_folders_raw if f.get("prefix") in uploadable_prefixes]
    server_titles = {_normalize(s["title"]) for s in server_stories}

    candidate_ids = [f["id"] for f in candidate_folders]
    drive_service = service._build_drive_service()
    dup_check_results, ext_count_by_folder_id, chapter_count_by_folder_id, first_chapter_by_id, format_errors, sequential_errors, _ = service._batch_check_duplicates_and_count_extended(
        drive_service, candidate_ids, check_extended_only=False
    )

    uploadable = []
    already_on_server = []
    invalid = []
    for folder in candidate_folders:
        folder["is_valid_format"] = _is_valid_upload_format(folder.get("name", ""))
        folder["validation_errors"] = []
        folder["chapter_count"] = chapter_count_by_folder_id.get(folder["id"])
        folder["extended_chapter_count"] = ext_count_by_folder_id.get(folder["id"])
        entry = DriveFolderEntry(**folder)
        title_lower = _normalize(folder.get("display_name", ""))

        if title_lower in server_titles:
            already_on_server.append(entry)
            continue

        if not folder["is_valid_format"]:
            folder["validation_errors"].append("WRONG FORMAT")
            invalid.append(DriveFolderEntry(**folder))
            continue

        has_duplicates, dupes = dup_check_results.get(folder["id"], (False, []))
        if has_duplicates:
            folder["has_chapter_duplicates"] = True
            for d in dupes:
                folder["validation_errors"].append(f"DUPLICATE CHAPTER: {d}")
            invalid.append(DriveFolderEntry(**folder))
            continue

        bad_filenames = format_errors.get(folder["id"], [])
        if bad_filenames:
            for name in bad_filenames[:3]:
                folder["validation_errors"].append(f"WRONG CHAPTER FORMAT: {name}")
            invalid.append(DriveFolderEntry(**folder))
            continue

        first_chapter = first_chapter_by_id.get(folder["id"])
        if first_chapter is not None and first_chapter != 1:
            folder["validation_errors"].append(f"NON_SEQUENTIAL: Chapters must start at 1, found first chapter {first_chapter}")
            invalid.append(DriveFolderEntry(**folder))
            continue

        missing_chapters = sequential_errors.get(folder["id"], [])
        if missing_chapters:
            chapter_list = ", ".join(str(c) for c in missing_chapters)
            entry.validation_errors.append(f"MISSING CHAPTERS: {chapter_list}")

        uploadable.append(entry)

    uploadable.sort(key=lambda f: f.is_valid_format, reverse=True)

    return CheckUploadableResponse(
        drive_folders=candidate_folders,
        server_stories=[ServerStoryRef(**s) for s in server_stories],
        uploadable=uploadable,
        already_on_server=already_on_server,
        invalid=invalid,
    )


# GET /api/drive-sync/check-updatable
@router.get("/check-updatable", response_model=CheckUpdatableResponse, tags=["Drive Sync"])
async def check_updatable() -> CheckUpdatableResponse:
    """
    Cross-reference Drive EXTENDED_ folders with the main BE's story list.
    Returns stories where the Drive EXTENDED folder has new chapters that are sequential.
    """
    service = get_drive_sync_service()
    if service.get_config() is None:
        raise HTTPException(status_code=400, detail="Drive sync not configured.")

    try:
        drive_folders_raw, _ = await asyncio.to_thread(service.list_drive_folders, limit=10000, offset=0)
        server_stories = await asyncio.to_thread(service.get_all_server_stories)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to list folders: {exc}")

    extended_folders = [f for f in drive_folders_raw if f.get("prefix") == "EXTENDED"]

    server_by_title: dict[str, ServerStoryRef] = {}
    for s in server_stories:
        try:
            server_by_title[_normalize(s["title"])] = ServerStoryRef(
                id=s["id"], title=s["title"], maxChapter=s["maxChapter"]
            )
        except Exception as exc:
            logger.warning("Skipping malformed server story: %s", exc)

    extended_ids = [f["id"] for f in extended_folders]
    drive_service = service._build_drive_service()

    try:
        dup_check_results, ext_count_by_folder_id, _, _, format_errors, _, ext_indices = service._batch_check_duplicates_and_count_extended(
            drive_service, extended_ids, check_extended_only=True
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Batch chapter check failed: {exc}")

    try:
        has_free_by_folder, has_tags_by_folder = service._batch_get_free_and_tag_counts(drive_service, extended_ids)
    except Exception:
        has_free_by_folder = {fid: False for fid in extended_ids}
        has_tags_by_folder = {fid: False for fid in extended_ids}

    updatable = []
    no_update_needed = []
    invalid = []
    no_server_match = []
    empty_extended = []
    for folder in extended_folders:
        folder_id = folder["id"]
        folder["extended_chapter_count"] = ext_count_by_folder_id.get(folder_id, 0)
        try:
            entry = DriveFolderEntry(**folder)
        except Exception as exc:
            logger.warning("Skipping malformed drive folder: %s", exc)
            continue
        title_lower = _normalize(folder.get("display_name", ""))
        server_story = server_by_title.get(title_lower)
        if server_story is None:
            no_server_match.append(entry)
            continue

        display_name = folder.get("display_name", "")
        last_updated = await asyncio.to_thread(service.get_last_update_time, display_name)

        has_duplicates, dupes = dup_check_results.get(folder_id, (False, []))
        if has_duplicates:
            entry.has_chapter_duplicates = True
            for d in dupes:
                entry.validation_errors.append(f"DUPLICATE CHAPTER: {d}")
            invalid.append(UpdatableStoryEntry(
                folder=entry, server_story=server_story, free_chapters_count=None, tags=None,
                has_free_md=has_free_by_folder.get(folder_id, False),
                has_tags_md=has_tags_by_folder.get(folder_id, False), last_updated=last_updated,
            ))
            continue

        bad_filenames = format_errors.get(folder_id, [])
        if bad_filenames:
            for name in bad_filenames[:3]:
                entry.validation_errors.append(f"WRONG CHAPTER FORMAT: {name}")
            invalid.append(UpdatableStoryEntry(
                folder=entry, server_story=server_story, free_chapters_count=None, tags=None,
                has_free_md=has_free_by_folder.get(folder_id, False),
                has_tags_md=has_tags_by_folder.get(folder_id, False), last_updated=last_updated,
            ))
            continue

        drive_chapters = folder.get("extended_chapter_count") or 0
        if drive_chapters == 0:
            empty_extended.append(entry)
            continue

        new_entries = [(idx, fname) for idx, fname in ext_indices.get(folder_id, []) if idx > server_story.maxChapter]

        free_chapters_count: Optional[int] = None
        tags: Optional[list[str]] = None
        has_free_md = has_free_by_folder.get(folder_id, False)
        has_tags_md = has_tags_by_folder.get(folder_id, False)

        if not new_entries:
            no_update_needed.append(UpdatableStoryEntry(
                folder=entry, server_story=server_story, free_chapters_count=free_chapters_count,
                tags=tags, has_free_md=has_free_md, has_tags_md=has_tags_md, last_updated=last_updated,
            ))
            continue

        rewritten_files = [fname for idx, fname in new_entries if "rewritten" in fname.lower()]
        if rewritten_files:
            entry.validation_errors.append(
                f"CHAPTERS_REWRITTEN: Chapters contain rewritten files: {', '.join(rewritten_files[:3])}"
            )
            invalid.append(UpdatableStoryEntry(
                folder=entry, server_story=server_story, free_chapters_count=free_chapters_count,
                tags=tags, has_free_md=has_free_md, has_tags_md=has_tags_md, last_updated=last_updated,
            ))
            continue

        new_indices = [idx for idx, fname in new_entries]

        expected_first = server_story.maxChapter + 1
        if sorted(new_indices)[0] != expected_first:
            entry.validation_errors.append(
                f"CHAPTERS_START_MID_SERIES: First new chapter is {sorted(new_indices)[0]}, "
                f"but server has up to chapter {server_story.maxChapter}. Must start at chapter {expected_first}."
            )
            invalid.append(UpdatableStoryEntry(
                folder=entry, server_story=server_story, free_chapters_count=free_chapters_count,
                tags=tags, has_free_md=has_free_md, has_tags_md=has_tags_md, last_updated=last_updated,
            ))
            continue

        missing = []
        if len(new_indices) >= 2:
            sorted_new = sorted(new_indices)
            full_range = set(range(sorted_new[0], sorted_new[-1] + 1))
            missing = sorted(full_range - set(sorted_new))
        if missing:
            chapter_list = ", ".join(str(c) for c in missing)
            entry.validation_errors.append(f"NON_SEQUENTIAL: Missing chapters {chapter_list}")
            invalid.append(UpdatableStoryEntry(
                folder=entry, server_story=server_story, free_chapters_count=free_chapters_count,
                tags=tags, has_free_md=has_free_md, has_tags_md=has_tags_md, last_updated=last_updated,
            ))
            continue

        updatable.append(UpdatableStoryEntry(
            folder=entry, server_story=server_story, new_chapters_count=len(new_indices),
            free_chapters_count=free_chapters_count, tags=tags,
            has_free_md=has_free_md, has_tags_md=has_tags_md, last_updated=last_updated,
        ))

    return CheckUpdatableResponse(
        all_extended_folders=extended_folders,
        server_stories=[ServerStoryRef(**s) for s in server_stories],
        updatable=updatable,
        no_update_needed=no_update_needed,
        no_server_match=no_server_match,
        empty_extended=empty_extended,
        invalid=invalid,
        no_drive_folder=[],
    )


# GET /api/drive-sync/check-updatable/reader-finished
@router.get("/check-updatable/reader-finished", response_model=CheckUpdatableResponse, tags=["Drive Sync"])
async def check_updatable_reader_finished() -> CheckUpdatableResponse:
    """
    Fast check: look at EXTENDED_ folders whose titles match stories returned
    by the reader-finished API.
    """
    service = get_drive_sync_service()
    if service.get_config() is None:
        raise HTTPException(status_code=400, detail="Drive sync not configured.")

    try:
        raw_result = await asyncio.to_thread(service.get_stories_needing_update)
        server_stories = await asyncio.to_thread(service.get_all_server_stories)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    inner = raw_result.get("data") or {}
    reader_stories: list[dict] = inner.get("data") if isinstance(inner, dict) else (inner or [])
    if reader_stories is None:
        reader_stories = []
    reader_titles_lower: set[str] = {_normalize(s.get("title", "")) for s in reader_stories if s.get("title")}

    server_by_title: dict[str, ServerStoryRef] = {}
    for s in server_stories:
        title = _normalize(s.get("title", ""))
        if title:
            server_by_title[title] = ServerStoryRef(
                id=s.get("id") or "",
                title=s.get("title", ""),
                maxChapter=s.get("maxChapter") or 0,
            )

    try:
        drive_folders_raw, _ = await asyncio.to_thread(service.list_drive_folders, limit=10000, offset=0)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    matched_extended_folders = [
        f for f in drive_folders_raw
        if f.get("prefix") == "EXTENDED" and _normalize(f.get("display_name", "")) in reader_titles_lower
    ]

    if not matched_extended_folders:
        # Still detect no_drive_folder by comparing all reader titles against all EXTENDED_ folders
        extended_display_names_lower = {_normalize(f.get("display_name", "")) for f in drive_folders_raw if f.get("prefix") == "EXTENDED"}
        no_drive_folder: list[ServerOnlyStoryEntry] = []
        for s in reader_stories:
            title = _normalize(s.get("title", ""))
            if title and title not in extended_display_names_lower:
                server_ref = server_by_title.get(title)
                if server_ref:
                    last_updated = await asyncio.to_thread(service.get_last_update_time, server_ref.title)
                    no_drive_folder.append(ServerOnlyStoryEntry(server_story=server_ref, last_updated=last_updated))
        return CheckUpdatableResponse(
            all_extended_folders=[],
            server_stories=[ServerStoryRef(**s) for s in server_stories],
            updatable=[],
            no_update_needed=[],
            no_server_match=[],
            empty_extended=[],
            invalid=[],
            no_drive_folder=no_drive_folder,
        )

    matched_ids = [f["id"] for f in matched_extended_folders]
    drive_service = service._build_drive_service()

    try:
        dup_check_results, ext_count_by_folder_id, _, _, format_errors, _, ext_indices = (
            service._batch_check_duplicates_and_count_extended(
                drive_service, matched_ids, check_extended_only=True
            )
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Batch chapter check failed: {exc}")

    try:
        has_free_by_folder, has_tags_by_folder = service._batch_get_free_and_tag_counts(drive_service, matched_ids)
    except Exception:
        has_free_by_folder = {fid: False for fid in matched_ids}
        has_tags_by_folder = {fid: False for fid in matched_ids}

    updatable: list[UpdatableStoryEntry] = []
    no_update_needed: list[UpdatableStoryEntry] = []
    invalid: list[UpdatableStoryEntry] = []
    no_server_match: list[DriveFolderEntry] = []
    empty_extended: list[DriveFolderEntry] = []
    no_drive_folder: list[ServerOnlyStoryEntry] = []
    matched_folder_titles_lower = {_normalize(f.get("display_name", "")) for f in matched_extended_folders}

    for folder in matched_extended_folders:
        folder_id = folder["id"]
        title_lower = _normalize(folder.get("display_name", ""))
        folder["extended_chapter_count"] = ext_count_by_folder_id.get(folder_id, 0)
        try:
            entry = DriveFolderEntry(**folder)
        except Exception as exc:
            logger.warning("Skipping malformed drive folder: %s", exc)
            continue

        server_story = server_by_title.get(title_lower) or ServerStoryRef(
            id="", title=folder.get("display_name", ""), maxChapter=0
        )

        display_name = folder.get("display_name", "")
        last_updated = await asyncio.to_thread(service.get_last_update_time, display_name)

        has_duplicates, dupes = dup_check_results.get(folder_id, (False, []))
        if has_duplicates:
            entry.has_chapter_duplicates = True
            for d in dupes:
                entry.validation_errors.append(f"DUPLICATE CHAPTER: {d}")
            invalid.append(UpdatableStoryEntry(
                folder=entry, server_story=server_story, free_chapters_count=None, tags=None,
                has_free_md=has_free_by_folder.get(folder_id, False),
                has_tags_md=has_tags_by_folder.get(folder_id, False), last_updated=last_updated,
            ))
            continue

        bad_filenames = format_errors.get(folder_id, [])
        if bad_filenames:
            for name in bad_filenames[:3]:
                entry.validation_errors.append(f"WRONG CHAPTER FORMAT: {name}")
            invalid.append(UpdatableStoryEntry(
                folder=entry, server_story=server_story, free_chapters_count=None, tags=None,
                has_free_md=has_free_by_folder.get(folder_id, False),
                has_tags_md=has_tags_by_folder.get(folder_id, False), last_updated=last_updated,
            ))
            continue

        drive_chapters = folder.get("extended_chapter_count") or 0
        if drive_chapters == 0:
            empty_extended.append(entry)
            continue

        new_entries = [(idx, fname) for idx, fname in ext_indices.get(folder_id, []) if idx > server_story.maxChapter]

        if not new_entries:
            no_update_needed.append(UpdatableStoryEntry(
                folder=entry, server_story=server_story, free_chapters_count=None, tags=None,
                has_free_md=has_free_by_folder.get(folder_id, False),
                has_tags_md=has_tags_by_folder.get(folder_id, False), last_updated=last_updated,
            ))
            continue

        rewritten_files = [fname for idx, fname in new_entries if "rewritten" in fname.lower()]
        if rewritten_files:
            entry.validation_errors.append(
                f"CHAPTERS_REWRITTEN: Chapters contain rewritten files: {', '.join(rewritten_files[:3])}"
            )
            invalid.append(UpdatableStoryEntry(
                folder=entry, server_story=server_story, free_chapters_count=None, tags=None,
                has_free_md=has_free_by_folder.get(folder_id, False),
                has_tags_md=has_tags_by_folder.get(folder_id, False), last_updated=last_updated,
            ))
            continue

        new_indices = [idx for idx, fname in new_entries]

        expected_first = server_story.maxChapter + 1
        if sorted(new_indices)[0] != expected_first:
            entry.validation_errors.append(
                f"CHAPTERS_START_MID_SERIES: First new chapter is {sorted(new_indices)[0]}, "
                f"but server has up to chapter {server_story.maxChapter}. Must start at chapter {expected_first}."
            )
            invalid.append(UpdatableStoryEntry(
                folder=entry, server_story=server_story, free_chapters_count=None, tags=None,
                has_free_md=has_free_by_folder.get(folder_id, False),
                has_tags_md=has_tags_by_folder.get(folder_id, False), last_updated=last_updated,
            ))
            continue

        missing = []
        if len(new_indices) >= 2:
            sorted_new = sorted(new_indices)
            full_range = set(range(sorted_new[0], sorted_new[-1] + 1))
            missing = sorted(full_range - set(sorted_new))
        if missing:
            chapter_list = ", ".join(str(c) for c in missing)
            entry.validation_errors.append(f"NON_SEQUENTIAL: Missing chapters {chapter_list}")
            invalid.append(UpdatableStoryEntry(
                folder=entry, server_story=server_story, free_chapters_count=None, tags=None,
                has_free_md=has_free_by_folder.get(folder_id, False),
                has_tags_md=has_tags_by_folder.get(folder_id, False), last_updated=last_updated,
            ))
            continue

        updatable.append(UpdatableStoryEntry(
            folder=entry, server_story=server_story, new_chapters_count=len(new_indices),
            free_chapters_count=None, tags=None,
            has_free_md=has_free_by_folder.get(folder_id, False),
            has_tags_md=has_tags_by_folder.get(folder_id, False), last_updated=last_updated,
        ))

    for s in reader_stories:
        title = _normalize(s.get("title", ""))
        if title in reader_titles_lower and title not in matched_folder_titles_lower:
            server_ref = server_by_title.get(title)
            if server_ref:
                last_updated = await asyncio.to_thread(service.get_last_update_time, server_ref.title)
                no_drive_folder.append(ServerOnlyStoryEntry(server_story=server_ref, last_updated=last_updated))

    return CheckUpdatableResponse(
        all_extended_folders=matched_extended_folders,
        server_stories=[ServerStoryRef(**s) for s in server_stories],
        updatable=updatable,
        no_update_needed=no_update_needed,
        no_server_match=no_server_match,
        empty_extended=empty_extended,
        invalid=invalid,
        no_drive_folder=no_drive_folder,
    )


# GET /api/drive-sync/check-updatable/reader-finished/debug
class CheckUpdatableDebugResponse(BaseModel):
    reader_titles: list[str]
    reader_titles_normalized: list[str]
    extended_folder_names: list[str]
    extended_folder_display_names: list[str]
    extended_folder_display_names_normalized: list[str]
    matched_titles_normalized: list[str]
    no_drive_folder_reason: dict
    all_drive_folder_names: list[str]
    pregnant_folders: list[str]


@router.get("/check-updatable/reader-finished/debug", response_model=CheckUpdatableDebugResponse, tags=["Drive Sync"])
async def check_updatable_reader_finished_debug() -> CheckUpdatableDebugResponse:
    """Debug endpoint for /check-updatable/reader-finished."""
    service = get_drive_sync_service()
    if service.get_config() is None:
        raise HTTPException(status_code=400, detail="Drive sync not configured.")

    try:
        raw_result = await asyncio.to_thread(service.get_stories_needing_update)
        server_stories = await asyncio.to_thread(service.get_all_server_stories)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    inner = raw_result.get("data") or {}
    reader_stories: list[dict] = inner.get("data") if isinstance(inner, dict) else (inner or [])
    if reader_stories is None:
        reader_stories = []

    try:
        drive_folders_raw, _ = await asyncio.to_thread(service.list_drive_folders, limit=10000, offset=0)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    extended_folders = [f for f in drive_folders_raw if f.get("prefix") == "EXTENDED"]
    all_drive_folder_names = [f.get("name", "") for f in drive_folders_raw]
    pregnant_folders = [f.get("name", "") for f in drive_folders_raw if "pregnant" in f.get("name", "").lower()]

    reader_titles = [s.get("title", "") for s in reader_stories if s.get("title")]
    reader_titles_normalized = [_normalize(t) for t in reader_titles]

    ext_names = [f.get("name", "") for f in extended_folders]
    ext_display = [f.get("display_name", "") for f in extended_folders]
    ext_display_norm = [_normalize(d) for d in ext_display]

    matched = [d for d in ext_display_norm if d in reader_titles_normalized]

    no_drive_folder_reason: dict[str, str] = {}
    for title, norm in zip(reader_titles, reader_titles_normalized):
        if norm in matched:
            no_drive_folder_reason[title] = "MATCHED"
        else:
            similar = [d for d in ext_display if _normalize(d)[:10] == norm[:10]]
            if similar:
                no_drive_folder_reason[title] = f"NO DRIVE FOLDER MATCH: closest EXTENDED folder display_name={repr(similar[0])}"
            else:
                no_drive_folder_reason[title] = "NO SIMILAR EXTENDED FOLDER FOUND"

    return CheckUpdatableDebugResponse(
        reader_titles=reader_titles,
        reader_titles_normalized=reader_titles_normalized,
        extended_folder_names=ext_names,
        extended_folder_display_names=ext_display,
        extended_folder_display_names_normalized=ext_display_norm,
        matched_titles_normalized=matched,
        no_drive_folder_reason=no_drive_folder_reason,
        all_drive_folder_names=all_drive_folder_names,
        pregnant_folders=pregnant_folders,
    )


# POST /api/drive-sync/update-chapter-count
class UpdateChapterCountRequest(BaseModel):
    story_id: str
    max_chapter: int


class UpdateChapterCountResponse(BaseModel):
    success: bool
    message: str


@router.post("/update-chapter-count", response_model=UpdateChapterCountResponse, tags=["Drive Sync"])
async def update_chapter_count(body: UpdateChapterCountRequest) -> UpdateChapterCountResponse:
    """PUT maxChapter on a server story via the main BE API."""
    service = get_drive_sync_service()
    if service.get_config() is None:
        raise HTTPException(status_code=400, detail="Drive sync not configured.")
    ok = await asyncio.to_thread(service.put_story_max_chapter, body.story_id, body.max_chapter)
    if ok:
        return UpdateChapterCountResponse(success=True, message=f"maxChapter updated to {body.max_chapter}.")
    return UpdateChapterCountResponse(success=False, message="Update failed.")


# POST /api/drive-sync/update-chapters/{folder_id}
@router.post("/update-chapters/{folder_id}", response_model=JobCreateResponse, tags=["Drive Sync"])
async def update_chapters(folder_id: str) -> JobCreateResponse:
    """
    For an EXTENDED_ Drive folder, find the 'chapters-extended' subfolder,
    download new chapters, and POST them to the main BE. Runs in a background thread.
    """
    service = get_drive_sync_service()
    if service.get_config() is None:
        raise HTTPException(status_code=400, detail="Drive sync not configured.")

    folder_name = "unknown"
    try:
        folders, _ = await asyncio.to_thread(service.list_drive_folders, limit=10000, offset=0)
        for f in folders:
            if f.get("id") == folder_id:
                folder_name = f.get("name", "unknown")
                break
    except Exception:
        pass

    display_name = folder_name

    job = service.create_job(
        kind="update_single",
        folder_id=folder_id,
        folder_name=folder_name,
        display_name=display_name,
    )

    import threading

    def run_update():
        service.sync_update_as_job(job.id)

    thread = threading.Thread(target=run_update, daemon=True)
    thread.start()

    return JobCreateResponse(
        id=job.id,
        status=job.status,
        message=f"Update job enqueued. Will update chapters for '{display_name}' shortly.",
    )
