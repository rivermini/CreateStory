"""DriveAPIMixin — Google Drive API calls, retry, and caching for DriveSyncService."""

from __future__ import annotations

import logging
import ssl
import threading
import time
from pathlib import Path
from typing import Any, Callable, Optional, TYPE_CHECKING

if TYPE_CHECKING:
    pass

from google.auth import load_credentials_from_file
from googleapiclient.discovery import build

from api.services.drive_service._paths import (
    _DRIVE_CALL_BACKOFF_BASE,
    _DRIVE_CALL_CONCURRENCY,
    _DRIVE_CALL_RETRIES,
    _DRIVE_CALL_SEMAPHORE,
    _RE_STATUS_PREFIX,
    _SHARED_CREDENTIALS_DIR,
)


class DriveAPIMixin:
    """
    Mix-in providing Google Drive API integration.

    Adds to DriveSyncService:
      - __init__  (initialises _folder_cache, _server_cache)
      - _build_drive_service, _retry_drive_call
      - _get_cached_server_stories, _set_cached_server_stories, _invalidate_caches
      - _list_folders, _list_files_in_folder, _get_file_content
      - _batch_get_chapter_counts, _batch_count_chapters_in_extended
      - _batch_check_duplicates_and_count_extended
      - _batch_get_free_and_tag_counts
      - _download_file_content  (backward-compat alias for _get_file_content)
    """

    def __init__(self) -> None:
        import threading

        super().__init__()
        self._folder_cache: dict = {}
        self._server_cache: Optional[tuple[float, list[dict]]] = None
        self._tls = threading.local()
        self._build_lock = threading.Lock()

    def _build_drive_service(self) -> Any:
        """
        Build an authenticated Google Drive service object.
        Each thread gets its own httplib2 transport to prevent SSL session corruption.
        Tries the configured path first, then falls back to the shared FastAPIServer/credentials folder.
        """
        service = getattr(self._tls, "drive_service", None)
        if service is not None:
            return service
        with self._build_lock:
            service = getattr(self._tls, "drive_service", None)
            if service is not None:
                return service
            if self._config is None:
                raise RuntimeError("Drive sync config not set.")
            creds_path = Path(self._config.service_account_json_path)
            if creds_path.is_absolute():
                pass  # use as-is
            elif creds_path.name:
                # Strip "data/credentials/" prefix and resolve under _SHARED_CREDENTIALS_DIR
                stripped = creds_path.name
                creds_path = _SHARED_CREDENTIALS_DIR / stripped
            if not creds_path.is_file():
                raise FileNotFoundError(
                    f"Service account JSON not found at configured path or {_SHARED_CREDENTIALS_DIR}"
                )
            creds, _ = load_credentials_from_file(str(creds_path))
            self._tls.drive_service = build("drive", "v3", credentials=creds, cache_discovery=False)
            return self._tls.drive_service

    def _retry_drive_call(self, func: Callable[..., Any]) -> Any:
        """
        Retry a Drive API call on transient SSL/network errors.
        Retries on ssl.SSLError and TimeoutError with exponential backoff.
        Propagates HttpError after all retries are exhausted.
        """
        from googleapiclient.errors import HttpError

        last_exc: Optional[BaseException] = None
        for attempt in range(_DRIVE_CALL_RETRIES):
            try:
                with _DRIVE_CALL_SEMAPHORE:
                    return func()
            except (ssl.SSLError, TimeoutError) as exc:
                last_exc = exc
                if attempt < _DRIVE_CALL_RETRIES - 1:
                    backoff = _DRIVE_CALL_BACKOFF_BASE * (attempt + 1)
                    logger.warning(
                        "Drive API call failed (attempt %d/%d, concurrency=%d), retrying in %.1fs: %s",
                        attempt + 1, _DRIVE_CALL_RETRIES, _DRIVE_CALL_CONCURRENCY, backoff, exc,
                    )
                    time.sleep(backoff)
                continue
            except HttpError:
                raise
        if last_exc is not None:
            raise last_exc

    def _get_cached_server_stories(self, ttl: float = 30.0) -> Optional[list[dict]]:
        """Return cached server stories if still fresh, else None."""
        if self._server_cache is None:
            return None
        ts, data = self._server_cache
        if time.time() - ts < ttl:
            return data
        return None

    def _set_cached_server_stories(self, stories: list[dict]) -> None:
        """Store server stories in cache."""
        self._server_cache = (time.time(), stories)

    def _invalidate_caches(self) -> None:
        """Clear all caches (call after any write operation)."""
        self._folder_cache.clear()
        self._server_cache = None

    def get_extended_chapter_breakdown(self, folder_id: str) -> dict:
        """
        Debug method: return a detailed breakdown of every file in the chapters-extended
        subfolder, mirroring the filtering/processing that _batch_check_duplicates_and_count_extended
        applies.
        """
        from api.services.drive_service._parsers import (
            _extract_chapter_index_from_filename,
            _is_valid_chapter_filename,
        )

        drive_service = self._build_drive_service()
        if self._config is None:
            raise RuntimeError("Drive sync config not set.")

        subfolder_id: Optional[str] = None
        subfolder_name: Optional[str] = None
        page_token: Optional[str] = None
        while True:
            _pt = page_token
            _q = (
                f"'{folder_id}' in parents and "
                f"mimeType='application/vnd.google-apps.folder' and "
                f"name contains 'chapters-extended' and trashed=false"
            )
            try:
                response = self._retry_drive_call(
                    lambda: drive_service.files().list(
                        q=_q, fields="files(id, name, parents)", pageSize=500, pageToken=_pt
                    ).execute()
                )
            except (ssl.SSLError, TimeoutError):
                break
            for f in response.get("files", []):
                for parent in f.get("parents", []):
                    if parent == folder_id:
                        subfolder_id = f["id"]
                        subfolder_name = f.get("name", "")
                        break
            page_token = response.get("nextPageToken")
            if not page_token or subfolder_id:
                break

        if not subfolder_id:
            return {
                "subfolder_found": False,
                "total_md_files": 0,
                "ext_count": 0,
                "chapter_indices": [],
                "format_errors": [],
                "summary": "chapters-extended subfolder not found in Drive",
            }

        all_files: list[dict] = []
        page_token = None
        while True:
            _pt = page_token
            try:
                response = self._retry_drive_call(
                    lambda: drive_service.files().list(
                        q=f"'{subfolder_id}' in parents and name contains '.md' and trashed=false",
                        fields="files(id, name, parents)",
                        pageSize=500,
                        pageToken=_pt,
                    ).execute()
                )
            except (ssl.SSLError, TimeoutError):
                break
            for f in response.get("files", []):
                if f.get("name", "").lower().endswith(".md"):
                    all_files.append(f)
            page_token = response.get("nextPageToken")
            if not page_token:
                break

        METADATA_FILES = {
            "tags.md", "title.md", "synopsis.md", "push.md",
            "blueprint-current.md", "category.md", "voice-profile.md",
        }

        def _is_chapter_file(name: str) -> bool:
            lower = name.lower()
            if lower in METADATA_FILES:
                return False
            if lower.startswith("chapter") or "chapter" in lower:
                return True
            return False

        chapter_indices: list[tuple[int, str]] = []
        format_errors: list[str] = []
        is_chapter_file_results: list[dict] = []
        is_valid_results: list[dict] = []
        metadata_found: list[str] = []

        for f in all_files:
            fname = f.get("name", "")
            is_chap = _is_chapter_file(fname)
            is_valid = _is_valid_chapter_filename(fname)
            idx = _extract_chapter_index_from_filename(fname)

            is_chapter_file_results.append({"filename": fname, "passes": is_chap})
            is_valid_results.append({"filename": fname, "is_valid_format": is_valid, "extracted_index": idx})

            if fname.lower() in METADATA_FILES:
                metadata_found.append(fname)
                continue
            if not is_valid:
                format_errors.append(fname)
                continue
            if idx is not None:
                chapter_indices.append((idx, fname))

        ext_count = sum(1 for f in all_files if _is_chapter_file(f.get("name", "")))
        chapter_indices.sort(key=lambda x: x[0])

        return {
            "subfolder_found": True,
            "subfolder_id": subfolder_id,
            "subfolder_name": subfolder_name,
            "total_md_files": len(all_files),
            "ext_count": ext_count,
            "all_filenames": sorted(f.get("name", "") for f in all_files),
            "is_chapter_file_results": is_chapter_file_results,
            "is_valid_format_results": is_valid_results,
            "chapter_indices": [(int(idx), fname) for (idx, fname) in chapter_indices],
            "format_errors": format_errors,
            "metadata_files_found": metadata_found,
            "summary": (
                f"{len(all_files)} total .md files, "
                f"{ext_count} pass _is_chapter_file (ext_count), "
                f"{len(chapter_indices)} valid indexed chapters, "
                f"{len(format_errors)} format errors, "
                f"{len(metadata_found)} metadata files"
            ),
        }

    def _list_folders(self, drive_service: Any, parent_id: str) -> list[dict]:
        """List all folder children under a Drive folder ID."""
        results = []
        page_token: Optional[str] = None
        while True:
            _pt = page_token
            def _call() -> dict:
                return drive_service.files().list(
                    q=f"'{parent_id}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false",
                    fields="files(id, name, modifiedTime)",
                    pageSize=500,
                    pageToken=_pt,
                ).execute()
            response = self._retry_drive_call(_call)
            files = response.get("files", [])
            filtered = [f for f in files if f.get("name") not in _SYSTEM_FOLDERS]
            results.extend(filtered)
            page_token = response.get("nextPageToken")
            if not page_token:
                break
        return results

    def _list_files_in_folder(self, drive_service: Any, folder_id: str) -> list[dict]:
        """List all file children (non-folders) under a Drive folder ID."""
        results = []
        page_token: Optional[str] = None
        while True:
            _pt = page_token
            def _call() -> dict:
                return drive_service.files().list(
                    q=f"'{folder_id}' in parents and mimeType!='application/vnd.google-apps.folder' and trashed=false",
                    fields="files(id, name, modifiedTime)",
                    pageSize=500,
                    pageToken=_pt,
                ).execute()
            response = self._retry_drive_call(_call)
            results.extend(response.get("files", []))
            page_token = response.get("nextPageToken")
            if not page_token:
                break
        return results

    def _check_chapter_duplicates(self, drive_service: Any, folder_id: str) -> tuple[bool, list[int]]:
        """Scan a folder for .md files whose chapter numbers have duplicates."""
        files = self._list_files_in_folder(drive_service, folder_id)
        md_files = [f for f in files if f.get("name", "").lower().endswith(".md")]
        index_map: dict[int, list[str]] = {}
        for f in md_files:
            from api.services.drive_service._parsers import _extract_chapter_index_from_filename

            idx = _extract_chapter_index_from_filename(f["name"])
            if idx is not None:
                index_map.setdefault(idx, []).append(f["name"])
        dupes = sorted([idx for idx, names in index_map.items() if len(names) > 1])
        return (len(dupes) > 0, dupes)

    def check_chapter_duplicates(self, folder_id: str) -> tuple[bool, list[int]]:
        """Public wrapper — builds the Drive service internally."""
        drive_service = self._build_drive_service()
        return self._check_chapter_duplicates(drive_service, folder_id)

    def _download_cover_image_bytes(self, drive_service: Any, file_id: str) -> bytes:
        """Download the raw bytes of a cover image file from Drive."""
        from googleapiclient.http import MediaIoBaseDownload
        import io

        def _download() -> bytes:
            request = drive_service.files().get_media(fileId=file_id)
            fh = io.BytesIO()
            downloader = MediaIoBaseDownload(fh, request)
            done = False
            while not done:
                _, done = downloader.next_chunk()
            fh.seek(0)
            return fh.read()

        return self._retry_drive_call(_download)

    def _get_file_content(self, drive_service: Any, file_id: str) -> str:
        """
        Download the content of a Drive file.
        For native Google Docs exports a plain-text snippet;
        for regular files downloads the media directly.
        """
        def _get_media() -> str:
            from googleapiclient.http import MediaIoBaseDownload
            import io

            request = drive_service.files().get_media(fileId=file_id)
            fh = io.BytesIO()
            downloader = MediaIoBaseDownload(fh, request)
            done = False
            while not done:
                _, done = downloader.next_chunk()
            fh.seek(0)
            return fh.read().decode("utf-8", errors="replace")

        def _get_meta() -> dict:
            return drive_service.files().get(fileId=file_id, fields="mimeType").execute()

        def _export() -> str:
            from googleapiclient.http import MediaIoBaseDownload
            import io

            request = drive_service.files().export_media(fileId=file_id, mimeType="text/plain")
            fh = io.BytesIO()
            downloader = MediaIoBaseDownload(fh, request)
            done = False
            while not done:
                _, done = downloader.next_chunk()
            fh.seek(0)
            return fh.read().decode("utf-8", errors="replace")

        try:
            mime = self._retry_drive_call(_get_meta).get("mimeType", "")
        except Exception:
            return self._retry_drive_call(_get_media)

        if mime.startswith("application/vnd.google-apps"):
            if "folder" in mime:
                return ""
            try:
                return self._retry_drive_call(_export)
            except Exception:
                return self._retry_drive_call(_get_media)
        return self._retry_drive_call(_get_media)

    def _batch_get_chapter_counts(self, drive_service: Any, folder_ids: list[str]) -> list[Optional[int]]:
        """
        For each folder ID, count all .md chapter files across:
          - Root level of the story folder
          - 'chapters' subfolder
          - 'chapters-extended' subfolder
        """
        if not folder_ids:
            return []

        parents_clause = " or ".join(f'"{fid}" in parents' for fid in folder_ids)
        chapters_sub: dict[str, str] = {}
        page_token: Optional[str] = None
        while True:
            _pt = page_token
            def _call() -> dict:
                return drive_service.files().list(
                    q=f"({parents_clause}) and mimeType='application/vnd.google-apps.folder' "
                    f"and (name='chapters' or name='chapters-extended') and trashed=false",
                    fields="files(id, name, parents)",
                    pageSize=500,
                    pageToken=_pt,
                ).execute()
            try:
                response = self._retry_drive_call(_call)
            except (ssl.SSLError, TimeoutError):
                break
            found_files = response.get("files", [])
            for f in found_files:
                for parent in f.get("parents", []):
                    if parent in folder_ids:
                        chapters_sub[f["id"]] = parent
                        break
            page_token = response.get("nextPageToken")
            if not page_token:
                break

        story_chapters: dict[str, Optional[str]] = {fid: None for fid in folder_ids}
        story_extended: dict[str, Optional[str]] = {fid: None for fid in folder_ids}
        for sub_id, story_id in chapters_sub.items():
            sub_name_lower = next((f.get("name", "").lower() for f in found_files if f["id"] == sub_id), "")
            if sub_name_lower == "chapters-extended":
                story_extended[story_id] = sub_id
            elif sub_name_lower == "chapters":
                story_chapters[story_id] = sub_id

        all_parent_ids = list(chapters_sub.keys()) + folder_ids
        all_parents_clause = " or ".join(f'"{pid}" in parents' for pid in all_parent_ids)

        files_by_parent: dict[str, list[dict]] = {pid: [] for pid in all_parent_ids}
        page_token = None
        while True:
            _pt = page_token
            def _call() -> dict:
                return drive_service.files().list(
                    q=f"({all_parents_clause}) and name contains '.md' and trashed=false",
                    fields="files(id, name, parents)",
                    pageSize=500,
                    pageToken=_pt,
                ).execute()
            try:
                response = self._retry_drive_call(_call)
            except (ssl.SSLError, TimeoutError):
                break
            md_files = [f for f in response.get("files", []) if f.get("name", "").lower().endswith(".md")]
            for f in md_files:
                for parent in f.get("parents", []):
                    if parent in files_by_parent:
                        files_by_parent[parent].append(f)
                        break
            page_token = response.get("nextPageToken")
            if not page_token:
                break

        def _is_chapter_file(name: str) -> bool:
            lower = name.lower()
            if lower in ("tags.md", "title.md", "synopsis.md", "push.md",
                         "blueprint-current.md", "category.md", "voice-profile.md"):
                return False
            if lower.startswith("chapter") or "chapter" in lower:
                return True
            return False

        result: list[Optional[int]] = []
        for folder_id in folder_ids:
            root_chapters = sum(1 for f in files_by_parent.get(folder_id, []) if _is_chapter_file(f.get("name", "")))
            total = (
                root_chapters
                + len(files_by_parent.get(story_chapters.get(folder_id), []))
                + len(files_by_parent.get(story_extended.get(folder_id), []))
            )
            result.append(total if total > 0 else None)
        return result

    def _batch_count_chapters_in_extended(
        self, drive_service: Any, folder_ids: list[str]
    ) -> list[Optional[int]]:
        """For each folder ID, count .md files in the 'chapters-extended' subfolder."""
        if not folder_ids:
            return []

        parents_clause = " or ".join(f'"{fid}" in parents' for fid in folder_ids)
        extended_map: dict[str, str] = {}
        page_token: Optional[str] = None
        while True:
            _pt = page_token
            def _call() -> dict:
                return drive_service.files().list(
                    q=f"({parents_clause}) and mimeType='application/vnd.google-apps.folder' "
                    f"and name='chapters-extended' and trashed=false",
                    fields="files(id, name, parents)",
                    pageSize=500,
                    pageToken=_pt,
                ).execute()
            try:
                response = self._retry_drive_call(_call)
            except (ssl.SSLError, TimeoutError):
                break
            for f in response.get("files", []):
                for parent in f.get("parents", []):
                    if parent in folder_ids:
                        extended_map[f["id"]] = parent
                        break
            page_token = response.get("nextPageToken")
            if not page_token:
                break

        ext_ids = list(extended_map.keys())
        if not ext_ids:
            return [None] * len(folder_ids)

        ext_clause = " or ".join(f'"{eid}" in parents' for eid in ext_ids)
        files_by_ext: dict[str, list[dict]] = {eid: [] for eid in ext_ids}
        page_token = None
        while True:
            _pt = page_token
            def _call() -> dict:
                return drive_service.files().list(
                    q=f"({ext_clause}) and name contains '.md' and trashed=false",
                    fields="files(id, name, parents)",
                    pageSize=500,
                    pageToken=_pt,
                ).execute()
            try:
                response = self._retry_drive_call(_call)
            except (ssl.SSLError, TimeoutError):
                break
            md_files = [f for f in response.get("files", []) if f.get("name", "").lower().endswith(".md")]
            for f in md_files:
                for parent in f.get("parents", []):
                    if parent in files_by_ext:
                        files_by_ext[parent].append(f)
                        break
            page_token = response.get("nextPageToken")
            if not page_token:
                break

        def _is_chapter_file(name: str) -> bool:
            lower = name.lower()
            if lower in ("tags.md", "title.md", "synopsis.md", "push.md",
                         "blueprint-current.md", "category.md", "voice-profile.md"):
                return False
            if lower.startswith("chapter") or "chapter" in lower:
                return True
            return False

        result: list[Optional[int]] = []
        for folder_id in folder_ids:
            ext_id = next((e for e, s in extended_map.items() if s == folder_id), None)
            if ext_id:
                count = sum(1 for f in files_by_ext.get(ext_id, []) if _is_chapter_file(f.get("name", "")))
                result.append(count if count > 0 else None)
            else:
                result.append(None)
        return result

    def _batch_check_duplicates_and_count_extended(
        self,
        drive_service: Any,
        folder_ids: list[str],
        check_extended_only: bool = False,
    ) -> tuple[
        dict[str, tuple[bool, list[int]]],
        dict[str, Optional[int]],
        dict[str, Optional[int]],
        dict[str, Optional[int]],
        dict[str, list[str]],
        dict[str, list[int]],
        dict[str, list[tuple[int, str]]],
    ]:
        """
        Combined duplicate-check + chapter-count in a single pair of Drive API calls.

        For each folder_id returns:
          - duplicates: (has_duplicates, duplicate_indices)
          - ext_count: chapter count from chapters-extended subfolder only
          - chapter_count: total chapter count across ALL subfolders
          - first_chapter_index: the first chapter number found
          - format_errors: filenames in chapters-extended that don't match format
          - sequential_errors: list of missing chapter numbers (gaps)
          - ext_indices: all chapter indices from chapters-extended subfolder
        """
        from api.services.drive_service._parsers import (
            _extract_chapter_index_from_filename,
            _is_valid_chapter_filename,
        )

        dupe_result: dict[str, tuple[bool, list[int]]] = {}
        ext_result: dict[str, Optional[int]] = {}
        chapter_count_result: dict[str, Optional[int]] = {}
        first_chapter_result: dict[str, Optional[int]] = {}
        format_errors: dict[str, list[str]] = {}
        sequential_errors: dict[str, list[int]] = {}
        ext_indices_result: dict[str, list[tuple[int, str]]] = {}

        if not folder_ids:
            return (
                dupe_result, ext_result, chapter_count_result,
                first_chapter_result, format_errors, sequential_errors, ext_indices_result,
            )

        def _is_chapter_file(name: str) -> bool:
            lower = name.lower()
            if lower in ("tags.md", "title.md", "synopsis.md", "push.md",
                         "blueprint-current.md", "category.md", "voice-profile.md"):
                return False
            if lower.startswith("chapter") or "chapter" in lower:
                return True
            return False

        _CHUNK_SIZE = 15
        folder_ids = list(folder_ids)

        chapters_sub: dict[str, tuple[str, str]] = {}

        if check_extended_only:
            for chunk_start in range(0, len(folder_ids), _CHUNK_SIZE):
                chunk = folder_ids[chunk_start: chunk_start + _CHUNK_SIZE]
                parents_clause = " or ".join(f'"{fid}" in parents' for fid in chunk)
                q = (
                    f"({parents_clause}) and mimeType='application/vnd.google-apps.folder' "
                    "and name contains 'chapters-extended' and trashed=false"
                )
                page_token = None
                while True:
                    _pt = page_token
                    def _call() -> dict:
                        return drive_service.files().list(
                            q=q,
                            fields="files(id, name, parents)",
                            pageSize=500,
                            pageToken=_pt,
                        ).execute()
                    try:
                        response = self._retry_drive_call(_call)
                    except (ssl.SSLError, TimeoutError):
                        break
                    for f in response.get("files", []):
                        for parent in f.get("parents", []):
                            if parent in folder_ids:
                                chapters_sub[f["id"]] = (parent, f.get("name", ""))
                                break
                    page_token = response.get("nextPageToken")
                    if not page_token:
                        break
        else:
            for chunk_start in range(0, len(folder_ids), _CHUNK_SIZE):
                chunk = folder_ids[chunk_start: chunk_start + _CHUNK_SIZE]
                parents_clause = " or ".join(f'"{fid}" in parents' for fid in chunk)
                q = (
                    f"({parents_clause}) and mimeType='application/vnd.google-apps.folder' "
                    "and (name='chapters' or name='chapters-extended') and trashed=false"
                )
                page_token = None
                while True:
                    _pt = page_token
                    def _call() -> dict:
                        return drive_service.files().list(
                            q=q,
                            fields="files(id, name, parents)",
                            pageSize=500,
                            pageToken=_pt,
                        ).execute()
                    try:
                        response = self._retry_drive_call(_call)
                    except (ssl.SSLError, TimeoutError):
                        break
                    for f in response.get("files", []):
                        for parent in f.get("parents", []):
                            if parent in folder_ids:
                                chapters_sub[f["id"]] = (parent, f.get("name", ""))
                                break
                    page_token = response.get("nextPageToken")
                    if not page_token:
                        break

        if not chapters_sub:
            dupe_result = {fid: (False, []) for fid in folder_ids}
            ext_result = {fid: 0 for fid in folder_ids}
            chapter_count_result = {fid: 0 for fid in folder_ids}
            first_chapter_result = {fid: None for fid in folder_ids}
            format_errors = {fid: [] for fid in folder_ids}
            sequential_errors = {fid: [] for fid in folder_ids}
            ext_indices_result = {fid: [] for fid in folder_ids}
            return (dupe_result, ext_result, chapter_count_result, first_chapter_result, format_errors, sequential_errors, ext_indices_result)

        files_by_sub: dict[str, list[dict]] = {sid: [] for sid in chapters_sub}
        sub_ids = list(chapters_sub)
        for chunk_start in range(0, len(sub_ids), _CHUNK_SIZE):
            chunk = sub_ids[chunk_start: chunk_start + _CHUNK_SIZE]
            parents_clause = " or ".join(f'"{sid}" in parents' for sid in chunk)
            q = f"({parents_clause}) and name contains '.md' and trashed=false"
            page_token = None
            while True:
                _pt = page_token
                def _call() -> dict:
                    return drive_service.files().list(
                        q=q,
                        fields="files(id, name, parents)",
                        pageSize=500,
                        pageToken=_pt,
                    ).execute()
                try:
                    response = self._retry_drive_call(_call)
                except (ssl.SSLError, TimeoutError):
                    break
                for f in response.get("files", []):
                    if not f.get("name", "").lower().endswith(".md"):
                        continue
                    for parent in f.get("parents", []):
                        if parent in files_by_sub:
                            files_by_sub[parent].append(f)
                            break
                page_token = response.get("nextPageToken")
                if not page_token:
                    break

        empty_sub_ids = [sid for sid, files in files_by_sub.items() if not files]
        if empty_sub_ids:
            for chunk_start in range(0, len(empty_sub_ids), _CHUNK_SIZE):
                chunk = empty_sub_ids[chunk_start: chunk_start + _CHUNK_SIZE]
                parents_clause = " or ".join(f'"{sid}" in parents' for sid in chunk)
                q = f"({parents_clause}) and name contains '.md' and trashed=false"
                page_token = None
                while True:
                    _pt = page_token
                    def _fallback_call() -> dict:
                        return drive_service.files().list(
                            q=q,
                            fields="files(id, name, parents)",
                            pageSize=500,
                            pageToken=_pt,
                        ).execute()
                    try:
                        response = self._retry_drive_call(_fallback_call)
                    except (ssl.SSLError, TimeoutError):
                        break
                    for f in response.get("files", []):
                        if not f.get("name", "").lower().endswith(".md"):
                            continue
                        for parent in f.get("parents", []):
                            if parent in files_by_sub:
                                files_by_sub[parent].append(f)
                                break
                    page_token = response.get("nextPageToken")
                    if not page_token:
                        break

        for folder_id in folder_ids:
            indices: list[int] = []
            ext_count = 0
            indices_extended: list[tuple[int, str]] = []
            for sub_id, (story_id, sub_name) in chapters_sub.items():
                if story_id != folder_id:
                    continue
                files = files_by_sub.get(sub_id, [])
                if sub_name == "chapters-extended":
                    ext_count = sum(1 for f in files if _is_chapter_file(f.get("name", "")))
                    for f in files:
                        fname = f.get("name", "")
                        if fname.lower() in ("tags.md", "title.md", "synopsis.md", "push.md",
                                             "blueprint-current.md", "category.md", "voice-profile.md"):
                            continue
                        if not _is_valid_chapter_filename(fname):
                            format_errors.setdefault(folder_id, []).append(fname)
                            continue
                        idx = _extract_chapter_index_from_filename(fname)
                        if idx is not None:
                            indices_extended.append((idx, fname))
                for f in files:
                    idx = _extract_chapter_index_from_filename(f.get("name", ""))
                    if idx is not None:
                        indices.append(idx)

            seen: set[int] = set()
            dupes: list[int] = []
            for idx in indices:
                if idx in seen and idx not in dupes:
                    dupes.append(idx)
                seen.add(idx)

            dupe_result[folder_id] = (len(dupes) > 0, dupes)
            ext_result[folder_id] = ext_count if ext_count > 0 else None
            chapter_count_result[folder_id] = len(indices) if len(indices) > 0 else None
            first_chapter_result[folder_id] = sorted(indices)[0] if indices else None
            ext_indices_result[folder_id] = indices_extended

            if check_extended_only:
                check_indices = [i[0] for i in indices_extended]
            else:
                check_indices = indices
            if len(check_indices) >= 2:
                sorted_indices = sorted(check_indices)
                first = sorted_indices[0]
                last = sorted_indices[-1]
                full_range = set(range(first, last + 1))
                missing = sorted(full_range - set(sorted_indices))
                sequential_errors[folder_id] = missing

        return (
            dupe_result, ext_result, chapter_count_result,
            first_chapter_result, format_errors, sequential_errors, ext_indices_result,
        )

    def _batch_get_free_and_tag_counts(
        self, drive_service: Any, folder_ids: list[str]
    ) -> tuple[dict[str, bool], dict[str, bool]]:
        """Batch-check which folders have free.md and tags.md files."""
        has_free: dict[str, bool] = {fid: False for fid in folder_ids}
        has_tags: dict[str, bool] = {fid: False for fid in folder_ids}

        if not folder_ids:
            return (has_free, has_tags)

        _CHUNK_SIZE = 15

        for chunk_start in range(0, len(folder_ids), _CHUNK_SIZE):
            chunk = folder_ids[chunk_start: chunk_start + _CHUNK_SIZE]
            parents_clause = " or ".join(f'"{fid}" in parents' for fid in chunk)
            q = (
                f"({parents_clause}) and mimeType!='application/vnd.google-apps.folder' "
                "and (name='free.md' or name='tags.md') and trashed=false"
            )
            page_token = None
            while True:
                _pt = page_token
                def _call() -> dict:
                    return drive_service.files().list(
                        q=q,
                        fields="files(id, name, parents)",
                        pageSize=500,
                        pageToken=_pt,
                    ).execute()
                try:
                    response = self._retry_drive_call(_call)
                except (ssl.SSLError, TimeoutError):
                    break
                for f in response.get("files", []):
                    for parent in f.get("parents", []):
                        if parent in folder_ids:
                            fname = f.get("name", "").lower()
                            if fname == "free.md":
                                has_free[parent] = True
                            elif fname == "tags.md":
                                has_tags[parent] = True
                page_token = response.get("nextPageToken")
                if not page_token:
                    break

        return (has_free, has_tags)


logger = logging.getLogger(__name__)
_SYSTEM_FOLDERS = {".tmp", ".workdir", ".cowork-trash"}
