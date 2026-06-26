"""HistoryJobsMixin — history CRUD, jobs CRUD, and sync orchestration for DriveSyncService."""

from __future__ import annotations

import logging
import random
import ssl
import threading
import time
import uuid
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any, Optional

if TYPE_CHECKING:
    from collections.abc import Callable
    from api.models.drive_sync import DriveSyncStatus, HistoryEntry, SyncJob

from api.services.drive_service._paths import (
    _MAX_HISTORY_ENTRIES,
    _MAX_JOBS_ENTRIES,
    _RANDOM_AUTHOR_IDS,
    _RE_STATUS_PREFIX,
)


class HistoryJobsMixin:
    """
    Mix-in providing history CRUD, jobs CRUD, sync orchestration, and folder browsing.

    Adds to DriveSyncService:
      - _load_history, _save_history, get_history, add_history_entry,
        update_history_entry, delete_history_entries, clear_history
      - _load_jobs_raw, _with_jobs_lock, create_job, get_job, list_jobs,
        update_job, append_job_log, delete_job, get_last_update_time
      - sync_all, _sync_drive_folder, _process_story_folder
      - list_drive_folders, list_drive_folders_with_counts
      - preview_story, sync_single_folder, list_all_drive_items, get_file_content
      - sync_folder_as_job, _process_story_folder_with_job
      - sync_update_as_job
    """

    # -------------------------------------------------------------------------
    # Sync orchestration
    # -------------------------------------------------------------------------

    def sync_all(self) -> "DriveSyncStatus":
        """Run a full sync: list folders from Drive, process each story, post to main BE."""
        from api.models.drive_sync import DriveSyncStatus

        if self._config is None:
            self._status.errors.append("Drive sync config not set. POST /api/drive-sync/config first.")
            self._save_status()
            return self._status

        if not self._config.enabled:
            self._append_log("info", "Drive sync is disabled. Skipping.")
            return self._status

        sync_id = str(uuid.uuid4())[:8]
        self._current_sync_id = sync_id
        self._current_log = []
        self._status = DriveSyncStatus(enabled=self._config.enabled)

        self._append_log("info", f"[{sync_id}] Starting Google Drive sync...")

        try:
            drive_service = self._build_drive_service()
        except Exception as exc:
            err = f"Failed to authenticate with Google Drive: {exc}"
            self._append_log("error", err)
            self._status.errors.append(err)
            self._save_status()
            return self._status

        try:
            self._sync_drive_folder(drive_service)
        finally:
            self._status.last_sync_at = datetime.now(timezone.utc)
            self._save_status()

        return self._status

    def _sync_drive_folder(self, drive_service: "Any") -> None:
        """Sync all DONE_/EXTENDED_ folders under the configured root folder."""
        folder_id = self._config.folder_id if self._config else ""
        self._append_log("info", f"Listing folders in Drive folder: {folder_id}")

        try:
            folders = self._list_folders(drive_service, folder_id)
        except Exception as exc:
            err = f"Google Drive API error: {exc}"
            self._append_log("error", err)
            self._status.errors.append(err)
            return

        story_folders = [
            f for f in folders if _RE_STATUS_PREFIX.match(f["name"])
        ]
        self._status.stories_found = len(story_folders)
        self._append_log("info", f"Found {len(story_folders)} story folders (DONE_/EXTENDED_/ING_/INCOMPLETE_).")

        for folder in sorted(story_folders, key=lambda f: f["name"]):
            self._process_story_folder(drive_service, folder)

    def _process_story_folder(self, drive_service: "Any", folder: dict) -> None:
        """Download chapter files from a story folder and post them chapter-by-chapter."""
        folder_id = folder["id"]
        folder_name = folder["name"]
        self._append_log("info", f"\nProcessing folder: {folder_name}")

        prefix, is_completed = self._extract_status(folder_name)
        display_name = self._extract_story_name(folder_name)

        synopsis = f"[Auto-synced from Google Drive] Folder: {folder_name}"

        synopsis_file = self._find_synopsis_file(drive_service, folder_id)
        if synopsis_file:
            try:
                synopsis_content = self._get_file_content(drive_service, synopsis_file["id"])
                extracted = self._extract_synopsis_from_content(synopsis_content)
                if extracted:
                    synopsis = extracted
                    self._append_log("info", f"Extracted synopsis from synopsis.md ({len(extracted)} chars)", display_name)
            except Exception as exc:
                self._append_log("warning", f"Failed to read synopsis.md: {exc}", display_name)

        tags = self._parse_tags_file(drive_service, folder_id)
        if tags:
            self._append_log("info", f"Tags from tags.md: {tags}", display_name)

        main_cat_id, sub_cat_ids = self._parse_category_file(drive_service, folder_id)
        if main_cat_id:
            self._append_log("info", f"Category from Category.md: main={main_cat_id}, sub={sub_cat_ids}", display_name)

        reference_platform = self._extract_reference_platform(folder_name)
        if reference_platform:
            self._append_log("info", f"Reference platform: {reference_platform}", display_name)

        notification_config: Optional[dict] = None
        push_file = self._find_push_file(drive_service, folder_id)
        if push_file:
            try:
                push_content = self._get_file_content(drive_service, push_file["id"])
                push_title, push_content_body = self._parse_push_file(push_content)
                if push_title or push_content_body:
                    notification_config = {}
                    if push_title:
                        notification_config["title"] = push_title
                    if push_content_body:
                        notification_config["content"] = push_content_body
            except Exception as exc:
                self._append_log("warning", f"Failed to read Push.md: {exc}", display_name)

        free_chapters_count = 0
        free_md_file = self._find_free_md_file(drive_service, folder_id)
        if free_md_file:
            try:
                free_content = self._get_file_content(drive_service, free_md_file["id"])
                free_chapters_count = self._parse_free_md(free_content)
                self._append_log("info", f"Free chapters count from free.md: {free_chapters_count}", display_name)
            except Exception as exc:
                self._append_log("warning", f"Failed to read free.md: {exc}", display_name)

        target_id = folder_id
        chapters_ext = self._find_chapters_extended_folder(drive_service, folder_id)
        if chapters_ext:
            target_id = chapters_ext["id"]

        chapter_files = self._list_files_in_folder(drive_service, target_id)
        md_files = [f for f in chapter_files if f["name"].lower().endswith(".md")]
        if not md_files:
            self._append_log("warning", f"No .md files found in folder", display_name)
            return

        author_id = random.choice(_RANDOM_AUTHOR_IDS)

        existing_id = self._find_story_by_title(display_name)
        if existing_id:
            self._append_log("info", f"Story already on server (id={existing_id}), syncing chapters only", display_name)
            story_id = existing_id
        else:
            story_id = self._post_story(
                display_name, synopsis, is_completed, author_id,
                main_cat_id, sub_cat_ids, tags, reference_platform,
                notification_config, free_chapters_count,
            )

        if not story_id:
            self._append_log("error", f"Story creation failed, skipping chapters for: {folder_name}")
            return

        cover_file = self._find_cover_image_file(drive_service, folder_id)
        if cover_file:
            self._append_log("info", f"Cover image found in Drive: {cover_file['name']}")
            try:
                cover_bytes = self._download_cover_image_bytes(drive_service, cover_file["id"])
                self._append_log("info", f"Downloaded cover image ({len(cover_bytes)} bytes)")
                cover_url = self._upload_cover_image(story_id, cover_bytes, cover_file["name"])
                if cover_url:
                    self._append_log("info", f"Cover image uploaded: {cover_url}")
                else:
                    self._append_log("warning", "Cover image upload failed — continuing without cover")
            except Exception as exc:
                self._append_log("warning", f"Cover image processing failed: {exc}")
        else:
            self._append_log("info", "No cover.jpg found in story folder — skipping cover upload")

        existing_indices = self._get_existing_chapter_indices(story_id)
        next_index = max(existing_indices) + 1 if existing_indices else 1

        sorted_files = sorted(md_files, key=lambda f: f.get("name", ""))
        chapters_added = 0
        parsed_chapters = self._download_and_parse_chapter_files(sorted_files)

        for parsed in parsed_chapters:
            file_name = parsed["file_name"]
            title = parsed["title"]
            chapter_content = parsed["content"]
            if parsed["error"] is not None:
                self._append_log("warning", f"Failed to download {file_name}: {parsed['error']}", display_name)
                continue
            if not chapter_content:
                self._append_log("debug", f"Skipped {file_name} — empty content", display_name)
                continue

            posting_index = parsed["chapter_index"] or next_index
            while posting_index in existing_indices:
                posting_index += 1

            success = self._post_chapter(story_id, posting_index, title, chapter_content)
            if success:
                chapters_added += 1
                existing_indices.add(posting_index)
            next_index = max(next_index, posting_index + 1)

        self._status.stories_created += 1
        self._append_log("info", f"  Done: {chapters_added} chapters added.", display_name)

    # -------------------------------------------------------------------------
    # Browse / preview
    # -------------------------------------------------------------------------

    def list_drive_folders(self, limit: int = 50, offset: int = 0) -> tuple[list[dict], int]:
        """
        List story folders (DONE_/EXTENDED_/ING_/INCOMPLETE_) sorted by name.
        Results are cached for 60 seconds.
        """
        import time as _time

        cache_key = ("_all_story_folders", self._config.folder_id)

        cached_sorted = self._folder_cache.get(cache_key)
        if cached_sorted is not None:
            cached_ts, sorted_folders = cached_sorted
            if _time.time() - cached_ts < 60.0:
                pass
            else:
                cached_sorted = None

        if cached_sorted is None:
            if self._config is None:
                raise RuntimeError("Drive sync config not set.")
            try:
                drive_service = self._build_drive_service()
            except Exception as exc:
                raise RuntimeError(f"Failed to authenticate with Google Drive: {exc}")
            try:
                raw_folders = self._list_folders(drive_service, self._config.folder_id)
            except Exception as exc:
                raise RuntimeError(f"Google Drive API error: {exc}")
            story_folders = [f for f in raw_folders if _RE_STATUS_PREFIX.match(f["name"])]
            sorted_folders = sorted(story_folders, key=lambda f: f["name"])
            self._folder_cache[cache_key] = (_time.time(), sorted_folders)

        total = len(sorted_folders)
        paged = sorted_folders[offset : offset + limit]

        result = []
        for folder in paged:
            name = folder["name"]
            prefix, is_completed = self._extract_status(name)
            display_name = self._extract_story_name(name)
            result.append({
                "id": folder["id"],
                "name": name,
                "prefix": prefix,
                "display_name": display_name,
                "is_completed": is_completed,
                "chapter_count": None,
                "modified_time": folder.get("modifiedTime"),
            })

        return (result, total)

    def list_drive_folders_with_counts(self, limit: int = 50, offset: int = 0) -> tuple[list[dict], int]:
        """List story folders with chapter counts (batched per page)."""
        folders, total = self.list_drive_folders(limit=limit, offset=offset)
        if not folders:
            return ([], total)
        drive_service = self._build_drive_service()
        folder_ids = [f["id"] for f in folders]
        counts = self._batch_get_chapter_counts(drive_service, folder_ids)
        for folder, count in zip(folders, counts):
            folder["chapter_count"] = count
        return (folders, total)

    def preview_story(self, folder_id: str) -> dict:
        """Fetch and parse all chapter files from a Drive story folder WITHOUT posting."""
        if self._config is None:
            raise RuntimeError("Drive sync config not set.")
        try:
            drive_service = self._build_drive_service()
        except Exception as exc:
            raise RuntimeError(f"Failed to authenticate with Google Drive: {exc}")

        def _call() -> dict:
            return drive_service.files().get(
                fileId=folder_id,
                fields="id, name, modifiedTime",
            ).execute()

        try:
            folder_info = self._retry_drive_call(_call)
        except Exception as exc:
            raise RuntimeError(f"Failed to get folder info: {exc}")

        folder_name = folder_info["name"]
        prefix, is_completed = self._extract_status(folder_name)
        display_name = self._extract_story_name(folder_name)

        target_id = folder_id
        chapters_ext = self._find_chapters_extended_folder(drive_service, folder_id)
        if chapters_ext:
            target_id = chapters_ext["id"]

        chapter_files = self._list_files_in_folder(drive_service, target_id)
        chapter_files_sorted = sorted(chapter_files, key=lambda f: f.get("name", ""))
        md_files = [f for f in chapter_files_sorted if f["name"].lower().endswith(".md")]

        chapters = []
        for f in md_files:
            try:
                content = self._get_file_content(drive_service, f["id"])
            except Exception:
                chapters.append({
                    "file_name": f["name"],
                    "index": 0,
                    "title": f["name"],
                    "content_preview": "",
                    "content_length": 0,
                    "download_error": True,
                })
                continue

            _, title, chapter_content = self._parse_chapter_file(content, f["name"])
            chapters.append({
                "file_name": f["name"],
                "index": self._extract_chapter_index(f["name"]) or 0,
                "title": title,
                "content_preview": chapter_content[:500],
                "content_length": len(chapter_content),
                "download_error": False,
            })

        return {
            "folder_id": folder_id,
            "folder_name": folder_name,
            "prefix": prefix,
            "display_name": display_name,
            "is_completed": is_completed,
            "modified_time": folder_info.get("modifiedTime"),
            "chapter_count": len(chapters),
            "chapters": chapters,
        }

    def get_file_content(self, folder_id: str, filename: str) -> str:
        """Read a metadata file from inside a story folder. Raises RuntimeError if not found."""
        if self._config is None:
            raise RuntimeError("Drive sync config not set.")
        try:
            drive_service = self._build_drive_service()
        except Exception as exc:
            raise RuntimeError(f"Failed to authenticate with Google Drive: {exc}")

        page_token = None
        while True:
            def _call() -> dict:
                return drive_service.files().list(
                    q=f"'{folder_id}' in parents and mimeType!='application/vnd.google-apps.folder' "
                    f"and name='{filename}' and trashed=false",
                    fields="files(id, name),nextPageToken",
                    pageSize=10,
                    pageToken=page_token,
                ).execute()
            try:
                response = self._retry_drive_call(_call)
            except Exception as exc:
                raise RuntimeError(f"Failed to list files in folder: {exc}")

            files = response.get("files", [])
            if files:
                file_id = files[0]["id"]
                try:
                    return self._get_file_content(drive_service, file_id)
                except Exception as exc:
                    raise RuntimeError(f"Failed to download file '{filename}': {exc}")

            page_token = response.get("nextPageToken")
            if not page_token:
                break

        raise RuntimeError(f"File '{filename}' not found in folder.")

    def sync_single_folder(self, folder_id: str) -> "DriveSyncStatus":
        """Sync a single story folder to the main BE."""
        from api.models.drive_sync import DriveSyncStatus

        if self._config is None:
            raise RuntimeError("Drive sync config not set.")
        self._status = DriveSyncStatus(enabled=self._config.enabled)
        self._current_log = []
        try:
            drive_service = self._build_drive_service()
        except Exception as exc:
            raise RuntimeError(f"Failed to authenticate with Google Drive: {exc}")

        def _call() -> dict:
            return drive_service.files().get(fileId=folder_id, fields="id, name").execute()

        try:
            folder_info = self._retry_drive_call(_call)
        except Exception as exc:
            raise RuntimeError(f"Failed to get folder info: {exc}")

        folder = folder_info
        if not _RE_STATUS_PREFIX.match(folder["name"]):
            raise RuntimeError(f"Folder '{folder['name']}' is not a story folder (missing DONE_/EXTENDED_/ING_/INCOMPLETE_ prefix).")

        self._process_story_folder(drive_service, folder)
        self._save_status()
        return self._status

    def list_all_drive_items(self) -> list[dict]:
        """Return ALL items (files + folders) in the root Drive folder."""
        if self._config is None:
            raise RuntimeError("Drive sync config not set.")
        try:
            drive_service = self._build_drive_service()
            return self._list_folders(drive_service, self._config.folder_id)
        except Exception as exc:
            raise RuntimeError(f"Google Drive API error: {exc}")

    # -------------------------------------------------------------------------
    # Action History persistence
    # -------------------------------------------------------------------------

    def _load_history(self) -> list["HistoryEntry"]:
        from api.models.drive_sync import HistoryEntry

        raw = self._repo.load_history()
        return [HistoryEntry(**e) for e in raw]

    def _save_history(self, entries: list["HistoryEntry"]) -> None:
        self._repo.save_history(entries)

    def get_history(self, limit: int = 200, offset: int = 0) -> tuple[list["HistoryEntry"], int]:
        """Return a paginated slice of history entries, newest first."""
        all_entries = self._load_history()
        total = len(all_entries)
        paged = all_entries[offset : offset + limit]
        return (paged, total)

    def add_history_entry(
        self,
        kind: str,
        status: str,
        title: str,
        subtitle: str,
        items: Optional[list[dict]] = None,
        error: Optional[str] = None,
        entry_id: Optional[str] = None,
    ) -> tuple[str, str]:
        """Prepend a new history entry. Returns (id, timestamp)."""
        from api.models.drive_sync import HistoryEntry, HistoryItem

        _ACTION_KINDS = {"upload_single", "upload_batch", "update_single", "update_batch", "test_sync", "config_save"}
        _ACTION_STATUSES = {"running", "success", "error", "cancelled"}
        if kind not in _ACTION_KINDS:
            raise ValueError(f"Invalid action kind: {kind}")
        if status not in _ACTION_STATUSES:
            raise ValueError(f"Invalid action status: {status}")

        entry_id = entry_id or str(uuid.uuid4())
        timestamp = datetime.now(timezone.utc).isoformat()

        history_items: Optional[list["HistoryItem"]] = None
        if items:
            history_items = [HistoryItem(**it) for it in items]

        entry = HistoryEntry(
            id=entry_id,
            timestamp=timestamp,
            kind=kind,
            status=status,
            title=title,
            subtitle=subtitle,
            items=history_items,
            error=error,
        )

        all_entries = self._load_history()
        all_entries.insert(0, entry)

        if len(all_entries) > _MAX_HISTORY_ENTRIES:
            all_entries = all_entries[:_MAX_HISTORY_ENTRIES]

        self._save_history(all_entries)
        return (entry_id, timestamp)

    def update_history_entry(
        self,
        entry_id: str,
        status: Optional[str] = None,
        title: Optional[str] = None,
        subtitle: Optional[str] = None,
        items: Optional[list[dict]] = None,
        error: Optional[str] = None,
    ) -> bool:
        """Patch a history entry by ID. Returns True if found and updated."""
        from api.models.drive_sync import HistoryEntry, HistoryItem

        _ACTION_STATUSES = {"running", "success", "error", "cancelled"}
        if status is not None and status not in _ACTION_STATUSES:
            raise ValueError(f"Invalid action status: {status}")

        all_entries = self._load_history()
        for i, entry in enumerate(all_entries):
            if entry.id == entry_id:
                if status is not None:
                    all_entries[i].status = status
                if title is not None:
                    all_entries[i].title = title
                if subtitle is not None:
                    all_entries[i].subtitle = subtitle
                if items is not None:
                    all_entries[i].items = [HistoryItem(**it) for it in items]
                if error is not None:
                    all_entries[i].error = error
                self._save_history(all_entries)
                return True
        return False

    def delete_history_entries(self, entry_ids: list[str]) -> int:
        """Delete history entries by ID. Returns the count of deleted entries."""
        if not entry_ids:
            return 0
        all_entries = self._load_history()
        before = len(all_entries)
        all_entries = [e for e in all_entries if e.id not in entry_ids]
        deleted = before - len(all_entries)
        if deleted > 0:
            self._save_history(all_entries)
        return deleted

    def clear_history(self) -> None:
        """Delete all history entries."""
        self._save_history([])

    # -------------------------------------------------------------------------
    # Sync Job persistence
    # -------------------------------------------------------------------------

    def _load_jobs_raw(self) -> list["SyncJob"]:
        from api.models.drive_sync import SyncJob

        raw = self._repo.load_jobs()
        return [SyncJob(**j) for j in raw]

    def _with_jobs_lock(self, fn: "Callable[[list[SyncJob]], list[SyncJob]]") -> list["SyncJob"]:
        return self._repo.with_jobs_lock(fn)

    def create_job(
        self,
        kind: str,
        folder_id: str,
        folder_name: str,
        display_name: str,
        main_be_api_base_url: Optional[str] = None,
        chapters_count: Optional[int] = None,
    ) -> "SyncJob":
        """Create a new sync job. Returns the created job."""
        from api.models.drive_sync import JobKind, JobStatus, SyncJob

        _JOB_KINDS_VALID = {JobKind.UPLOAD_SINGLE, JobKind.UPDATE_SINGLE}
        if kind not in _JOB_KINDS_VALID:
            raise ValueError(f"Invalid job kind: {kind}")

        job = SyncJob(
            id=str(uuid.uuid4()),
            kind=kind,
            status=JobStatus.QUEUED,
            folder_id=folder_id,
            folder_name=folder_name,
            display_name=display_name,
            created_at=datetime.now(timezone.utc).isoformat(),
            main_be_api_base_url=main_be_api_base_url,
            chapters_count=chapters_count,
        )

        def _mutate(jobs: list["SyncJob"]) -> list["SyncJob"]:
            jobs.insert(0, job)
            if len(jobs) > _MAX_JOBS_ENTRIES:
                jobs = jobs[:_MAX_JOBS_ENTRIES]
            return jobs

        self._with_jobs_lock(_mutate)
        self._repo._enforce_jobs_limit(_MAX_JOBS_ENTRIES)
        return job

    def create_job_once(
        self,
        kind: str,
        folder_id: str,
        folder_name: str,
        display_name: str,
        main_be_api_base_url: Optional[str] = None,
        chapters_count: Optional[int] = None,
    ) -> tuple["SyncJob", bool]:
        """Create a job unless an equivalent active job already exists."""
        from api.models.drive_sync import JobKind, JobStatus, SyncJob

        _JOB_KINDS_VALID = {JobKind.UPLOAD_SINGLE, JobKind.UPDATE_SINGLE}
        if kind not in _JOB_KINDS_VALID:
            raise ValueError(f"Invalid job kind: {kind}")

        job = SyncJob(
            id=str(uuid.uuid4()),
            kind=kind,
            status=JobStatus.QUEUED,
            folder_id=folder_id,
            folder_name=folder_name,
            display_name=display_name,
            created_at=datetime.now(timezone.utc).isoformat(),
            main_be_api_base_url=main_be_api_base_url,
            chapters_count=chapters_count,
        )
        selected_job = job
        created = True

        def _mutate(jobs: list["SyncJob"]) -> list["SyncJob"]:
            nonlocal selected_job, created
            for existing in jobs:
                if (
                    existing.kind == kind
                    and existing.folder_id == folder_id
                    and existing.status in (JobStatus.QUEUED, JobStatus.RUNNING)
                ):
                    selected_job = existing
                    created = False
                    return jobs
            jobs.insert(0, job)
            if len(jobs) > _MAX_JOBS_ENTRIES:
                jobs = jobs[:_MAX_JOBS_ENTRIES]
            return jobs

        self._with_jobs_lock(_mutate)
        if created:
            self._repo._enforce_jobs_limit(_MAX_JOBS_ENTRIES)
        return selected_job, created

    def get_job(self, job_id: str) -> Optional["SyncJob"]:
        """Return a single job by ID, or None if not found."""
        jobs = self._load_jobs_raw()
        for job in jobs:
            if job.id == job_id:
                return job
        return None

    def list_jobs(self, limit: int = 100, offset: int = 0) -> tuple[list["SyncJob"], int]:
        """Return a paginated list of all jobs, newest first."""
        all_jobs = self._load_jobs_raw()
        total = len(all_jobs)
        paged = all_jobs[offset : offset + limit]
        return (paged, total)

    def get_last_update_time(self, folder_name: str) -> Optional[str]:
        """Return the finished_at of the most recent successful update_single job for the given folder_name."""
        all_jobs = self._load_jobs_raw()
        latest: Optional[str] = None
        for job in all_jobs:
            if (
                job.kind == "update_single"
                and job.status == "success"
                and job.finished_at is not None
                and folder_name.lower() == job.display_name.lower()
            ):
                if latest is None or job.finished_at > latest:
                    latest = job.finished_at
        return latest

    def update_job(
        self,
        job_id: str,
        status: Optional[str] = None,
        started_at: Optional[str] = None,
        finished_at: Optional[str] = None,
        result_message: Optional[str] = None,
        chapters_added: Optional[int] = None,
        chapters_skipped: Optional[int] = None,
        error: Optional[str] = None,
        logs: Optional[list] = None,
        main_be_api_base_url: Optional[str] = None,
    ) -> bool:
        """Update fields on a job. Returns True if found and updated."""
        from api.models.drive_sync import JobStatus as _JS

        _JOB_STATUS_VALID = {_JS.QUEUED, _JS.RUNNING, _JS.SUCCESS, _JS.ERROR, _JS.CANCELLED}
        if status is not None and status not in _JOB_STATUS_VALID:
            raise ValueError(f"Invalid job status: {status}")

        def _mutate(all_jobs: list["SyncJob"]) -> list["SyncJob"]:
            for i, job in enumerate(all_jobs):
                if job.id == job_id:
                    if status is not None:
                        all_jobs[i].status = status
                    if started_at is not None:
                        all_jobs[i].started_at = started_at
                    if finished_at is not None:
                        all_jobs[i].finished_at = finished_at
                    if result_message is not None:
                        all_jobs[i].result_message = result_message
                    if chapters_added is not None:
                        all_jobs[i].chapters_added = chapters_added
                    if chapters_skipped is not None:
                        all_jobs[i].chapters_skipped = chapters_skipped
                    if error is not None:
                        all_jobs[i].error = error
                    if logs is not None:
                        all_jobs[i].logs = logs
                    if main_be_api_base_url is not None:
                        all_jobs[i].main_be_api_base_url = main_be_api_base_url
                    return all_jobs
            return all_jobs

        result = self._with_jobs_lock(_mutate)
        for j in result:
            if j.id == job_id:
                return True
        return False

    def append_job_log(self, job_id: str, level: str, message: str) -> None:
        """Append a log entry to a job. No-op if the job is not found."""
        from api.models.drive_sync import JobLogEntry

        def _mutate(all_jobs: list["SyncJob"]) -> list["SyncJob"]:
            for i, job in enumerate(all_jobs):
                if job.id == job_id:
                    if all_jobs[i].logs is None:
                        all_jobs[i].logs = []
                    all_jobs[i].logs.append(JobLogEntry(
                        timestamp=datetime.now(timezone.utc).isoformat(),
                        level=level,
                        message=message,
                    ))
                    break
            return all_jobs

        self._with_jobs_lock(_mutate)

    def delete_job(self, job_id: str) -> bool:
        """Delete a job by ID. Returns True if found and deleted."""
        def _mutate(all_jobs: list["SyncJob"]) -> list["SyncJob"]:
            return [j for j in all_jobs if j.id != job_id]

        before = len(self._load_jobs_raw())
        self._with_jobs_lock(_mutate)
        return len(self._load_jobs_raw()) < before

    def record_completed_job(
        self,
        kind: str,
        folder_id: str,
        folder_name: str,
        display_name: str,
        result_message: str,
        logs: Optional[list[dict]] = None,
        chapters_added: int = 0,
        chapters_skipped: int = 0,
        error: Optional[str] = None,
        main_be_api_base_url: Optional[str] = None,
        chapters_count: Optional[int] = None,
    ) -> "SyncJob":
        """Persist a completed job for immediate operations that do not need a worker."""
        from api.models.drive_sync import JobKind, JobLogEntry, JobStatus, SyncJob

        _JOB_KINDS_VALID = {JobKind.UPLOAD_SINGLE, JobKind.UPDATE_SINGLE, JobKind.CHAPTER_CONTENT_UPDATE}
        if kind not in _JOB_KINDS_VALID:
            raise ValueError(f"Invalid job kind: {kind}")

        timestamp = datetime.now(timezone.utc).isoformat()
        status = JobStatus.ERROR if error else JobStatus.SUCCESS
        job_logs = [
            JobLogEntry(
                timestamp=str(item.get("timestamp") or timestamp),
                level=str(item.get("level") or "info"),
                message=str(item.get("message") or ""),
            )
            for item in (logs or [])
        ]

        job = SyncJob(
            id=str(uuid.uuid4()),
            kind=kind,
            status=status,
            folder_id=folder_id,
            folder_name=folder_name,
            display_name=display_name,
            created_at=timestamp,
            started_at=timestamp,
            finished_at=timestamp,
            result_message=result_message if not error else None,
            chapters_added=chapters_added,
            chapters_skipped=chapters_skipped,
            error=error,
            logs=job_logs,
            main_be_api_base_url=main_be_api_base_url,
            chapters_count=chapters_count,
        )

        def _mutate(jobs: list["SyncJob"]) -> list["SyncJob"]:
            jobs.insert(0, job)
            if len(jobs) > _MAX_JOBS_ENTRIES:
                jobs = jobs[:_MAX_JOBS_ENTRIES]
            return jobs

        self._with_jobs_lock(_mutate)
        self._repo._enforce_jobs_limit(_MAX_JOBS_ENTRIES)
        return job

    # -------------------------------------------------------------------------
    # Job-based sync execution
    # -------------------------------------------------------------------------

    def sync_folder_as_job(self, job_id: str) -> "SyncJob":
        """Execute a sync for a single folder tracked by job_id."""
        from api.models.drive_sync import JobKind, JobStatus, SyncJob
        from api.services.drive_service._parsers import _natural_sort_key as _ns

        job = self.get_job(job_id)
        if job is None:
            return SyncJob(
                id=job_id,
                kind=JobKind.UPLOAD_SINGLE,
                status=JobStatus.ERROR,
                folder_id="",
                folder_name="",
                display_name="",
                created_at=datetime.now(timezone.utc).isoformat(),
                finished_at=datetime.now(timezone.utc).isoformat(),
                error="Job not found",
            )

        self.update_job(job_id, status=JobStatus.RUNNING, started_at=datetime.now(timezone.utc).isoformat())

        if self._config is None:
            self.update_job(
                job_id,
                status=JobStatus.ERROR,
                finished_at=datetime.now(timezone.utc).isoformat(),
                error="Drive sync config not set.",
            )
            return self.get_job(job_id) or job

        self.update_job(job_id, main_be_api_base_url=self._config.main_be_api_base_url)
        self.append_job_log(job_id, "info", f"Starting sync for: {job.folder_name}")

        try:
            drive_service = self._build_drive_service()
        except Exception as exc:
            err = f"Failed to authenticate with Google Drive: {exc}"
            self.append_job_log(job_id, "error", err)
            self.update_job(job_id, status=JobStatus.ERROR, finished_at=datetime.now(timezone.utc).isoformat(), error=err)
            return self.get_job(job_id) or job

        try:
            def _call() -> dict:
                return drive_service.files().get(fileId=job.folder_id, fields="id, name").execute()
            folder_info = self._retry_drive_call(_call)
        except Exception as exc:
            err = f"Failed to get folder info: {exc}"
            self.append_job_log(job_id, "error", err)
            self.update_job(job_id, status=JobStatus.ERROR, finished_at=datetime.now(timezone.utc).isoformat(), error=err)
            return self.get_job(job_id) or job

        folder_name = folder_info["name"]
        display_name = self._extract_story_name(folder_name)
        folder = {"id": job.folder_id, "name": folder_name}

        chapters_added, chapters_skipped, story_created, story_error = self._process_story_folder_with_job(drive_service, folder, job_id)

        if not story_created:
            self.update_job(
                job_id,
                status=JobStatus.ERROR,
                finished_at=datetime.now(timezone.utc).isoformat(),
                error=story_error or "Story creation failed",
            )
            return self.get_job(job_id) or job

        msg = f"Done. Added {chapters_added} chapter(s), skipped {chapters_skipped}."
        self.update_job(
            job_id,
            status=JobStatus.SUCCESS,
            finished_at=datetime.now(timezone.utc).isoformat(),
            result_message=msg,
            chapters_added=chapters_added,
            chapters_skipped=chapters_skipped,
        )
        return self.get_job(job_id) or job

    def _process_story_folder_with_job(
        self,
        drive_service: "Any",
        folder: dict,
        job_id: str,
    ) -> tuple[int, int, bool, str]:
        """Sync a story folder and track progress via job_id. Returns (chapters_added, chapters_skipped, story_created, error_message)."""
        from api.services.drive_service._parsers import _natural_sort_key as _ns

        folder_id = folder["id"]
        folder_name = folder["name"]
        self.append_job_log(job_id, "info", f"Processing folder: {folder_name}")

        display_name = self._extract_story_name(folder_name)
        synopsis = f"[Auto-synced from Google Drive] Folder: {folder_name}"

        synopsis_file = self._find_synopsis_file(drive_service, folder_id)
        if synopsis_file:
            try:
                synopsis_content = self._get_file_content(drive_service, synopsis_file["id"])
                extracted = self._extract_synopsis_from_content(synopsis_content)
                if extracted:
                    synopsis = extracted
                    self.append_job_log(job_id, "info", f"Extracted synopsis from synopsis.md ({len(extracted)} chars)")
            except Exception as exc:
                self.append_job_log(job_id, "warning", f"Failed to read synopsis.md: {exc}")

        tags = self._parse_tags_file(drive_service, folder_id)
        if tags:
            self.append_job_log(job_id, "info", f"Tags from tags.md: {tags}")

        main_cat_id, sub_cat_ids = self._parse_category_file(drive_service, folder_id)
        if main_cat_id:
            self.append_job_log(job_id, "info", f"Category: main={main_cat_id}, sub={sub_cat_ids}")

        reference_platform = self._extract_reference_platform(folder_name)
        if reference_platform:
            self.append_job_log(job_id, "info", f"Reference platform: {reference_platform}")

        notification_config: Optional[dict] = None
        push_file = self._find_push_file(drive_service, folder_id)
        if push_file:
            try:
                push_content = self._get_file_content(drive_service, push_file["id"])
                push_title, push_content_body = self._parse_push_file(push_content)
                if push_title or push_content_body:
                    notification_config = {}
                    if push_title:
                        notification_config["title"] = push_title
                    if push_content_body:
                        notification_config["content"] = push_content_body
                    self.append_job_log(job_id, "info", f"Push notification: title={push_title!r}")
            except Exception as exc:
                self.append_job_log(job_id, "warning", f"Failed to read Push.md: {exc}")

        free_chapters_count = 0
        free_md_file = self._find_free_md_file(drive_service, folder_id)
        if free_md_file:
            self.append_job_log(job_id, "info", f"free.md file found: id={free_md_file['id']}")
            try:
                free_md_content = self._get_file_content(drive_service, free_md_file["id"])
                free_chapters_count = self._parse_free_md(free_md_content)
                self.append_job_log(job_id, "info", f"Free chapters count from free.md: {free_chapters_count}")
            except Exception as exc:
                self.append_job_log(job_id, "warning", f"Failed to read free.md: {exc}")
        else:
            self.append_job_log(job_id, "info", "free.md not found — freeChaptersCount will be 0")

        author_id = random.choice(_RANDOM_AUTHOR_IDS)

        existing_id = self._find_story_by_title(display_name)
        if existing_id:
            self.append_job_log(job_id, "info", f"Story already on server (id={existing_id}), syncing chapters only")
            story_id = existing_id
            story_error = ""
        else:
            story_id, story_error = self._post_story(
                display_name,
                synopsis,
                False,
                author_id,
                main_cat_id,
                sub_cat_ids,
                tags,
                reference_platform,
                notification_config,
                free_chapters_count,
                job_id,
            )

        if not story_id:
            self.append_job_log(job_id, "error", f"Story creation failed, skipping chapters for: {folder_name}")
            return (0, 0, False, story_error)

        cover_file = self._find_cover_image_file(drive_service, folder_id)
        if cover_file:
            self.append_job_log(job_id, "info", f"Cover image found in Drive: {cover_file['name']}")
            try:
                cover_bytes = self._download_cover_image_bytes(drive_service, cover_file["id"])
                self.append_job_log(job_id, "info", f"Downloaded cover image ({len(cover_bytes)} bytes)")
                cover_url = self._upload_cover_image(story_id, cover_bytes, cover_file["name"])
                if cover_url:
                    self.append_job_log(job_id, "info", f"Cover image uploaded: {cover_url}")
                else:
                    self.append_job_log(job_id, "warning", "Cover image upload failed")
            except Exception as exc:
                self.append_job_log(job_id, "warning", f"Cover image processing failed: {exc}")
        else:
            self.append_job_log(job_id, "info", "No cover.jpg found — skipping cover upload")

        if not existing_id:
            banner_result = self.upload_banner_for_new_story(story_id, folder_id)
            banner_filename = banner_result.get("filename")
            if banner_filename:
                self.append_job_log(job_id, "info", f"Banner image found in Drive: {banner_filename}")
            if banner_result.get("uploaded"):
                self.append_job_log(job_id, "info", f"Banner image uploaded: {banner_result['banner_url']}")
            elif banner_result.get("error"):
                self.append_job_log(job_id, "warning", f"Banner image upload failed: {banner_result['error']}")
            else:
                self.append_job_log(job_id, "info", "No banner.{jpg,jpeg,png} found in story folder — skipping banner upload")

        if not existing_id:
            intro_result = self.upload_intro_for_new_story(story_id, folder_id, display_name)
            intro_filename = intro_result.get("filename")
            if intro_filename:
                self.append_job_log(job_id, "info", f"Intro image found in Drive: {intro_filename}")
            if intro_result.get("uploaded"):
                self.append_job_log(job_id, "info", f"Intro image uploaded: {intro_result['intro_url']}")
            elif intro_result.get("not_recommended"):
                # Recommended-list gate: the intro is skipped because the story is not in the
                # admin recommended list. When the intro file is also missing, warn about both.
                if intro_result.get("error"):
                    self.append_job_log(job_id, "warning", f"Intro not uploaded: {intro_result['error']}")
                else:
                    self.append_job_log(job_id, "warning", f"Story '{display_name}' is not in the admin recommended list — intro not uploaded.")
                if not intro_filename:
                    self.append_job_log(job_id, "warning", "No intro.{jpg,jpeg,png} found in story folder.")
            elif intro_result.get("error"):
                self.append_job_log(job_id, "warning", f"Intro image upload failed: {intro_result['error']}")
            else:
                self.append_job_log(job_id, "info", "No intro.{jpg,jpeg,png} found in story folder — skipping intro upload")

        existing_indices = self._get_existing_chapter_indices(story_id)
        self.append_job_log(job_id, "info", f"Server has {len(existing_indices)} chapters")
        next_index = max(existing_indices) + 1 if existing_indices else 1

        target_id = folder_id
        chapters_ext = self._find_chapters_extended_folder(drive_service, folder_id)
        if chapters_ext:
            target_id = chapters_ext["id"]

        chapter_files = self._list_files_in_folder(drive_service, target_id)
        md_files = [f for f in chapter_files if f["name"].lower().endswith(".md")]
        sorted_files = sorted(md_files, key=lambda f: _ns(f["name"]))

        chapters_added = 0
        chapters_skipped = 0
        parsed_chapters = self._download_and_parse_chapter_files(sorted_files)

        for parsed in parsed_chapters:
            file_name = parsed["file_name"]
            title = parsed["title"]
            chapter_content = parsed["content"]
            if parsed["error"] is not None:
                self.append_job_log(job_id, "warning", f"Failed to download {file_name}: {parsed['error']}")
                chapters_skipped += 1
                continue

            if not chapter_content:
                self.append_job_log(job_id, "debug", f"Skipped {file_name} - empty content")
                chapters_skipped += 1
                continue

            posting_index = parsed["chapter_index"] or next_index
            while posting_index in existing_indices:
                posting_index += 1

            success = self._post_chapter(story_id, posting_index, title, chapter_content)
            if success:
                chapters_added += 1
                existing_indices.add(posting_index)
                self.append_job_log(job_id, "info", f"  Chapter {posting_index}: {title[:50]} -> OK")
            else:
                self.append_job_log(job_id, "warning", f"  Chapter {posting_index} ({file_name}) failed to post.")
                chapters_skipped += 1

            next_index = max(next_index, posting_index + 1)

        return (chapters_added, chapters_skipped, True, "")

    # -------------------------------------------------------------------------
    # sync_update_as_job — background chapter update
    # -------------------------------------------------------------------------

    def sync_update_as_job(self, job_id: str) -> None:
        """Run the update-chapters work as a background job. Updates job status on completion."""
        from api.models.drive_sync import JobStatus

        self.update_job(job_id, status=JobStatus.RUNNING, started_at=datetime.now(timezone.utc).isoformat())
        if self._config is not None:
            self.update_job(job_id, main_be_api_base_url=self._config.main_be_api_base_url)
        self.append_job_log(job_id, "info", "Job started — fetching folder info...")
        try:
            job = self.get_job(job_id)
            if job is None:
                self.update_job(job_id, status=JobStatus.ERROR, finished_at=datetime.now(timezone.utc).isoformat(), error="Job not found")
                return
            drive_service = self._build_drive_service()
            try:
                def _get_folder() -> dict:
                    return drive_service.files().get(fileId=job.folder_id, fields="id, name").execute()
                folder_info = self._retry_drive_call(_get_folder)
            except Exception as exc:
                raise RuntimeError(f"Failed to get folder info: {exc}")
            folder_name = folder_info["name"]
            display_name = self._extract_story_name(folder_name)
            self.append_job_log(job_id, "info", f"Folder: {folder_name} | Display name: {display_name}")
            self.append_job_log(job_id, "info", f"Starting update sync for '{display_name}'...")
            added, skipped, found = self._sync_new_chapters_from_extended_folder(
                drive_service, job.folder_id, folder_name, display_name,
                chapters_count=job.chapters_count,
                job_id=job_id,
            )
            self.append_job_log(job_id, "info", f"Update complete — added={added}, skipped={skipped}, found={found}")
            if not found:
                self.update_job(job_id, status=JobStatus.ERROR, finished_at=datetime.now(timezone.utc).isoformat(),
                                error="Story not found on server", chapters_added=added, chapters_skipped=skipped)
            elif added == 0 and skipped > 0:
                error = f"Update failed: 0 chapter(s) added, {skipped} failed/skipped."
                self.update_job(job_id, status=JobStatus.ERROR, finished_at=datetime.now(timezone.utc).isoformat(),
                                error=error, chapters_added=added, chapters_skipped=skipped)
            else:
                msg = f"Added {added} chapter(s), skipped {skipped}." if added > 0 else f"No new chapters (skipped {skipped})."
                self.update_job(job_id, status=JobStatus.SUCCESS, finished_at=datetime.now(timezone.utc).isoformat(),
                                result_message=msg, chapters_added=added, chapters_skipped=skipped)
        except Exception as exc:
            self.append_job_log(job_id, "error", f"Update failed: {exc}")
            self.update_job(job_id, status=JobStatus.ERROR, finished_at=datetime.now(timezone.utc).isoformat(), error=str(exc))
