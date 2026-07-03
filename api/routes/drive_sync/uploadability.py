"""Uploadability check and chapter update endpoints for drive sync."""

import asyncio
import logging
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from api.models.drive_sync import JobCreateRequest, JobCreateResponse, JobKind
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


async def _load_drive_folders_and_server_stories(service) -> tuple[list[dict], list[dict]]:
    """Fetch Drive folders and server stories concurrently for check endpoints."""
    drive_result, server_stories = await asyncio.gather(
        asyncio.to_thread(service.list_drive_folders, limit=10000, offset=0),
        asyncio.to_thread(service.get_all_server_stories),
    )
    drive_folders_raw, _ = drive_result
    return drive_folders_raw, server_stories


async def _get_last_update_times(service, names: list[str]) -> dict[str, Optional[str]]:
    """Read persisted last-update timestamps once per distinct display name."""
    unique_names = sorted({name for name in names if name})
    if not unique_names:
        return {}

    def _load() -> dict[str, Optional[str]]:
        names_by_lower = {name.lower(): name for name in unique_names}
        latest_by_lower: dict[str, Optional[str]] = {name.lower(): None for name in unique_names}
        for job in service._load_jobs_raw():
            if job.kind != "update_single" or job.status != "success" or job.finished_at is None:
                continue
            key = job.display_name.lower()
            if key not in latest_by_lower:
                continue
            latest = latest_by_lower[key]
            if latest is None or job.finished_at > latest:
                latest_by_lower[key] = job.finished_at
        return {original: latest_by_lower[lower] for lower, original in names_by_lower.items()}

    return await asyncio.to_thread(_load)


def _run_chapter_batch_check(service, folder_ids: list[str]):
    if not folder_ids:
        return service._batch_check_duplicates_and_count_extended(
            None,
            [],
        )
    drive_service = service._build_drive_service()
    return service._batch_check_duplicates_and_count_extended(
        drive_service,
        folder_ids,
    )


