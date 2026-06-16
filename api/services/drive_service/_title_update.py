"""TitleUpdateMixin — chapter-title update logic for DriveSyncService.

Compares each chapter's Drive title (parsed from the .md filename) against the
server chapter title on the configured main BE, and lets callers push only the
title back to the server.

Two-tier design for the check-all / detail flow:
  - `check_extended_folders_for_title_update()` (summary) returns per-folder
    counts only — no per-chapter list. Fast enough to populate the folder list
    without blocking the user. Per-chapter data is loaded on demand when the
    user clicks a folder, via `get_title_update_detail_for_folder()`.
  - `get_title_update_detail_for_folder()` (full) returns the per-chapter
    comparison for a single folder.

Performance optimizations:
  - Single BE call per story: get_server_chapter_data() returns both chapter
    numbers and titles in one request, eliminating the prior duplicate call.
  - Parallel folder processing: ThreadPoolExecutor(8 workers), each thread gets
    its own Drive service via _build_drive_service() (already per-thread via
    self._tls) and the BE HTTP client (also per-thread via self._main_be_tls).
  - Result caching: summary check_all caches the response for 30s, so repeated
    calls during that window are instant.
"""

from __future__ import annotations

import html
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import TYPE_CHECKING, Any, Optional

if TYPE_CHECKING:
    pass


_TITLE_UPDATE_FOLDER_PREFIXES = {"DONE", "EXTENDED"}

# Workers for parallel folder scanning during check_all
# Bounded to be safe with the Drive semaphore (_DRIVE_CALL_CONCURRENCY=6) and
# the BE HTTP client (each thread has its own connection pool).
_FOLDER_CHECK_WORKERS = 8

# Result cache TTL (seconds). Repeat calls within this window are served from cache.
_CHECK_ALL_CACHE_TTL = 30.0


def _is_title_update_folder(folder: dict) -> bool:
    return folder.get("prefix") in _TITLE_UPDATE_FOLDER_PREFIXES


def _chapter_title_from_filename(filename: str) -> str:
    """Extract the chapter title from a filename like 'Chapter 1 - Title.md'."""
    stem = Path(filename).stem
    title = re.sub(
        r"^Chapter\s+\d+(?:-\d+)?\s*[-_]?\s*",
        "",
        stem,
        flags=re.IGNORECASE,
    ).strip()
    title = title.replace("_", " ").strip()
    if not title:
        title = stem.replace("_", " ").strip()
    return title


def _normalize_title_for_compare(title: str) -> str:
    """Lowercase, unescape, collapse whitespace, and strip for comparison."""
    if not title:
        return ""
    value = html.unescape(title or "")
    value = re.sub(r"\s+", " ", value).strip().lower()
    return value


