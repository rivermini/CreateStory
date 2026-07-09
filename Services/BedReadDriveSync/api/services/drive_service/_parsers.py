"""ParsersMixin — folder-name parsing, chapter-file parsing, metadata extraction for DriveSyncService."""

from __future__ import annotations

import re
import ssl
from pathlib import Path
from typing import Any, Optional

from api.services.drive_service._paths import (
    _PLATFORM_TO_ENUM,
    _RE_SOURCE_SUFFIX,
    _RE_STATUS_PREFIX,
    _CATEGORY_MAP,
)


def _extract_chapter_index_from_filename(filename: str) -> Optional[int]:
    """Extract chapter index from a filename like 'Chapter 1 - Title.md'. Returns int or None."""
    stem = Path(filename).stem
    m = re.match(r"^Chapter\s+(\d+)", stem, flags=re.IGNORECASE)
    return int(m.group(1)) if m else None


def _is_valid_chapter_filename(filename: str) -> bool:
    """Returns True if filename follows 'Chapter X - title.md' format."""
    stem = Path(filename).stem
    pattern = r"^Chapter\s+\d+\s*-\s*.+"
    return bool(re.match(pattern, stem, flags=re.IGNORECASE))


def _natural_sort_key(path: str) -> tuple[int | str, ...]:
    """Sort chapter files naturally by extracting numeric indices."""
    stem = Path(path).stem
    numbers = re.findall(r"\d+", stem)
    if numbers:
        return (int(numbers[0]), stem)
    return (0, stem)