def _run_free_tag_batch_check(service, folder_ids: list[str]):
    if not folder_ids:
        return ({}, {})
    drive_service = service._build_drive_service()
    return service._batch_get_free_and_tag_counts(drive_service, folder_ids)


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
    Cross-reference Drive DONE_ folders with the main BE's
    story list. Returns which Drive folders are not yet on the server (uploadable).
    """
    service = get_drive_sync_service()
    if service.get_config() is None:
        raise HTTPException(status_code=400, detail="Drive sync not configured.")

    try:
        drive_folders_raw, server_stories = await _load_drive_folders_and_server_stories(service)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    uploadable_prefixes = {"DONE"}
    candidate_folders = [f for f in drive_folders_raw if f.get("prefix") in uploadable_prefixes]
    server_titles = {_normalize(s["title"]) for s in server_stories}

    uploadable = []
    already_on_server = []
    invalid = []
    validation_candidates: list[dict] = []

    for folder in candidate_folders:
        is_valid, raw_token, recognized = _is_valid_upload_format(folder.get("name", ""))
        folder["is_valid_format"] = is_valid
        folder["source_token"] = recognized
        folder["validation_errors"] = []
        entry = DriveFolderEntry(**folder)
        title_lower = _normalize(folder.get("display_name", ""))

        if title_lower in server_titles:
            already_on_server.append(entry)
            continue

        if not is_valid:
            if raw_token:
                folder["validation_errors"].append(
                    f"UNRECOGNIZED SOURCE: '{raw_token}' - upload folders must be named "
                    "DONE_{status}_{source} - {title}; use _nw, _gd, _wp, or _ink."
                )
            else:
                folder["validation_errors"].append(
                    "MISSING SOURCE - upload folders must be named DONE_{status}_{source} - {title}; "
                    "source must be _nw, _gd, _wp, or _ink."
                )
            invalid.append(DriveFolderEntry(**folder))
            continue

        validation_candidates.append(folder)

    candidate_ids = [f["id"] for f in validation_candidates]
    dup_check_results, ext_count_by_folder_id, chapter_count_by_folder_id, first_chapter_by_id, format_errors, sequential_errors, _ = await asyncio.to_thread(
        _run_chapter_batch_check,
        service,
        candidate_ids,
    )

    for folder in validation_candidates:
        folder["chapter_count"] = chapter_count_by_folder_id.get(folder["id"])
        folder["extended_chapter_count"] = ext_count_by_folder_id.get(folder["id"])
        entry = DriveFolderEntry(**folder)

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
        drive_folders_raw, server_stories = await _load_drive_folders_and_server_stories(service)
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

    matched_extended_folders = [
        f for f in extended_folders
        if _normalize(f.get("display_name", "")) in server_by_title
    ]
    no_server_match = []
    for folder in extended_folders:
        if _normalize(folder.get("display_name", "")) not in server_by_title:
            try:
                no_server_match.append(DriveFolderEntry(**folder))
            except Exception as exc:
                logger.warning("Skipping malformed drive folder: %s", exc)

    extended_titles_lower = {_normalize(f.get("display_name", "")) for f in extended_folders}
    no_drive_title_keys: list[str] = []
    seen_no_drive_titles: set[str] = set()
    for folder in drive_folders_raw:
        title_lower = _normalize(folder.get("display_name", ""))
        if (
            not title_lower
            or folder.get("prefix") == "EXTENDED"
            or title_lower in extended_titles_lower
            or title_lower not in server_by_title
            or title_lower in seen_no_drive_titles
        ):
            continue
        seen_no_drive_titles.add(title_lower)
        no_drive_title_keys.append(title_lower)

    extended_ids = [f["id"] for f in matched_extended_folders]

    try:
        chapter_check_result = await asyncio.to_thread(
            _run_chapter_batch_check,
            service,
            extended_ids,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Batch chapter check failed: {exc}")

    if isinstance(chapter_check_result, Exception):
        raise HTTPException(status_code=500, detail=f"Batch chapter check failed: {chapter_check_result}")
    dup_check_results, ext_count_by_folder_id, _, _, format_errors, _, ext_indices = chapter_check_result

    last_updated_by_name = await _get_last_update_times(
        service,
        [f.get("display_name", "") for f in matched_extended_folders]
        + [server_by_title[title].title for title in no_drive_title_keys],
    )
    no_drive_folder = [
        ServerOnlyStoryEntry(
            server_story=server_by_title[title],
            last_updated=last_updated_by_name.get(server_by_title[title].title),
        )
        for title in no_drive_title_keys
    ]

    updatable = []
    updatable_folder_ids: list[str] = []
    no_update_needed = []
    invalid = []
    empty_extended = []
    pending_updatable: list[tuple[dict, DriveFolderEntry, ServerStoryRef, list[int], str | None]] = []
    for folder in matched_extended_folders:
        folder_id = folder["id"]
        folder["extended_chapter_count"] = ext_count_by_folder_id.get(folder_id, 0)
        try:
            entry = DriveFolderEntry(**folder)
        except Exception as exc:
            logger.warning("Skipping malformed drive folder: %s", exc)
            continue
        title_lower = _normalize(folder.get("display_name", ""))
        server_story = server_by_title[title_lower]

        display_name = folder.get("display_name", "")
        last_updated = last_updated_by_name.get(display_name)

        has_duplicates, dupes = dup_check_results.get(folder_id, (False, []))
        if has_duplicates:
            entry.has_chapter_duplicates = True
            for d in dupes:
                entry.validation_errors.append(f"DUPLICATE CHAPTER: {d}")
            invalid.append(UpdatableStoryEntry(
                folder=entry, server_story=server_story, free_chapters_count=None, tags=None,
                has_free_md=False,
                has_tags_md=False, last_updated=last_updated,
            ))
            continue

        bad_filenames = format_errors.get(folder_id, [])
        if bad_filenames:
            for name in bad_filenames[:3]:
                entry.validation_errors.append(f"WRONG CHAPTER FORMAT: {name}")
            invalid.append(UpdatableStoryEntry(
                folder=entry, server_story=server_story, free_chapters_count=None, tags=None,
                has_free_md=False,
                has_tags_md=False, last_updated=last_updated,
            ))
            continue

        drive_chapters = folder.get("extended_chapter_count") or 0
        if drive_chapters == 0:
            empty_extended.append(entry)
            continue

        new_entries = [(idx, fname) for idx, fname in ext_indices.get(folder_id, []) if idx > server_story.maxChapter]

        free_chapters_count: Optional[int] = None
        tags: Optional[list[str]] = None

        if not new_entries:
            no_update_needed.append(UpdatableStoryEntry(
                folder=entry, server_story=server_story, free_chapters_count=free_chapters_count,
                tags=tags, has_free_md=False, has_tags_md=False, last_updated=last_updated,
            ))
            continue

        rewritten_files = [fname for idx, fname in new_entries if "rewritten" in fname.lower()]
        if rewritten_files:
            entry.validation_errors.append(
                f"CHAPTERS_REWRITTEN: Chapters contain rewritten files: {', '.join(rewritten_files[:3])}"
            )
            invalid.append(UpdatableStoryEntry(
                folder=entry, server_story=server_story, free_chapters_count=free_chapters_count,
                tags=tags, has_free_md=False, has_tags_md=False, last_updated=last_updated,
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
                tags=tags, has_free_md=False, has_tags_md=False, last_updated=last_updated,
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
                tags=tags, has_free_md=False, has_tags_md=False, last_updated=last_updated,
            ))
            continue

        pending_updatable.append((folder, entry, server_story, new_indices, last_updated))
        updatable_folder_ids.append(folder_id)

    try:
        has_free_by_folder, has_tags_by_folder = await asyncio.to_thread(_run_free_tag_batch_check, service, updatable_folder_ids)
    except Exception:
        has_free_by_folder = {fid: False for fid in updatable_folder_ids}
        has_tags_by_folder = {fid: False for fid in updatable_folder_ids}

    for folder, entry, server_story, new_indices, last_updated in pending_updatable:
        folder_id = folder["id"]
        updatable.append(UpdatableStoryEntry(
            folder=entry, server_story=server_story, new_chapters_count=len(new_indices),
            free_chapters_count=None, tags=None,
            has_free_md=has_free_by_folder.get(folder_id, False),
            has_tags_md=has_tags_by_folder.get(folder_id, False), last_updated=last_updated,
        ))

    return CheckUpdatableResponse(
        all_extended_folders=extended_folders,
        server_stories=[ServerStoryRef(**s) for s in server_stories],
        updatable=updatable,
        no_update_needed=no_update_needed,
        no_server_match=no_server_match,
        empty_extended=empty_extended,
        invalid=invalid,
        no_drive_folder=no_drive_folder,
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
        raw_result, server_stories, drive_result = await asyncio.gather(
            asyncio.to_thread(service.get_stories_needing_update),
            asyncio.to_thread(service.get_all_server_stories),
            asyncio.to_thread(service.list_drive_folders, limit=10000, offset=0),
        )
        drive_folders_raw, _ = drive_result
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

    matched_extended_folders = [
        f for f in drive_folders_raw
        if f.get("prefix") == "EXTENDED" and _normalize(f.get("display_name", "")) in reader_titles_lower
    ]

    if not matched_extended_folders:
        # Still detect no_drive_folder by comparing all reader titles against all EXTENDED_ folders
        extended_display_names_lower = {_normalize(f.get("display_name", "")) for f in drive_folders_raw if f.get("prefix") == "EXTENDED"}
        no_drive_folder: list[ServerOnlyStoryEntry] = []
        last_updated_by_title = await _get_last_update_times(
            service,
            [s.get("title", "") for s in reader_stories],
        )
        for s in reader_stories:
            title = _normalize(s.get("title", ""))
            if title and title not in extended_display_names_lower:
                server_ref = server_by_title.get(title)
                if server_ref:
                    last_updated = last_updated_by_title.get(server_ref.title)
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

    try:
        chapter_check_task = asyncio.to_thread(
            _run_chapter_batch_check,
            service,
            matched_ids,
        )
        free_tag_task = asyncio.to_thread(_run_free_tag_batch_check, service, matched_ids)
        chapter_check_result, free_tag_result = await asyncio.gather(chapter_check_task, free_tag_task, return_exceptions=True)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Batch chapter check failed: {exc}")

    if isinstance(chapter_check_result, Exception):
        raise HTTPException(status_code=500, detail=f"Batch chapter check failed: {chapter_check_result}")
    dup_check_results, ext_count_by_folder_id, _, _, format_errors, _, ext_indices = chapter_check_result

    if isinstance(free_tag_result, Exception):
        has_free_by_folder = {fid: False for fid in matched_ids}
        has_tags_by_folder = {fid: False for fid in matched_ids}
    else:
        has_free_by_folder, has_tags_by_folder = free_tag_result

    last_updated_by_name = await _get_last_update_times(
        service,
        [f.get("display_name", "") for f in matched_extended_folders]
        + [s.get("title", "") for s in reader_stories],
    )

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
        last_updated = last_updated_by_name.get(display_name)

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
                last_updated = last_updated_by_name.get(server_ref.title)
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

    job, created = service.create_job_once(
        kind="update_single",
        folder_id=folder_id,
        folder_name=folder_name,
        display_name=display_name,
    )

    import threading

    def run_update():
        service.sync_update_as_job(job.id)

    if created:
        thread = threading.Thread(target=run_update, daemon=True)
        thread.start()

    return JobCreateResponse(
        id=job.id,
        status=job.status,
        message=(
            f"Update job enqueued. Will update chapters for '{display_name}' shortly."
            if created
            else f"Update job already running for '{display_name}'."
        ),
    )


class ContentUpdateStoryRef(BaseModel):
    id: str
    title: str
    maxChapter: int = 0


class ContentUpdateSearchResponse(BaseModel):
    found: bool
    exact_match: Optional[ContentUpdateStoryRef] = None
    stories: list[ContentUpdateStoryRef] = []
    message: str


class ContentUpdateSummary(BaseModel):
    total: int = 0
    same: int = 0
    different: int = 0
    missingDrive: int = 0
    driveOnly: int = 0
    errors: int = 0


class ContentUpdateFolderRef(BaseModel):
    id: str
    name: str
    prefix: str
    display_name: str
    is_completed: bool = True
    chapter_count: Optional[int] = None
    extended_chapter_count: Optional[int] = None
    modified_time: Optional[str] = None


class ContentUpdateChapterStatus(BaseModel):
    chapterNumber: int
    title: str = ""
    status: str
    fileName: Optional[str] = None
    serverLength: int = 0
    driveLength: int = 0
    message: Optional[str] = None


class ContentUpdateScanResponse(BaseModel):
    found: bool = True
    story: Optional[ContentUpdateStoryRef] = None
    folder: Optional[ContentUpdateFolderRef] = None
    chapters: list[ContentUpdateChapterStatus] = []
    summary: ContentUpdateSummary
    message: str


class ContentUpdateChapterRequest(BaseModel):
    story_id: str
    folder_id: str
    chapter_number: int


class ContentUpdateChapterResponse(BaseModel):
    success: bool
    message: str
    chapter: Optional[ContentUpdateChapterStatus] = None


@router.get("/content-update/search", response_model=ContentUpdateSearchResponse, tags=["Drive Sync"])
async def search_content_update_story(keyword: str) -> ContentUpdateSearchResponse:
    """Search stories on the configured main BE for chapter content replacement."""
    service = get_drive_sync_service()
    if service.get_config() is None:
        raise HTTPException(status_code=400, detail="Drive sync not configured.")

    keyword = keyword.strip()
    if not keyword:
        return ContentUpdateSearchResponse(found=False, stories=[], message="Enter a story title.")

    try:
        stories_raw = await asyncio.to_thread(service.search_server_stories, keyword)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Story search failed: {exc}")

    stories = [ContentUpdateStoryRef(**story) for story in stories_raw]
    target = service._normalize_story_title(keyword)
    exact = next((story for story in stories if service._normalize_story_title(story.title) == target), None)
    return ContentUpdateSearchResponse(
        found=exact is not None,
        exact_match=exact,
        stories=stories,
        message="Story found." if exact else "No exact story title match found.",
    )


@router.get("/content-update/folder", response_model=ContentUpdateScanResponse, tags=["Drive Sync"])
async def inspect_content_update_folder(folder_name: str) -> ContentUpdateScanResponse:
    """Resolve a pasted Drive folder name, matching server story, and list Drive chapter files."""
    service = get_drive_sync_service()
    if service.get_config() is None:
        raise HTTPException(status_code=400, detail="Drive sync not configured.")

    folder_name = folder_name.strip()
    if not folder_name:
        raise HTTPException(status_code=400, detail="Folder name is required.")

    try:
        result = await asyncio.to_thread(service.inspect_drive_folder_for_content_update, folder_name)
        return ContentUpdateScanResponse(**result)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Folder check failed: {exc}")


@router.get("/content-update/scan/{story_id}", response_model=ContentUpdateScanResponse, tags=["Drive Sync"])
async def scan_content_update_story(story_id: str) -> ContentUpdateScanResponse:
    """Compare server chapter content with matching Drive chapters-extended files."""
    service = get_drive_sync_service()
    if service.get_config() is None:
        raise HTTPException(status_code=400, detail="Drive sync not configured.")

    try:
        scan = await asyncio.to_thread(service.scan_server_story_against_drive, story_id)
        return ContentUpdateScanResponse(**scan)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Update scan failed: {exc}")


@router.post("/content-update/update-chapter", response_model=ContentUpdateChapterResponse, tags=["Drive Sync"])
async def update_content_chapter(body: ContentUpdateChapterRequest) -> ContentUpdateChapterResponse:
    """Replace one server chapter's index/title/content/plainContent from Drive."""
    service = get_drive_sync_service()
    config = service.get_config()
    if config is None:
        raise HTTPException(status_code=400, detail="Drive sync not configured.")

    try:
        updated = await asyncio.to_thread(
            service.update_server_chapter_from_drive,
            body.story_id,
            body.chapter_number,
            body.folder_id,
        )
        chapter = ContentUpdateChapterStatus(
            chapterNumber=body.chapter_number,
            title=updated.get("title") or "",
            status="updated",
            fileName=updated.get("fileName"),
            serverLength=updated.get("plainLength") or 0,
            driveLength=updated.get("plainLength") or 0,
            message="Updated from Drive.",
        )
        story_title = str(updated.get("storyTitle") or body.story_id)
        folder_name = str(updated.get("folderName") or body.folder_id)
        timestamp = datetime.now(timezone.utc).isoformat()
        await asyncio.to_thread(
            service.record_completed_job,
            kind=JobKind.CHAPTER_CONTENT_UPDATE,
            folder_id=body.folder_id,
            folder_name=folder_name,
            display_name=f"{story_title} - Chapter {body.chapter_number}",
            result_message=f"Chapter {body.chapter_number} content updated from Drive.",
            logs=[
                {
                    "timestamp": timestamp,
                    "level": "info",
                    "message": f"Story: {story_title}",
                },
                {
                    "timestamp": timestamp,
                    "level": "info",
                    "message": f"Drive folder: {folder_name}",
                },
                {
                    "timestamp": timestamp,
                    "level": "info",
                    "message": f"Chapter {body.chapter_number}: {chapter.title or updated.get('fileName') or 'Untitled'} updated from Drive.",
                },
            ],
            chapters_added=1,
            chapters_skipped=0,
            main_be_api_base_url=config.main_be_api_base_url,
        )
        return ContentUpdateChapterResponse(success=True, message=f"Chapter {body.chapter_number} updated.", chapter=chapter)
    except RuntimeError as exc:
        return ContentUpdateChapterResponse(success=False, message=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Chapter update failed: {exc}")


# ---------------------------------------------------------------------------
# Batch content update models
# ---------------------------------------------------------------------------

class BatchChapterUpdateResult(BaseModel):
    chapter_number: int
    success: bool
    message: str


class BatchFolderResult(BaseModel):
    folder_name: str
    found: bool
    story: Optional[ContentUpdateStoryRef] = None
    folder: Optional[ContentUpdateFolderRef] = None
    chapters: list[ContentUpdateChapterStatus] = []
    summary: ContentUpdateSummary
    message: str
    update_results: list[BatchChapterUpdateResult] = []
    stopped_at: Optional[int] = None
    stop_reason: Optional[str] = None


class BatchContentUpdateRequest(BaseModel):
    folder_names: list[str]


class BatchContentUpdateResponse(BaseModel):
    results: list[BatchFolderResult]


@router.post("/content-update/batch-inspect", response_model=BatchContentUpdateResponse, tags=["Drive Sync"])
async def batch_inspect_content_folders(body: BatchContentUpdateRequest) -> BatchContentUpdateResponse:
    """Inspect multiple Drive folders for content update without making changes."""
    service = get_drive_sync_service()
    config = service.get_config()
    if config is None:
        raise HTTPException(status_code=400, detail="Drive sync not configured.")

    folder_names = [name.strip() for name in body.folder_names if name.strip()]
    if not folder_names:
        raise HTTPException(status_code=400, detail="No folder names provided.")

    try:
        results = await asyncio.to_thread(service.batch_inspect_folders, folder_names)
        return BatchContentUpdateResponse(**results)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Batch inspect failed: {exc}")


@router.post("/content-update/batch-update", response_model=BatchContentUpdateResponse, tags=["Drive Sync"])
async def batch_update_content_folders(body: BatchContentUpdateRequest) -> BatchContentUpdateResponse:
    """Update all ready chapters for multiple Drive folders in batch."""
    service = get_drive_sync_service()
    config = service.get_config()
    if config is None:
        raise HTTPException(status_code=400, detail="Drive sync not configured.")

    folder_names = [name.strip() for name in body.folder_names if name.strip()]
    if not folder_names:
        raise HTTPException(status_code=400, detail="No folder names provided.")

    try:
        results = await asyncio.to_thread(service.batch_update_folders_content, folder_names)
        return BatchContentUpdateResponse(**results)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Batch update failed: {exc}")