class TitleUpdateMixin:
    """Add chapter-title check + update logic to DriveSyncService."""

    def __init__(self) -> None:
        super().__init__()
        # Instance-level cache: (timestamp, result_dict). Thread-safe via _cache_lock.
        self._check_all_cache: Optional[tuple[float, dict]] = None
        self._check_all_cache_lock = threading.Lock()

    def _list_chapters_extended_filenames(
        self, drive_service: Any, parent_folder_id: str
    ) -> list[dict]:
        """List chapter .md files inside a story folder's chapters-extended subfolder.

        Returns a list of file dicts ordered by chapter number ascending.
        """
        chapters_ext = self._find_chapters_extended_folder(drive_service, parent_folder_id)
        if not chapters_ext:
            return []
        files = self._list_files_in_folder(drive_service, chapters_ext["id"])
        md_files = [f for f in files if (f.get("name", "") or "").lower().endswith(".md")]
        return sorted(
            md_files,
            key=lambda f: self._extract_chapter_index(f.get("name", "")) or 0,
        )

    def _classify_chapter_titles(
        self,
        server_numbers: list[int],
        drive_chapter_titles: dict[int, dict],
        server_titles: dict[int, str],
    ) -> dict:
        """Compare drive vs server titles using pre-fetched server_titles dict.

        server_titles: {chapter_number: title} from get_server_chapter_data().
        drive_chapter_titles: {chapter_number: {file_name, drive_title}}

        Returns a dict with "chapters" + summary counts.
        """
        chapters: list[dict] = []
        matched = 0
        can_update = 0
        missing_drive = 0
        errors = 0

        for chapter_number in server_numbers:
            drive_info = drive_chapter_titles.get(chapter_number)
            if drive_info is None:
                missing_drive += 1
                chapters.append({
                    "chapter_number": chapter_number,
                    "file_name": None,
                    "drive_title": "",
                    "server_title": None,
                    "status": "missing_drive",
                    "message": "No matching Drive chapter file.",
                })
                continue

            drive_title = drive_info.get("drive_title", "")
            server_title = server_titles.get(chapter_number, "")

            same = (
                _normalize_title_for_compare(drive_title)
                == _normalize_title_for_compare(server_title)
            )
            if same:
                matched += 1
                chapters.append({
                    "chapter_number": chapter_number,
                    "file_name": drive_info.get("file_name"),
                    "drive_title": drive_title,
                    "server_title": server_title,
                    "status": "matched",
                    "message": None,
                })
            else:
                can_update += 1
                chapters.append({
                    "chapter_number": chapter_number,
                    "file_name": drive_info.get("file_name"),
                    "drive_title": drive_title,
                    "server_title": server_title,
                    "status": "can_update_title",
                    "message": None,
                })

        drive_only = 0
        server_set = set(server_numbers)
        for chapter_number, drive_info in sorted(drive_chapter_titles.items()):
            if chapter_number in server_set:
                continue
            drive_only += 1
            chapters.append({
                "chapter_number": chapter_number,
                "file_name": drive_info.get("file_name"),
                "drive_title": drive_info.get("drive_title", ""),
                "server_title": None,
                "status": "drive_only",
                "message": "Drive chapter has no matching server chapter.",
            })

        chapters.sort(key=lambda item: item.get("chapter_number", 0))
        return {
            "chapters": chapters,
            "matched": matched,
            "can_update": can_update,
            "missing_drive": missing_drive,
            "drive_only": drive_only,
            "errors": errors,
        }

    def _build_title_update_entry(
        self,
        folder: dict,
        story: Optional[dict],
        classification: Optional[dict],
        folder_status: str,
    ) -> dict:
        """Build a flat TitleFolderEntry-shaped dict."""
        folder_id = folder.get("id", "")
        folder_name = folder.get("name", "")
        display_name = folder.get("display_name", "") or folder_name
        story_id = (story or {}).get("id")
        story_title = (story or {}).get("title") or display_name
        classification = classification or {
            "chapters": [],
            "matched": 0,
            "can_update": 0,
            "missing_drive": 0,
            "drive_only": 0,
            "errors": 0,
        }
        return {
            "story_id": story_id,
            "story_title": story_title,
            "folder_id": folder_id,
            "folder_name": folder_name,
            "folder_status": folder_status,
            "matched_count": classification["matched"],
            "can_update_count": classification["can_update"],
            "missing_drive_count": classification["missing_drive"],
            "drive_only_count": classification["drive_only"],
            "error_count": classification["errors"],
            "chapters": classification["chapters"],
        }

    def _check_one_folder(
        self,
        folder: dict,
        server_by_title: dict[str, dict],
    ) -> tuple[dict, str]:
        """Check one folder's title-update status with full per-chapter data.

        Returns (entry, bucket_key) where entry has populated `chapters` array.
        Used by the detail endpoint. The summary check-all uses _check_one_folder_summary
        which is faster because it skips building the per-chapter dicts.
        """
        display_name = folder.get("display_name", "") or folder.get("name", "")
        story = server_by_title.get(self._normalize_story_title(display_name))

        if story is None:
            entry = self._build_title_update_entry(
                folder, None, None, folder_status="no_server_match"
            )
            return (entry, "no_server_match")

        drive_service = self._build_drive_service()
        file_dicts = self._list_chapters_extended_filenames(drive_service, folder["id"])
        if not file_dicts:
            entry = self._build_title_update_entry(
                folder, story, None, folder_status="empty_chapters"
            )
            return (entry, "empty_chapters")

        drive_chapter_titles: dict[int, dict] = {}
        for f in file_dicts:
            name = f.get("name", "")
            idx = self._extract_chapter_index(name)
            if idx is None:
                continue
            drive_chapter_titles[idx] = {
                "file_name": name,
                "drive_title": _chapter_title_from_filename(name),
            }

        story_id = story["id"]

        try:
            chapter_data = self.get_server_chapter_data(
                story_id, story.get("maxChapter") or 0
            )
            server_numbers = chapter_data["numbers"]
            server_titles = chapter_data["titles"]
        except Exception as exc:
            entry = self._build_title_update_entry(
                folder, story, None, folder_status="empty_chapters"
            )
            entry["error_count"] = 1
            entry["chapters"] = [{
                "chapter_number": 0,
                "file_name": None,
                "drive_title": "",
                "server_title": None,
                "status": "error",
                "message": str(exc),
            }]
            return (entry, "empty_chapters")

        classification = self._classify_chapter_titles(
            server_numbers, drive_chapter_titles, server_titles
        )

        folder_status = self._classify_folder_status(classification)
        entry = self._build_title_update_entry(
            folder, story, classification, folder_status
        )
        bucket = (
            folder_status
            if folder_status in ("can_update", "all_match")
            else "empty_chapters"
        )
        return (entry, bucket)

    @staticmethod
    def _classify_folder_status(classification: dict) -> str:
        """Map a classification dict to a folder_status string."""
        if classification["can_update"] > 0:
            return "can_update"
        if (
            classification["matched"] > 0
            and classification["can_update"] == 0
            and classification["drive_only"] == 0
            and classification["missing_drive"] == 0
            and classification["errors"] == 0
        ):
            return "all_match"
        return "empty_chapters"

    def _check_one_folder_summary(
        self,
        folder: dict,
        server_by_title: dict[str, dict],
    ) -> tuple[dict, str]:
        """Count-only check: returns (entry, bucket_key) with empty `chapters`.

        Faster than _check_one_folder for the check-all endpoint:
          - No per-chapter dict allocation (skips building TitleChapterEntry lists)
          - Skips `_classify_chapter_titles` which builds a list of 50+ dicts per folder
        Same Drive + BE calls; counts are still accurate for the update button.
        """
        display_name = folder.get("display_name", "") or folder.get("name", "")
        story = server_by_title.get(self._normalize_story_title(display_name))

        if story is None:
            entry = self._build_title_update_entry(
                folder, None, None, folder_status="no_server_match"
            )
            entry["chapters"] = []
            return (entry, "no_server_match")

        drive_service = self._build_drive_service()
        file_dicts = self._list_chapters_extended_filenames(drive_service, folder["id"])
        if not file_dicts:
            entry = self._build_title_update_entry(
                folder, story, None, folder_status="empty_chapters"
            )
            entry["chapters"] = []
            return (entry, "empty_chapters")

        # Build a lightweight {chapter_number: drive_title} map (no file_name, no
        # full info dict). This is enough for the comparison loop below.
        drive_title_by_chapter: dict[int, str] = {}
        for f in file_dicts:
            name = f.get("name", "")
            idx = self._extract_chapter_index(name)
            if idx is None:
                continue
            drive_title_by_chapter[idx] = _chapter_title_from_filename(name)

        story_id = story["id"]

        try:
            chapter_data = self.get_server_chapter_data(
                story_id, story.get("maxChapter") or 0
            )
            server_numbers = chapter_data["numbers"]
            server_titles = chapter_data["titles"]
        except Exception as exc:
            entry = self._build_title_update_entry(
                folder, story, None, folder_status="empty_chapters"
            )
            entry["error_count"] = 1
            entry["chapters"] = []
            return (entry, "empty_chapters")

        # Count-only loop — no per-chapter dict allocation.
        matched = 0
        can_update = 0
        missing_drive = 0
        drive_only = len([n for n in drive_title_by_chapter if n not in set(server_numbers)])

        server_set = set(server_numbers)
        for chapter_number in server_numbers:
            drive_title = drive_title_by_chapter.get(chapter_number)
            if drive_title is None:
                missing_drive += 1
                continue
            server_title = server_titles.get(chapter_number, "")
            if (
                _normalize_title_for_compare(drive_title)
                == _normalize_title_for_compare(server_title)
            ):
                matched += 1
            else:
                can_update += 1

        classification = {
            "chapters": [],
            "matched": matched,
            "can_update": can_update,
            "missing_drive": missing_drive,
            "drive_only": drive_only,
            "errors": 0,
        }
        folder_status = self._classify_folder_status(classification)
        entry = self._build_title_update_entry(
            folder, story, classification, folder_status
        )
        bucket = (
            folder_status
            if folder_status in ("can_update", "all_match")
            else "empty_chapters"
        )
        return (entry, bucket)

    def _get_check_all_cached(self) -> Optional[dict]:
        """Return cached result if still fresh, else None. Thread-safe."""
        with self._check_all_cache_lock:
            cached = self._check_all_cache
            if cached is None:
                return None
            ts, data = cached
            if time.time() - ts < _CHECK_ALL_CACHE_TTL:
                return data
            return None

    def _set_check_all_cached(self, result: dict) -> None:
        """Store result in cache. Thread-safe."""
        with self._check_all_cache_lock:
            self._check_all_cache = (time.time(), result)

    def invalidate_check_all_cache(self) -> None:
        """Clear the cache (call after any write operation that would change results)."""
        with self._check_all_cache_lock:
            self._check_all_cache = None

    def check_extended_folders_for_title_update(self) -> dict:
        """Scan all DONE_/EXTENDED_ folders and return per-folder summary counts.

        Returns entries with summary counts only — `chapters` is always an empty
        list. This makes check-all fast (no per-chapter dict allocation) and
        suitable for populating the folder list. To get per-chapter details for
        a specific folder, call get_title_update_detail_for_folder(folder_id).

        Performance:
          - Single BE call per story (chapter numbers + titles together)
          - Parallel folder processing (8 workers, each with own Drive service)
          - Count-only loop (no per-chapter dict allocation)
          - 30s result cache (subsequent calls within window are instant)

        Returns a dict with four buckets: can_update, all_match, no_server_match,
        empty_chapters. Each entry's `chapters` field is always [].
        """
        if self._config is None:
            raise RuntimeError("Drive sync config not set.")

        # Cache hit — return immediately. Don't lock during the long work.
        cached = self._get_check_all_cached()
        if cached is not None:
            return cached

        drive_folders_raw, _ = self.list_drive_folders(limit=10000, offset=0)
        title_update_folders = [f for f in drive_folders_raw if _is_title_update_folder(f)]

        server_stories = self.get_all_server_stories()
        server_by_title = {
            self._normalize_story_title(s.get("title", "")): s
            for s in server_stories
            if s.get("title")
        }

        can_update: list[dict] = []
        all_match: list[dict] = []
        no_server_match: list[dict] = []
        empty_chapters: list[dict] = []

        with ThreadPoolExecutor(max_workers=_FOLDER_CHECK_WORKERS) as executor:
            futures = {
                executor.submit(
                    self._check_one_folder_summary,
                    folder,
                    server_by_title,
                ): folder
                for folder in title_update_folders
            }
            for future in as_completed(futures):
                try:
                    entry, bucket = future.result()
                except Exception as exc:
                    folder = futures[future]
                    entry = self._build_title_update_entry(
                        folder, None, None, folder_status="empty_chapters"
                    )
                    entry["error_count"] = 1
                    entry["chapters"] = []
                    bucket = "empty_chapters"

                if bucket == "can_update":
                    can_update.append(entry)
                elif bucket == "all_match":
                    all_match.append(entry)
                elif bucket == "no_server_match":
                    no_server_match.append(entry)
                else:
                    empty_chapters.append(entry)

        result = {
            "can_update": can_update,
            "all_match": all_match,
            "no_server_match": no_server_match,
            "empty_chapters": empty_chapters,
        }
        self._set_check_all_cached(result)
        return result

    def get_title_update_detail_for_folder(self, folder_id: str) -> dict:
        """Build a single-folder TitleFolderEntry for the detail panel.

        Uses single BE call (chapter numbers + titles together).
        """
        if self._config is None:
            raise RuntimeError("Drive sync config not set.")

        drive_folders_raw, _ = self.list_drive_folders(limit=10000, offset=0)
        folder = next((f for f in drive_folders_raw if f.get("id") == folder_id), None)
        if folder is None:
            raise ValueError(f"Drive folder '{folder_id}' not found.")

        display_name = folder.get("display_name", "") or folder.get("name", "")
        server_stories = self.get_all_server_stories()
        story = next(
            (
                s
                for s in server_stories
                if self._normalize_story_title(s.get("title", ""))
                == self._normalize_story_title(display_name)
            ),
            None,
        )

        if story is None:
            return self._build_title_update_entry(
                folder, None, None, folder_status="no_server_match"
            )

        drive_service = self._build_drive_service()
        file_dicts = self._list_chapters_extended_filenames(drive_service, folder_id)
        if not file_dicts:
            return self._build_title_update_entry(
                folder, story, None, folder_status="empty_chapters"
            )

        drive_chapter_titles: dict[int, dict] = {}
        for f in file_dicts:
            name = f.get("name", "")
            idx = self._extract_chapter_index(name)
            if idx is None:
                continue
            drive_chapter_titles[idx] = {
                "file_name": name,
                "drive_title": _chapter_title_from_filename(name),
            }

        story_id = story["id"]
        chapter_data = self.get_server_chapter_data(
            story_id, story.get("maxChapter") or 0
        )
        server_numbers = chapter_data["numbers"]
        server_titles = chapter_data["titles"]

        classification = self._classify_chapter_titles(
            server_numbers, drive_chapter_titles, server_titles
        )

        if classification["can_update"] > 0:
            folder_status = "can_update"
        elif (
            classification["matched"] > 0
            and classification["can_update"] == 0
            and classification["drive_only"] == 0
            and classification["missing_drive"] == 0
            and classification["errors"] == 0
        ):
            folder_status = "all_match"
        else:
            folder_status = "empty_chapters"

        return self._build_title_update_entry(
            folder, story, classification, folder_status
        )

    def _resolve_chapter_title_from_folder(
        self, folder_id: str, chapter_number: int
    ) -> str:
        """Find the Drive chapter file and return its parsed title."""
        drive_service = self._build_drive_service()
        chapters_ext = self._find_chapters_extended_folder(drive_service, folder_id)
        if not chapters_ext:
            raise RuntimeError(
                "No chapters-extended subfolder found for this Drive folder."
            )
        files = self._list_files_in_folder(drive_service, chapters_ext["id"])
        for file_info in files:
            name = file_info.get("name", "")
            if not name.lower().endswith(".md"):
                continue
            if self._extract_chapter_index(name) != chapter_number:
                continue
            return _chapter_title_from_filename(name)
        raise RuntimeError(
            f"Chapter {chapter_number} not found in chapters-extended."
        )

    def update_chapter_title_from_drive(
        self, story_id: str, folder_id: str, chapter_number: int
    ) -> dict:
        """Push the Drive title for a single chapter back to the main BE."""
        new_title = self._resolve_chapter_title_from_folder(folder_id, chapter_number)
        self.patch_server_chapter_title(story_id, chapter_number, new_title)
        self.invalidate_check_all_cache()
        return {
            "chapter_number": chapter_number,
            "new_title": new_title,
            "folder_id": folder_id,
            "story_id": story_id,
        }

    def update_folder_titles(self, story_id: str, folder_id: str) -> dict:
        """Update all can_update_title chapters in one folder. Stops on 404."""
        drive_service = self._build_drive_service()
        chapters_ext = self._find_chapters_extended_folder(drive_service, folder_id)
        if not chapters_ext:
            raise RuntimeError(
                "No chapters-extended subfolder found for this Drive folder."
            )
        files = self._list_files_in_folder(drive_service, chapters_ext["id"])
        md_files = [f for f in files if (f.get("name", "") or "").lower().endswith(".md")]

        results: list[dict] = []
        stopped_at: Optional[int] = None
        stop_reason: Optional[str] = None

        for f in sorted(
            md_files,
            key=lambda x: self._extract_chapter_index(x.get("name", "")) or 0,
        ):
            name = f.get("name", "")
            chapter_number = self._extract_chapter_index(name)
            if chapter_number is None:
                continue
            drive_title = _chapter_title_from_filename(name)
            try:
                server_detail = self.get_server_chapter_detail(story_id, chapter_number)
            except Exception as exc:
                exc_msg = str(exc)
                not_found = "404" in exc_msg or "not found" in exc_msg.lower()
                results.append({
                    "chapter_number": chapter_number,
                    "success": False,
                    "message": exc_msg,
                })
                if not_found:
                    stop_reason = exc_msg
                    stopped_at = chapter_number
                    break
                continue

            server_title = str(server_detail.get("title", "") or "")
            if (
                _normalize_title_for_compare(drive_title)
                == _normalize_title_for_compare(server_title)
            ):
                results.append({
                    "chapter_number": chapter_number,
                    "success": True,
                    "message": "Already in sync.",
                })
                continue

            try:
                self.patch_server_chapter_title(story_id, chapter_number, drive_title)
                results.append({
                    "chapter_number": chapter_number,
                    "success": True,
                    "message": f"Title updated to '{drive_title}'.",
                })
            except Exception as exc:
                exc_msg = str(exc)
                not_found = "404" in exc_msg or "not found" in exc_msg.lower()
                results.append({
                    "chapter_number": chapter_number,
                    "success": False,
                    "message": exc_msg,
                })
                if not_found:
                    stop_reason = exc_msg
                    stopped_at = chapter_number
                    break

        self.invalidate_check_all_cache()
        success_count = sum(1 for r in results if r["success"])
        failed_count = len(results) - success_count
        return {
            "results": results,
            "stopped_at": stopped_at,
            "stop_reason": stop_reason,
            "success_count": success_count,
            "failed_count": failed_count,
        }

    def _process_title_update_batch_one(self, folder_id: str) -> dict:
        """Inspect + update one folder. Returns a TitleFolderUpdateResult-shaped dict."""
        try:
            entry = self.get_title_update_detail_for_folder(folder_id)
        except Exception as exc:
            return {
                "folder_id": folder_id,
                "folder_name": folder_id,
                "story_id": None,
                "story_title": "",
                "update_results": [],
                "stopped_at": None,
                "stop_reason": str(exc),
                "success_count": 0,
                "failed_count": 0,
            }

        if not entry.get("story_id") or entry.get(
            "folder_status"
        ) not in {"can_update", "all_match"}:
            return {
                "folder_id": folder_id,
                "folder_name": entry.get("folder_name", folder_id),
                "story_id": entry.get("story_id"),
                "story_title": entry.get("story_title", ""),
                "update_results": [],
                "stopped_at": None,
                "stop_reason": (
                    entry.get("folder_status")
                    if entry.get("folder_status") != "can_update"
                    else None
                ),
                "success_count": 0,
                "failed_count": 0,
            }

        update = self.update_folder_titles(entry["story_id"], folder_id)
        return {
            "folder_id": folder_id,
            "folder_name": entry.get("folder_name", folder_id),
            "story_id": entry.get("story_id"),
            "story_title": entry.get("story_title", ""),
            "update_results": update["results"],
            "stopped_at": update["stopped_at"],
            "stop_reason": update["stop_reason"],
            "success_count": update["success_count"],
            "failed_count": update["failed_count"],
        }

    def batch_update_folders_titles(
        self, folder_ids: list[str], concurrency: int = 2
    ) -> dict:
        """Update multiple folders with bounded concurrency (default 2)."""
        if not folder_ids:
            return {"results": []}
        concurrency = max(1, int(concurrency or 2))
        with ThreadPoolExecutor(max_workers=concurrency) as executor:
            results = list(executor.map(self._process_title_update_batch_one, folder_ids))
        return {"results": results}