class ParsersMixin:
    """
    Mix-in providing all parsing and metadata-extraction logic.

    Adds to DriveSyncService:
      - _extract_story_name, _extract_status, _extract_reference_platform
      - _find_push_file, _parse_push_file
      - _is_valid_chapter_filename, _extract_chapter_index, _parse_chapter_file
      - _find_chapters_extended_folder, _find_synopsis_file, _extract_synopsis_from_content
      - _find_free_md_file, _parse_free_md, _find_metadata_file
      - _parse_tags_file, _parse_category_file
    """

    def _extract_story_name(self, folder_name: str) -> str:
        """Extract the display story name from a Drive folder name."""
        after_prefix = _RE_STATUS_PREFIX.sub("", folder_name)
        dash_pos = after_prefix.find(" - ")
        if dash_pos != -1:
            title_part = after_prefix[dash_pos + 3 :].strip()
        else:
            title_part = after_prefix.strip()
            source_match = _RE_SOURCE_SUFFIX.search(title_part)
            if source_match:
                title_part = title_part[: source_match.start()].strip()
        title = title_part.replace("_", " ")
        while "  " in title:
            title = title.replace("  ", " ")
        return title.strip()

    def _extract_status(self, folder_name: str) -> tuple[str, bool]:
        """Extract status prefix from folder name. Returns (prefix, is_completed)."""
        m = _RE_STATUS_PREFIX.match(folder_name)
        if not m:
            return ("UNKNOWN", False)
        prefix = m.group(1).rstrip("_")
        is_completed = prefix in ("DONE", "EXTENDED")
        return (prefix, is_completed)

    def _extract_reference_platform(self, folder_name: str) -> Optional[str]:
        """Extract the reference platform from a folder name."""
        after_prefix = _RE_STATUS_PREFIX.sub("", folder_name)
        before_dash = after_prefix.split(" - ")[0] if " - " in after_prefix else after_prefix
        match = _RE_SOURCE_SUFFIX.search(before_dash)
        if not match:
            return None
        token = match.group(0).lstrip("_").lower()
        return _PLATFORM_TO_ENUM.get(token)

    def _find_push_file(self, drive_service: Any, parent_id: str) -> Optional[dict]:
        """Find the 'Push.md' file inside a story folder. Returns the file dict or None."""
        results = []
        page_token = None
        while True:
            def _call() -> dict:
                return drive_service.files().list(
                    q=f"'{parent_id}' in parents and mimeType!='application/vnd.google-apps.folder' and name='Push.md' and trashed=false",
                    fields="files(id, name),nextPageToken",
                    pageSize=10,
                    pageToken=page_token,
                ).execute()
            try:
                response = DriveAPIMixin._retry_drive_call(self, _call)
            except (ssl.SSLError, TimeoutError):
                break
            results.extend(response.get("files", []))
            page_token = response.get("nextPageToken")
            if not page_token:
                break
        return results[0] if results else None

    def _parse_push_file(self, content: str) -> tuple[Optional[str], Optional[str]]:
        """Parse a Push.md file and extract notification title and content."""
        title: Optional[str] = None
        notif_content: Optional[str] = None
        for line in content.split("\n"):
            stripped = line.strip().strip("\ufeff")
            if stripped.lower().startswith("title:"):
                title = stripped[6:].strip()
            elif stripped.lower().startswith("content:"):
                notif_content = stripped[8:].strip()
        return (title, notif_content)

    def _is_valid_chapter_filename(self, filename: str) -> bool:
        """Returns True if filename follows 'Chapter X - title.md' format."""
        return _is_valid_chapter_filename(filename)

    def _extract_chapter_index(self, filename: str) -> Optional[int]:
        """Extracts the chapter index from a filename like 'Chapter 1 - Title.md'."""
        return _extract_chapter_index_from_filename(filename)

    def _parse_chapter_file(self, content: str, filename: str) -> tuple[int, str, str]:
        """
        Parse a single chapter .md file.
        Returns (index, title, content).
        """
        content = content.strip()
        if not content:
            return (0, "", "")

        stem = Path(filename).stem

        title = re.sub(
            r"^Chapter\s+\d+(?:-\d+)?\s*[-_]?\s*", "", stem, flags=re.IGNORECASE
        ).strip()
        title = title.replace("_", " ").strip()
        if not title:
            title = stem.replace("_", " ")

        chapter_num = self._extract_chapter_index(filename) or 0

        content = content.replace("\r\n", "\n").replace("\r", "\n")
        content = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", content)
        content = re.sub(r"\*(.+?)\*", r"<em>\1</em>", content)

        html_parts: list[str] = []
        for block in content.split("\n\n"):
            block = block.strip()
            if not block:
                continue
            block = block.replace("\n", "<br>")
            html_parts.append(f"<p>{block}</p>")

        html_content = "".join(html_parts)
        return (chapter_num, title, html_content)

    def _find_chapters_extended_folder(self, drive_service: Any, parent_id: str) -> Optional[dict]:
        """Find the 'chapters-extended' subfolder inside a story folder."""
        page_token = None
        while True:
            def _call() -> dict:
                return drive_service.files().list(
                    q=f"'{parent_id}' in parents and mimeType='application/vnd.google-apps.folder' "
                    f"and name='chapters-extended' and trashed=false",
                    fields="files(id, name),nextPageToken",
                    pageSize=10,
                    pageToken=page_token,
                ).execute()
            try:
                response = DriveAPIMixin._retry_drive_call(self, _call)
            except (ssl.SSLError, TimeoutError):
                break
            files = response.get("files", [])
            if files:
                return files[0]
            page_token = response.get("nextPageToken")
            if not page_token:
                break
        return None

    def _find_synopsis_file(self, drive_service: Any, parent_id: str) -> Optional[dict]:
        """Find 'synopsis.md' inside a story folder."""
        page_token = None
        while True:
            def _call() -> dict:
                return drive_service.files().list(
                    q=f"'{parent_id}' in parents and mimeType!='application/vnd.google-apps.folder' "
                    f"and (name='synopsis.md' or name='Synopsis.md') and trashed=false",
                    fields="files(id, name),nextPageToken",
                    pageSize=10,
                    pageToken=page_token,
                ).execute()
            try:
                response = DriveAPIMixin._retry_drive_call(self, _call)
            except (ssl.SSLError, TimeoutError):
                break
            files = response.get("files", [])
            if files:
                return files[0]
            page_token = response.get("nextPageToken")
            if not page_token:
                break
        return None

    def _extract_synopsis_from_content(self, content: str) -> str:
        """Strip markdown and return the raw synopsis text from a synopsis.md file."""
        lines = []
        in_section = False
        for line in content.split("\n"):
            stripped = line.strip()
            if stripped.lower().startswith("# synopsis"):
                in_section = True
                continue
            if in_section and stripped.startswith("#"):
                break
            if stripped:
                lines.append(stripped)
        return " ".join(lines)

    def _find_cover_image_file(self, drive_service: Any, parent_id: str) -> Optional[dict]:
        """Find 'cover.jpg' (or 'cover.jpeg') inside a story folder."""
        page_token = None
        while True:
            def _call() -> dict:
                return drive_service.files().list(
                    q=f"'{parent_id}' in parents and mimeType!='application/vnd.google-apps.folder' "
                    f"and (name='cover.jpg' or name='cover.jpeg') and trashed=false",
                    fields="files(id, name),nextPageToken",
                    pageSize=10,
                    pageToken=page_token,
                ).execute()
            try:
                response = DriveAPIMixin._retry_drive_call(self, _call)
            except (ssl.SSLError, TimeoutError):
                break
            files = response.get("files", [])
            if files:
                return files[0]
            page_token = response.get("nextPageToken")
            if not page_token:
                break
        return None

    def _find_free_md_file(self, drive_service: Any, parent_id: str) -> Optional[dict]:
        """Find 'free.md' inside a story folder."""
        page_token = None
        while True:
            def _call() -> dict:
                return drive_service.files().list(
                    q=f"'{parent_id}' in parents and mimeType!='application/vnd.google-apps.folder' "
                    f"and name='free.md' and trashed=false",
                    fields="files(id, name),nextPageToken",
                    pageSize=10,
                    pageToken=page_token,
                ).execute()
            try:
                response = DriveAPIMixin._retry_drive_call(self, _call)
            except (ssl.SSLError, TimeoutError):
                break
            files = response.get("files", [])
            if files:
                return files[0]
            page_token = response.get("nextPageToken")
            if not page_token:
                break
        return None

    def _parse_free_md(self, content: str) -> int:
        """Parse free.md: expects a single integer (free chapters count) or 0."""
        try:
            return int(content.strip().split("\n")[0])
        except (ValueError, IndexError):
            return 0

    def _find_metadata_file(self, drive_service: Any, parent_id: str, filename: str) -> Optional[dict]:
        """Find an arbitrary metadata file by name inside a story folder."""
        page_token = None
        while True:
            def _call() -> dict:
                return drive_service.files().list(
                    q=f"'{parent_id}' in parents and mimeType!='application/vnd.google-apps.folder' "
                    f"and name='{filename}' and trashed=false",
                    fields="files(id, name),nextPageToken",
                    pageSize=10,
                    pageToken=page_token,
                ).execute()
            try:
                response = DriveAPIMixin._retry_drive_call(self, _call)
            except (ssl.SSLError, TimeoutError):
                break
            files = response.get("files", [])
            if files:
                return files[0]
            page_token = response.get("nextPageToken")
            if not page_token:
                break
        return None

    def _parse_tags_file(self, drive_service: Any, folder_id: str) -> list[str]:
        """Download and parse tags.md, returning a list of tag strings."""
        tags_file = self._find_metadata_file(drive_service, folder_id, "tags.md")
        if not tags_file:
            return []
        try:
            content = DriveAPIMixin._get_file_content(self, drive_service, tags_file["id"])
        except Exception:
            return []
        tags = []
        for line in content.split("\n"):
            line = line.strip().strip("\ufeff")
            if not line or line.startswith("#"):
                continue
            if "," in line:
                parts = line.split(",")
            else:
                parts = line.split()
            for tag in parts:
                tag = tag.strip().strip('"').strip("'")
                if tag:
                    tags.append(tag)
        return tags

    def _parse_category_file(
        self, drive_service: Any, folder_id: str
    ) -> tuple[Optional[str], Optional[list[str]]]:
        """Download and parse Category.md. Returns (main_category_id, [sub_category_id] or None)."""
        from api.services.drive_service._paths import _CATEGORY_MAP

        category_file = self._find_metadata_file(drive_service, folder_id, "Category.md")
        if not category_file:
            return None, None

        try:
            content = DriveAPIMixin._get_file_content(self, drive_service, category_file["id"])
        except Exception:
            return None, None

        main_name: Optional[str] = None
        sub_name: Optional[str] = None

        for line in content.split("\n"):
            line_stripped = line.strip().strip("\ufeff").lower()
            if not line_stripped or line_stripped.startswith("#"):
                continue
            if line_stripped.startswith("main category:"):
                main_name = line_stripped.split(":", 1)[1].strip()
            elif line_stripped.startswith("sub category:"):
                sub_name = line_stripped.split(":", 1)[1].strip()
            elif main_name is None:
                main_name = line_stripped
            elif sub_name is None:
                sub_name = line_stripped
                break

        main_cat_id: Optional[str] = None
        sub_cat_ids: Optional[list[str]] = None

        main_key = main_name.replace(" ", "").replace("-", "").replace("_", "").replace("+", "") if main_name else None
        if main_key and main_key in _CATEGORY_MAP:
            main_cat_id = _CATEGORY_MAP[main_key][0]

        if sub_name:
            sub_key = sub_name.replace(" ", "").replace("-", "").replace("_", "").replace("+", "")
            combined_key = (main_key or "") + sub_key
            combined_match = _CATEGORY_MAP.get(combined_key)
            if combined_match and combined_match[1]:
                sub_cat_ids = [combined_match[1]]
            else:
                sub_match = _CATEGORY_MAP.get(sub_key)
                if sub_match:
                    sub_cat_ids = [sub_match[0]]
                elif main_cat_id:
                    sub_cat_ids = [main_cat_id]

        if main_cat_id is None:
            logger.warning(f"Unknown main category '{main_name}' in Category.md — using default")

        return main_cat_id, sub_cat_ids

    def _parse_max_chapter_file(
        self, drive_service: Any, folder_id: str, display_name: str, job_id: Optional[str] = None
    ) -> Optional[int]:
        """
        Find and parse 'max_chapter.md' inside a story folder.
        If null -> send nothing (report to log).
        If exist use that number (number only, if it contains non-numeric text, report to log).
        """
        max_chapter_file = self._find_metadata_file(drive_service, folder_id, "max_chapter.md")
        if not max_chapter_file:
            self._append_log("info", "max_chapter.md not found — maxChapter will not be set/updated", display_name, job_id=job_id)
            return None

        try:
            content = DriveAPIMixin._get_file_content(self, drive_service, max_chapter_file["id"])
        except Exception as exc:
            self._append_log("warning", f"Failed to read max_chapter.md: {exc}", display_name, job_id=job_id)
            return None

        stripped = content.strip().strip("\ufeff")
        if not stripped:
            self._append_log("info", "max_chapter.md is empty — maxChapter will not be set/updated", display_name, job_id=job_id)
            return None

        if re.search(r"\D", stripped):
            self._append_log("warning", f"max_chapter.md contains non-numeric text: {stripped!r}", display_name, job_id=job_id)
            digit_match = re.search(r"\d+", stripped)
            if digit_match:
                return int(digit_match.group(0))
            return None

        try:
            return int(stripped)
        except ValueError:
            self._append_log("warning", f"max_chapter.md contains invalid integer: {stripped!r}", display_name, job_id=job_id)
            return None

    def _parse_length_file(
        self, drive_service: Any, folder_id: str, display_name: str, job_id: Optional[str] = None
    ) -> Optional[str]:
        """
        Find and parse 'length.md' inside a story folder.
        Returns normalized "long"/"short", or None if the file is missing,
        empty, or contains an unrecognized value (reported to the log).
        """
        length_file = self._find_metadata_file(drive_service, folder_id, "length.md")
        if not length_file:
            self._append_log("info", "length.md not found — length will not be set/updated", display_name, job_id=job_id)
            return None

        try:
            content = DriveAPIMixin._get_file_content(self, drive_service, length_file["id"])
        except Exception as exc:
            self._append_log("warning", f"Failed to read length.md: {exc}", display_name, job_id=job_id)
            return None

        stripped = content.strip().strip("﻿")
        if not stripped:
            self._append_log("info", "length.md is empty — length will not be set/updated", display_name, job_id=job_id)
            return None

        value = stripped.split("\n")[0].strip().lower()
        if value in ("long", "short"):
            return value

        self._append_log("warning", f"length.md contains unrecognized value: {stripped!r}", display_name, job_id=job_id)
        return None



from api.services.drive_service._drive_api import DriveAPIMixin
import logging

logger = logging.getLogger(__name__)
