"""MainBEClientMixin — main BE API client (story/chapter POST/GET) for DriveSyncService."""

from __future__ import annotations

import json
import logging
import html
import re
import time
from datetime import datetime, timezone
from typing import Any, Optional

import httpx

logger = logging.getLogger(__name__)


class MainBEClientMixin:
    """
    Mix-in providing the main BE API client.

    Adds to DriveSyncService:
      - _append_log
      - _post_story, _find_story_by_title, _json_body
      - _post_chapter, _get_existing_chapter_indices, _get_existing_chapter_count
      - _sync_new_chapters_from_extended_folder
      - get_all_server_stories, put_story_max_chapter, put_story_metadata
      - _upload_cover_image
      - get_stories_needing_update
    """

    def _append_log(self, level: str, message: str, story_name: Optional[str] = None, job_id: Optional[str] = None) -> None:
        from api.models.drive_sync import DriveSyncLogEntry

        entry = DriveSyncLogEntry(
            timestamp=datetime.now(timezone.utc).isoformat(),
            level=level,
            message=message,
            story_name=story_name,
        )
        self._current_log.append(entry)
        if job_id is not None:
            self.append_job_log(job_id, level, message)

    def _post_story(
        self,
        title: str,
        synopsis: str,
        is_completed: bool,
        author_id: str,
        main_category_id: Optional[str] = None,
        sub_category_ids: Optional[list[str]] = None,
        tags: Optional[list[str]] = None,
        reference_platform: Optional[str] = None,
        notification_config: Optional[dict] = None,
        free_chapters_count: int = 0,
        job_id: Optional[str] = None,
    ) -> Optional[str]:
        """POST to main BE /api/v1/story/. Returns storyId on success."""
        if self._config is None:
            return None
        url = f"{self._config.main_be_api_base_url}/api/v1/story/"
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self._config.main_be_bearer_token}",
            "x-user-id": self._config.main_be_user_id,
        }
        payload = {
            "title": title,
            "synopsis": synopsis or "",
            "type": "novel",
            "authorId": author_id,
            "mainCategoryId": main_category_id or self._config.main_category_id,
            "visibility": "public",
            "canEdit": False,
            "isCompleted": False,
            "isLicensed": True,
            "targetAudiences": ["all"],
            "freeChaptersCount": free_chapters_count,
        }
        if sub_category_ids:
            payload["subCategoryIds"] = sub_category_ids
        if tags:
            payload["tags"] = tags
        if reference_platform:
            payload["referencePlatform"] = reference_platform
        if notification_config:
            payload["notificationConfig"] = notification_config
        self._append_log("info", f"Story POST payload: {payload}", title)
        if job_id:
            self.append_job_log(job_id, "info", f"Story POST payload: {payload}")
        try:
            with httpx.Client(timeout=30.0) as client:
                resp = client.post(url, content=self._json_body(payload), headers=headers)
                if resp.status_code in (200, 201):
                    data = resp.json()
                    if data.get("success"):
                        story_id = data.get("data", {}).get("id")
                        self._append_log("info", f"Story created: {title} (id={story_id})", title)
                        return story_id
                    else:
                        err_msg = data.get("message") or "unknown error"
                        self._append_log("error", f"Story creation failed: {err_msg}", title, job_id)
                elif resp.status_code == 400:
                    resp_data = resp.json()
                    msg = resp_data.get("message", "")
                    if "already exists" in msg.lower() or "duplicate" in msg.lower():
                        existing_id = None
                        if isinstance(resp_data.get("data"), dict):
                            existing_id = resp_data["data"].get("existingId")
                        if not existing_id:
                            existing_id = self._find_story_by_title(title)
                        if existing_id:
                            self._append_log("info", f"Story already exists: {title} (id={existing_id}), syncing chapters", title)
                            return existing_id
                        else:
                            self._append_log("error", f"Story '{title}' reported as duplicate but not found", title)
                    else:
                        self._append_log("error", f"Story POST failed {resp.status_code}: {resp.text[:200]}", title, job_id)
                else:
                    self._append_log("error", f"Story POST failed {resp.status_code}: {resp.text[:200]}", title, job_id)
        except Exception as exc:
            self._append_log("error", f"Story POST exception: {exc}", title, job_id)
        return None

    def _find_story_by_title(self, title: str) -> Optional[str]:
        """Look up a story by title via the main BE list API."""
        if self._config is None:
            return None
        if not self._config.main_be_bearer_token:
            self._append_log("error", "main_be_bearer_token is not set", title)
            return None
        target = title.strip().lower()
        headers = {
            "Authorization": f"Bearer {self._config.main_be_bearer_token}",
            "x-user-id": self._config.main_be_user_id,
        }
        page = 1
        try:
            while True:
                with httpx.Client(timeout=30.0) as client:
                    resp = client.get(
                        f"{self._config.main_be_api_base_url}/api/v1/story",
                        headers=headers,
                        params={"page": page, "limit": 100},
                    )
                    if resp.status_code not in (200, 201):
                        self._append_log("debug", f"_find_story_by_title: page {page} returned {resp.status_code}", title)
                        break
                    data = resp.json()
                    items = data.get("data", {}).get("items", [])
                    if not items:
                        break
                    for story in items:
                        if story.get("title", "").strip().lower() == target:
                            found_id = story.get("id")
                            self._append_log("info", f"_find_story_by_title: found '{title}' at id={found_id}", title)
                            return found_id
                    page += 1
        except Exception as exc:
            self._append_log("error", f"_find_story_by_title({title!r}) exception: {exc}", title)
        self._append_log("debug", f"_find_story_by_title({title!r}) returned None", title)
        return None

    @staticmethod
    def _json_body(payload: dict) -> bytes:
        """Serialize a dict to UTF-8 JSON with Unicode characters preserved."""
        return json.dumps(payload, ensure_ascii=False).encode("utf-8")

    def _main_be_headers(self, include_content_type: bool = False) -> dict[str, str]:
        """Build headers for the configured main BE API."""
        if self._config is None:
            raise RuntimeError("Drive sync config not set.")
        headers = {
            "Authorization": f"Bearer {self._config.main_be_bearer_token}",
            "x-user-id": self._config.main_be_user_id or "",
        }
        if include_content_type:
            headers["Content-Type"] = "application/json"
        return headers

    @staticmethod
    def _unwrap_api_data(body: Any) -> Any:
        """Return the useful data payload from common API response envelopes."""
        if isinstance(body, dict) and "data" in body:
            return body.get("data")
        return body

    @classmethod
    def _extract_api_items(cls, body: Any) -> list[Any]:
        """Extract a list from common paginated/list API response shapes."""
        data = cls._unwrap_api_data(body)
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            for key in ("items", "stories", "chapters", "results", "data"):
                value = data.get(key)
                if isinstance(value, list):
                    return value
            if data.get("id"):
                return [data]
        return []

    @staticmethod
    def _story_ref_from_api(story: dict) -> dict:
        """Coerce a story payload into the frontend's ServerStoryRef shape."""
        max_chapter = (
            story.get("maxChapter")
            or story.get("chapterCount")
            or story.get("totalChapters")
            or story.get("chaptersCount")
            or 0
        )
        try:
            max_chapter = int(max_chapter)
        except Exception:
            max_chapter = 0
        return {
            "id": str(story.get("id") or story.get("storyId") or ""),
            "title": str(story.get("title") or story.get("name") or ""),
            "maxChapter": max_chapter,
        }

    @staticmethod
    def _normalize_story_title(title: str) -> str:
        """Normalize a story title for exact matching."""
        for ch in ("\u2019", "\u2018", "\u201A", "\u201B", "\u02BC", "\u02BB", "\uFF07"):
            title = title.replace(ch, "'")
        return re.sub(r"\s+", " ", title).strip().lower()

    @staticmethod
    def _plain_text_from_html_or_text(value: str) -> str:
        """Convert simple HTML or text into comparable plain text."""
        value = html.unescape(value or "")
        value = re.sub(r"<\s*br\s*/?\s*>", "\n", value, flags=re.IGNORECASE)
        value = re.sub(r"</\s*p\s*>", "\n", value, flags=re.IGNORECASE)
        value = re.sub(r"<[^>]+>", "", value)
        return value

    @classmethod
    def _normalize_chapter_text(cls, value: str) -> str:
        """Normalize chapter text for equality checks while ignoring whitespace noise."""
        value = cls._plain_text_from_html_or_text(value)
        value = value.replace("\ufeff", "").replace("\r\n", "\n").replace("\r", "\n")
        value = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", value)
        lines = [re.sub(r"[ \t]+", " ", line).strip() for line in value.split("\n")]
        lines = [line for line in lines if line]
        return "\n".join(lines)

    @staticmethod
    def _plain_content_from_markdown(content: str) -> str:
        """Build a main-BE plainContent value from a Drive markdown chapter."""
        content = (content or "").strip().replace("\ufeff", "")
        content = content.replace("\r\n", "\n").replace("\r", "\n")
        content = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", content)
        content = re.sub(r"\*\*(.+?)\*\*", r"\1", content)
        content = re.sub(r"\*(.+?)\*", r"\1", content)
        blocks: list[str] = []
        for block in re.split(r"\n\s*\n+", content):
            lines = [line.strip() for line in block.split("\n") if line.strip()]
            if lines:
                blocks.append("\n".join(lines))
        return "\n".join(blocks)

    def search_server_stories(self, keyword: str) -> list[dict]:
        """Search stories on the configured main BE using api/v1/story/?keyword=."""
        if self._config is None:
            raise RuntimeError("Drive sync config not set.")
        keyword = keyword.strip()
        if not keyword:
            return []
        url = f"{self._config.main_be_api_base_url.rstrip('/')}/api/v1/story/"
        headers = self._main_be_headers()
        params = {"keyword": keyword, "page": 1, "limit": 20}
        with httpx.Client(timeout=30.0) as client:
            resp = client.get(url, headers=headers, params=params)
            if resp.status_code == 401:
                raise RuntimeError("Unauthorized: Invalid or expired bearer token (401). Please check your Bearer Token in the Drive Sync configuration.")
            if resp.status_code not in (200, 201):
                raise RuntimeError(f"Story search failed HTTP {resp.status_code}: {resp.text[:200]}")
            items = self._extract_api_items(resp.json())
        return [self._story_ref_from_api(item) for item in items if isinstance(item, dict) and (item.get("id") or item.get("storyId"))]

    def get_server_story_detail(self, story_id: str) -> dict:
        """Fetch one story from the configured main BE."""
        if self._config is None:
            raise RuntimeError("Drive sync config not set.")
        url = f"{self._config.main_be_api_base_url.rstrip('/')}/api/v1/story/{story_id}"
        with httpx.Client(timeout=30.0) as client:
            resp = client.get(url, headers=self._main_be_headers())
            if resp.status_code == 401:
                raise RuntimeError("Unauthorized: Invalid or expired bearer token (401). Please check your Bearer Token in the Drive Sync configuration.")
            if resp.status_code not in (200, 201):
                raise RuntimeError(f"Story detail failed HTTP {resp.status_code}: {resp.text[:200]}")
            data = self._unwrap_api_data(resp.json())
        if not isinstance(data, dict):
            raise RuntimeError("Story detail response did not contain a story object.")
        return self._story_ref_from_api(data)

    def get_server_chapter_numbers(self, story_id: str, max_chapter: int = 0) -> list[int]:
        """Fetch chapter numbers for a server story."""
        if self._config is None:
            raise RuntimeError("Drive sync config not set.")
        url = f"{self._config.main_be_api_base_url.rstrip('/')}/api/v1/story/{story_id}/chapter"
        numbers: list[int] = []
        with httpx.Client(timeout=30.0) as client:
            resp = client.get(url, headers=self._main_be_headers())
            if resp.status_code == 401:
                raise RuntimeError("Unauthorized: Invalid or expired bearer token (401). Please check your Bearer Token in the Drive Sync configuration.")
            if resp.status_code not in (200, 201):
                raise RuntimeError(f"Chapter list failed HTTP {resp.status_code}: {resp.text[:200]}")
            items = self._extract_api_items(resp.json())
        for item in items:
            raw = item
            if isinstance(item, dict):
                raw = (
                    item.get("index")
                    or item.get("chapterNumber")
                    or item.get("chapter_number")
                    or item.get("number")
                )
            try:
                n = int(raw)
            except Exception:
                continue
            if n > 0:
                numbers.append(n)
        if not numbers and max_chapter > 0:
            numbers = list(range(1, max_chapter + 1))
        return sorted(set(numbers))

    def get_server_chapter_detail(self, story_id: str, chapter_number: int) -> dict:
        """Fetch one chapter detail from the configured main BE."""
        if self._config is None:
            raise RuntimeError("Drive sync config not set.")
        url = f"{self._config.main_be_api_base_url.rstrip('/')}/api/v1/story/{story_id}/chapter/{chapter_number}"
        with httpx.Client(timeout=30.0) as client:
            resp = client.get(url, headers=self._main_be_headers())
            if resp.status_code == 401:
                raise RuntimeError("Unauthorized: Invalid or expired bearer token (401). Please check your Bearer Token in the Drive Sync configuration.")
            if resp.status_code not in (200, 201):
                raise RuntimeError(f"Chapter {chapter_number} detail failed HTTP {resp.status_code}: {resp.text[:200]}")
            data = self._unwrap_api_data(resp.json())
        if not isinstance(data, dict):
            raise RuntimeError(f"Chapter {chapter_number} response did not contain a chapter object.")
        return data

    def put_server_chapter_content(self, story_id: str, chapter_number: int, title: str, content: str, plain_content: str) -> bool:
        """PUT index/title/content/plainContent for one chapter on the configured main BE."""
        if self._config is None:
            raise RuntimeError("Drive sync config not set.")
        url = f"{self._config.main_be_api_base_url.rstrip('/')}/api/v1/story/{story_id}/chapter/{chapter_number}"
        payload = {
            "index": chapter_number,
            "title": title,
            "content": content,
            "plainContent": plain_content,
        }
        with httpx.Client(timeout=30.0) as client:
            resp = client.put(url, content=self._json_body(payload), headers=self._main_be_headers(include_content_type=True))
            if resp.status_code == 401:
                raise RuntimeError("Unauthorized: Invalid or expired bearer token (401). Please check your Bearer Token in the Drive Sync configuration.")
            if resp.status_code not in (200, 201):
                raise RuntimeError(f"Chapter {chapter_number} update failed HTTP {resp.status_code}: {resp.text[:300]}")
        return True

    def find_extended_drive_folder_for_story(self, title: str) -> Optional[dict]:
        """Find the EXTENDED_ Drive folder whose display name exactly matches a story title."""
        target = self._normalize_story_title(title)
        folders, _ = self.list_drive_folders(limit=10000, offset=0)
        for folder in folders:
            if folder.get("prefix") == "EXTENDED" and self._normalize_story_title(folder.get("display_name", "")) == target:
                return folder
        return None

    def find_drive_folder_by_name(self, folder_name: str) -> Optional[dict]:
        """Find a Drive story folder by its pasted folder name."""
        target = self._normalize_story_title(folder_name)
        folders, _ = self.list_drive_folders(limit=10000, offset=0)
        for folder in folders:
            if self._normalize_story_title(folder.get("name", "")) == target:
                return folder
        for folder in folders:
            if self._normalize_story_title(folder.get("display_name", "")) == target:
                return folder
        return None

    def find_server_story_by_title_exact(self, title: str) -> Optional[dict]:
        """Find a main-BE story whose title exactly matches the parsed Drive story title."""
        target = self._normalize_story_title(title)
        for story in self.search_server_stories(title):
            if self._normalize_story_title(story.get("title", "")) == target:
                return story
        return None

    def get_drive_extended_chapters(self, folder_id: str) -> dict[int, dict]:
        """Download and parse chapters from a story folder's chapters-extended subfolder."""
        if self._config is None:
            raise RuntimeError("Drive sync config not set.")
        drive_service = self._build_drive_service()
        chapters_ext = self._find_chapters_extended_folder(drive_service, folder_id)
        if not chapters_ext:
            raise RuntimeError("No chapters-extended subfolder found for this Drive folder.")

        files = self._list_files_in_folder(drive_service, chapters_ext["id"])
        md_files = [f for f in files if f.get("name", "").lower().endswith(".md")]
        chapters: dict[int, dict] = {}
        for file_info in sorted(md_files, key=lambda f: f.get("name", "")):
            filename = file_info.get("name", "")
            chapter_number = self._extract_chapter_index(filename)
            if chapter_number is None:
                continue
            raw_content = self._get_file_content(drive_service, file_info["id"])
            _, title, html_content = self._parse_chapter_file(raw_content, filename)
            plain_content = self._plain_content_from_markdown(raw_content)
            chapters[chapter_number] = {
                "chapterNumber": chapter_number,
                "title": title,
                "fileName": filename,
                "content": html_content,
                "plainContent": plain_content,
                "plainLength": len(plain_content),
                "normalizedPlainContent": self._normalize_chapter_text(plain_content),
            }
        return chapters

    def list_drive_extended_chapter_files(self, folder_id: str) -> list[dict]:
        """List chapter files in chapters-extended without downloading their content."""
        if self._config is None:
            raise RuntimeError("Drive sync config not set.")
        drive_service = self._build_drive_service()
        chapters_ext = self._find_chapters_extended_folder(drive_service, folder_id)
        if not chapters_ext:
            raise RuntimeError("No chapters-extended subfolder found for this Drive folder.")

        files = self._list_files_in_folder(drive_service, chapters_ext["id"])
        md_files = [f for f in files if f.get("name", "").lower().endswith(".md")]
        chapters: list[dict] = []
        for file_info in sorted(md_files, key=lambda f: self._extract_chapter_index(f.get("name", "")) or 0):
            filename = file_info.get("name", "")
            chapter_number = self._extract_chapter_index(filename)
            if chapter_number is None:
                continue
            title = re.sub(
                r"^Chapter\s+\d+(?:-\d+)?\s*[-_]?\s*", "", filename.rsplit(".", 1)[0], flags=re.IGNORECASE
            ).strip().replace("_", " ")
            chapters.append({
                "chapterNumber": chapter_number,
                "title": title or filename,
                "status": "ready",
                "fileName": filename,
                "serverLength": 0,
                "driveLength": 0,
                "message": None,
            })
        return chapters

    def inspect_drive_folder_for_content_update(self, folder_name: str) -> dict:
        """Resolve a pasted Drive folder name, matching server story, and list updateable Drive chapters."""
        folder = self.find_drive_folder_by_name(folder_name)
        if folder is None:
            return {
                "found": False,
                "story": None,
                "folder": None,
                "chapters": [],
                "summary": {"total": 0, "same": 0, "different": 0, "missingDrive": 0, "driveOnly": 0, "errors": 0},
                "message": "Drive folder not found.",
            }

        story_title = folder.get("display_name") or self._extract_story_name(folder.get("name", ""))
        story = self.find_server_story_by_title_exact(story_title)
        if story is None:
            return {
                "found": False,
                "story": None,
                "folder": folder,
                "chapters": [],
                "summary": {"total": 0, "same": 0, "different": 0, "missingDrive": 0, "driveOnly": 0, "errors": 0},
                "message": f"Drive folder found, but story '{story_title}' was not found on the server.",
            }

        try:
            chapters = self.list_drive_extended_chapter_files(folder["id"])
        except Exception as exc:
            return {
                "found": False,
                "story": story,
                "folder": folder,
                "chapters": [],
                "summary": {"total": 0, "same": 0, "different": 0, "missingDrive": 0, "driveOnly": 0, "errors": 1},
                "message": str(exc),
            }

        return {
            "found": True,
            "story": story,
            "folder": folder,
            "chapters": chapters,
            "summary": {
                "total": len(chapters),
                "same": 0,
                "different": len(chapters),
                "missingDrive": 0,
                "driveOnly": 0,
                "errors": 0,
            },
            "message": "Folder and server story found.",
        }

    def scan_server_story_against_drive(self, story_id: str, story_title: Optional[str] = None) -> dict:
        """Compare server chapter details against Drive chapters-extended files."""
        story = self.get_server_story_detail(story_id)
        if story_title:
            story["title"] = story_title
        folder = self.find_extended_drive_folder_for_story(story["title"])
        if folder is None:
            return {
                "story": story,
                "folder": None,
                "chapters": [],
                "summary": {"total": 0, "same": 0, "different": 0, "missingDrive": 0, "driveOnly": 0, "errors": 0},
                "message": "No matching EXTENDED_ Drive folder found.",
            }

        drive_chapters = self.get_drive_extended_chapters(folder["id"])
        server_numbers = self.get_server_chapter_numbers(story_id, story.get("maxChapter") or 0)
        chapters: list[dict] = []
        summary = {"total": len(server_numbers), "same": 0, "different": 0, "missingDrive": 0, "driveOnly": 0, "errors": 0}

        for chapter_number in server_numbers:
            drive_chapter = drive_chapters.get(chapter_number)
            if drive_chapter is None:
                summary["missingDrive"] += 1
                chapters.append({
                    "chapterNumber": chapter_number,
                    "title": "",
                    "status": "missing_drive",
                    "fileName": None,
                    "serverLength": 0,
                    "driveLength": 0,
                    "message": "No matching Drive chapter file.",
                })
                continue

            try:
                server_chapter = self.get_server_chapter_detail(story_id, chapter_number)
                server_plain = server_chapter.get("plainContent") or self._plain_text_from_html_or_text(server_chapter.get("content", ""))
                server_normalized = self._normalize_chapter_text(server_plain)
                same = server_normalized == drive_chapter["normalizedPlainContent"]
                status = "same" if same else "different"
                summary[status] += 1
                chapters.append({
                    "chapterNumber": chapter_number,
                    "title": str(server_chapter.get("title") or drive_chapter.get("title") or ""),
                    "status": status,
                    "fileName": drive_chapter["fileName"],
                    "serverLength": len(server_plain or ""),
                    "driveLength": drive_chapter["plainLength"],
                    "message": None,
                })
            except Exception as exc:
                summary["errors"] += 1
                chapters.append({
                    "chapterNumber": chapter_number,
                    "title": drive_chapter.get("title") or "",
                    "status": "error",
                    "fileName": drive_chapter["fileName"],
                    "serverLength": 0,
                    "driveLength": drive_chapter["plainLength"],
                    "message": str(exc),
                })

        server_number_set = set(server_numbers)
        for chapter_number, drive_chapter in sorted(drive_chapters.items()):
            if chapter_number in server_number_set:
                continue
            summary["driveOnly"] += 1
            chapters.append({
                "chapterNumber": chapter_number,
                "title": drive_chapter.get("title") or "",
                "status": "drive_only",
                "fileName": drive_chapter["fileName"],
                "serverLength": 0,
                "driveLength": drive_chapter["plainLength"],
                "message": "Drive chapter has no matching server chapter.",
            })

        chapters.sort(key=lambda item: item["chapterNumber"])
        return {
            "story": story,
            "folder": folder,
            "chapters": chapters,
            "summary": summary,
            "message": "Scan complete.",
        }

    def update_server_chapter_from_drive(self, story_id: str, chapter_number: int, folder_id: str) -> dict:
        """Replace one server chapter's content from its matching Drive chapter file."""
        drive_chapters = self.get_drive_extended_chapters(folder_id)
        drive_chapter = drive_chapters.get(chapter_number)
        if drive_chapter is None:
            raise RuntimeError(f"Chapter {chapter_number} was not found in chapters-extended.")
        self.put_server_chapter_content(
            story_id,
            chapter_number,
            drive_chapter["title"],
            drive_chapter["content"],
            drive_chapter["plainContent"],
        )
        return drive_chapter

    def _post_chapter(self, story_id: str, index: int, title: str, content: str, max_retries: int = 3) -> bool:
        """POST a chapter to main BE /api/v1/story/{id}/chapter. Returns True on success."""
        if self._config is None:
            return False
        url = f"{self._config.main_be_api_base_url}/api/v1/story/{story_id}/chapter"
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self._config.main_be_bearer_token}",
            "x-user-id": self._config.main_be_user_id,
        }
        payload = {"index": index, "title": title, "content": content}

        def _attempt(attempt_num: int) -> tuple[bool, str]:
            try:
                with httpx.Client(timeout=30.0) as client:
                    resp = client.post(url, content=self._json_body(payload), headers=headers)
                    if resp.status_code in (200, 201):
                        return True, ""
                    body = {}
                    try:
                        body = resp.json()
                    except Exception:
                        pass
                    err_code = body.get("code", 0)
                    err_msg = body.get("message", "")
                    resp_text = resp.text[:500]
                    self._append_log(
                        "debug",
                        f"Chapter {index} non-2xx: status={resp.status_code} body={resp_text!r}",
                        title,
                    )
                    is_transient = (
                        resp.status_code >= 500
                        or resp.status_code == 429
                        or "timeout" in err_msg.lower()
                        or "connection" in err_msg.lower()
                        or "too many requests" in err_msg.lower()
                    )
                    if is_transient:
                        return False, ""
                    return False, f"{resp.status_code}:{err_code}:{err_msg}"
            except Exception as exc:
                return False, str(exc)

        for attempt in range(max_retries):
            ok, err = _attempt(attempt)
            if ok:
                return True
            if err:
                self._append_log("warning", f"Chapter {index} POST failed (attempt {attempt + 1}/{max_retries}): {err}", title)
                if attempt < max_retries - 1:
                    wait = 2 ** attempt
                    self._append_log("info", f"Retrying in {wait}s...", title)
                    time.sleep(wait)

        self._append_log("warning", f"Chapter {index} POST failed after {max_retries} retries.", title)
        return False

    def _get_existing_chapter_indices(self, story_id: str) -> set[int]:
        """GET /api/v1/story/{id}/chapter and return the set of existing chapter indices."""
        if self._config is None:
            return set()
        url = f"{self._config.main_be_api_base_url}/api/v1/story/{story_id}/chapter"
        headers = {
            "Authorization": f"Bearer {self._config.main_be_bearer_token}",
            "x-user-id": self._config.main_be_user_id,
        }
        try:
            with httpx.Client(timeout=30.0) as client:
                resp = client.get(url, headers=headers)
                if resp.status_code in (200, 201):
                    data = resp.json()
                    chapters = data.get("data", []) if isinstance(data, dict) else (data if isinstance(data, list) else [])
                    indices = {ch.get("index") for ch in chapters if ch.get("index") is not None}
                    self._append_log("debug", f"GET chapters for {story_id[:8]}... returned {len(chapters)} chapters")
                    return indices
                else:
                    self._append_log("debug", f"GET chapters for {story_id[:8]}... failed {resp.status_code}")
        except Exception as exc:
            self._append_log("debug", f"GET chapters for {story_id[:8]}... exception: {exc}")
        return set()

    def _get_existing_chapter_count(self, story_id: str) -> int:
        """GET /api/v1/story/{id} and return the current chapter count."""
        if self._config is None:
            return 0
        url = f"{self._config.main_be_api_base_url}/api/v1/story/{story_id}"
        headers = {
            "Authorization": f"Bearer {self._config.main_be_bearer_token}",
            "x-user-id": self._config.main_be_user_id,
        }
        try:
            with httpx.Client(timeout=30.0) as client:
                resp = client.get(url, headers=headers)
                if resp.status_code in (200, 201):
                    data = resp.json()
                    return data.get("data", {}).get("chapterCount") or len(data.get("data", {}).get("chapters", []))
        except Exception:
            pass
        return 0

    def get_all_server_stories(self) -> list[dict]:
        """
        Fetch ALL stories from the main BE via pagination.
        Returns {id, title, maxChapter} for every story. Cached for 30 seconds.
        """
        cached = self._get_cached_server_stories(ttl=30.0)
        if cached is not None:
            return cached

        if self._config is None:
            raise RuntimeError("Drive sync config not set.")

        headers = {
            "Authorization": f"Bearer {self._config.main_be_bearer_token}",
            "x-user-id": self._config.main_be_user_id,
        }
        all_stories: list[dict] = []
        page = 1
        try:
            while True:
                with httpx.Client(timeout=30.0) as client:
                    resp = client.get(
                        f"{self._config.main_be_api_base_url}/api/v1/story",
                        headers=headers,
                        params={"page": page, "limit": 100},
                    )
                    if resp.status_code == 401:
                        raise RuntimeError("Unauthorized: Invalid or expired bearer token (401). Please check your Bearer Token in the Drive Sync configuration.")
                    if resp.status_code not in (200, 201):
                        logger.warning("get_all_server_stories page %d returned %d", page, resp.status_code)
                        break
                    data = resp.json()
                    items = data.get("data", {}).get("items", [])
                    if not items:
                        break
                    for story in items:
                        all_stories.append({
                            "id": story.get("id"),
                            "title": story.get("title"),
                            "maxChapter": story.get("maxChapter") or story.get("chapterCount") or 0,
                        })
                    page += 1
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 401:
                raise RuntimeError("Unauthorized: Invalid or expired bearer token (401). Please check your Bearer Token in the Drive Sync configuration.")
            raise

        self._set_cached_server_stories(all_stories)
        return all_stories

    def put_story_max_chapter(self, story_id: str, max_chapter: int) -> bool:
        """PUT maxChapter on a server story via the main BE API."""
        if self._config is None:
            return False
        url = f"{self._config.main_be_api_base_url}/api/v1/story/{story_id}"
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self._config.main_be_bearer_token}",
            "x-user-id": self._config.main_be_user_id,
        }
        payload = {"maxChapter": max_chapter}
        try:
            with httpx.Client(timeout=30.0) as client:
                resp = client.put(url, content=self._json_body(payload), headers=headers)
                return resp.status_code in (200, 201)
        except Exception:
            return False

    def put_story_metadata(
        self,
        story_id: str,
        max_chapter: Optional[int] = None,
        free_chapters_count: Optional[int] = None,
        tags: Optional[list[str]] = None,
    ) -> tuple[bool, Optional[str]]:
        """PUT story metadata (freeChaptersCount, maxChapter, and/or tags) on the main BE.
        Returns (success, error_detail). error_detail is None on success."""
        if self._config is None:
            return (False, "Backend client not configured")
        url = f"{self._config.main_be_api_base_url}/api/v1/story/{story_id}"
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self._config.main_be_bearer_token}",
            "x-user-id": self._config.main_be_user_id,
        }
        payload: dict[str, Any] = {}
        if max_chapter is not None:
            payload["maxChapter"] = max_chapter
        if free_chapters_count is not None:
            payload["freeChaptersCount"] = free_chapters_count
        if tags is not None:
            payload["tags"] = tags
        if not payload:
            return (True, None)
        try:
            with httpx.Client(timeout=30.0) as client:
                resp = client.put(url, content=self._json_body(payload), headers=headers)
                if resp.status_code in (200, 201):
                    self._append_log("info", f"Story metadata updated: freeChaptersCount={free_chapters_count}, maxChapter={max_chapter}")
                    return (True, None)
                detail = f"HTTP {resp.status_code}: {resp.text[:200]}"
                self._append_log("warning", f"Story metadata PUT failed {detail}")
                return (False, detail)
        except Exception as exc:
            detail = str(exc)
            self._append_log("error", f"Story metadata PUT exception: {exc}")
            return (False, detail)

    def _sync_new_chapters_from_extended_folder(
        self,
        drive_service: Any,
        folder_id: str,
        folder_name: str,
        display_name: str,
        chapters_count: int | None = None,
        job_id: str | None = None,
    ) -> tuple[int, int, int]:
        """
        Download chapters from the 'chapters-extended' subfolder of an EXTENDED_ Drive folder,
        find the corresponding story on the server, and POST only new chapters.

        Returns (chapters_added, chapters_skipped, story_id_found).
        """
        from api.services.drive_service._parsers import _natural_sort_key as _ns

        self._append_log("info", f"[update] Starting update sync for: {display_name}", display_name, job_id=job_id)

        chapters_ext = self._find_chapters_extended_folder(drive_service, folder_id)
        if not chapters_ext:
            self._append_log("warning", "[update] No chapters-extended subfolder found", display_name, job_id=job_id)
            return (0, 0, 0)

        self._append_log("info", f"[update] Found chapters-extended subfolder: {chapters_ext['id']}", display_name, job_id=job_id)
        target_id = chapters_ext["id"]

        chapter_files = self._list_files_in_folder(drive_service, target_id)
        md_files = [f for f in chapter_files if f["name"].endswith(".md")]
        if not md_files:
            self._append_log("warning", "[update] No .md files in chapters-extended folder", display_name, job_id=job_id)
            return (0, 0, 0)

        self._append_log("info", f"[update] Found {len(md_files)} .md files in chapters-extended", display_name, job_id=job_id)

        story_id = self._find_story_by_title(display_name)
        if not story_id:
            self._append_log("error", "[update] Story not found on server", display_name, job_id=job_id)
            return (0, 0, 0)

        self._append_log("info", f"[update] Story found on server (id={story_id[:8]}...)", display_name, job_id=job_id)

        free_chapters_count: Optional[int] = None
        free_md_file = self._find_free_md_file(drive_service, folder_id)
        if free_md_file:
            try:
                free_content = self._get_file_content(drive_service, free_md_file["id"])
                free_chapters_count = self._parse_free_md(free_content)
                self._append_log("info", f"[update] free.md found: freeChaptersCount={free_chapters_count}", display_name, job_id=job_id)
            except Exception as exc:
                self._append_log("warning", f"[update] Failed to read free.md: {exc}", display_name, job_id=job_id)
        else:
            self._append_log("info", "[update] free.md not found", display_name, job_id=job_id)

        tags: Optional[list[str]] = None
        try:
            tags = self._parse_tags_file(drive_service, folder_id)
            if tags:
                self._append_log("info", f"[update] tags.md found: {tags}", display_name, job_id=job_id)
        except Exception as exc:
            self._append_log("warning", f"[update] Failed to read tags.md: {exc}", display_name, job_id=job_id)

        existing_indices = self._get_existing_chapter_indices(story_id)
        self._append_log("info", f"[update] Server has {len(existing_indices)} chapters: {sorted(existing_indices)}", display_name, job_id=job_id)
        server_max = max(existing_indices) if existing_indices else 0
        next_index = server_max + 1 if existing_indices else 1

        chapter_files_sorted = sorted(md_files, key=lambda f: _ns(f["name"]))
        chapters_added = 0
        chapters_skipped = 0

        for file_info in chapter_files_sorted:
            if chapters_count is not None and chapters_added >= chapters_count:
                self._append_log("info", f"[update] Stopped after {chapters_added} chapter(s) per user request.", display_name, job_id=job_id)
                break
            file_id = file_info["id"]
            file_name = file_info["name"]

            ch_idx = self._extract_chapter_index(file_name)
            if ch_idx is not None and ch_idx <= server_max:
                self._append_log("debug", f"[update] Skipped {file_name} — chapter {ch_idx} already on server", display_name, job_id=job_id)
                chapters_skipped += 1
                continue

            try:
                content = self._get_file_content(drive_service, file_id)
            except Exception as exc:
                self._append_log("warning", f"[update] Failed to download {file_name}: {exc}", display_name, job_id=job_id)
                chapters_skipped += 1
                continue

            _, title, chapter_content = self._parse_chapter_file(content, file_name)

            if not chapter_content:
                self._append_log("debug", f"[update] Skipped {file_name} — empty content", display_name, job_id=job_id)
                chapters_skipped += 1
                continue

            posting_index = ch_idx if ch_idx is not None else next_index

            while posting_index in existing_indices:
                posting_index += 1

            success = self._post_chapter(story_id, posting_index, title, chapter_content)
            if success:
                chapters_added += 1
                existing_indices.add(posting_index)
                self._append_log("info", f"[update] Chapter {posting_index}: {title[:50]} -> OK", display_name, job_id=job_id)
            else:
                self._append_log("warning", f"[update] Chapter {posting_index} ({file_name}) failed to post", display_name, job_id=job_id)

            if ch_idx is not None:
                next_index = max(next_index, posting_index + 1)

        self._append_log("info", f"[update] Done. Added={chapters_added} Skipped={chapters_skipped}", display_name, job_id=job_id)

        new_max_chapter = max(existing_indices) if existing_indices else None
        if free_chapters_count is not None or new_max_chapter is not None or tags is not None:
            ok, err_detail = self.put_story_metadata(story_id, max_chapter=new_max_chapter, free_chapters_count=free_chapters_count, tags=tags)
            if ok:
                self._append_log("info", f"[update] Story metadata updated", display_name, job_id=job_id)
            else:
                self._append_log("warning", f"[update] Failed to update story metadata on server — {err_detail}", display_name, job_id=job_id)

        return (chapters_added, chapters_skipped, 1)

    def _upload_cover_image(self, story_id: str, image_bytes: bytes, filename: str = "cover.jpg") -> Optional[str]:
        """POST cover image to main BE /api/v1/story/{id}/upload-cover. Returns the cover URL on success."""
        if self._config is None:
            return None
        url = f"{self._config.main_be_api_base_url}/api/v1/story/{story_id}/upload-cover"
        headers = {
            "Authorization": f"Bearer {self._config.main_be_bearer_token}",
            "x-user-id": self._config.main_be_user_id,
        }
        try:
            with httpx.Client(timeout=60.0) as client:
                resp = client.post(
                    url,
                    files={"image": (filename, image_bytes, "image/jpeg")},
                    headers=headers,
                )
                if resp.status_code in (200, 201):
                    data = resp.json()
                    cover_url = data.get("data", {}).get("coverImageUrl")
                    if cover_url:
                        self._append_log("info", f"Cover image uploaded: {cover_url}")
                        return cover_url
                    else:
                        self._append_log("warning", "Cover upload returned success but no coverImageUrl in response")
                else:
                    self._append_log("error", f"Cover upload failed {resp.status_code}: {resp.text[:200]}")
        except Exception as exc:
            self._append_log("error", f"Cover upload exception: {exc}")
        return None

    def get_stories_needing_update(self, start_date: Optional[str] = None, end_date: Optional[str] = None) -> dict:
        """
        Fetch stories needing update from the main BE dashboard API.
        Proxies GET /api/v1/dashboard/stories-needing-update from the main BE.
        """
        if self._config is None:
            raise RuntimeError("Drive sync config not set.")

        headers = {
            "Authorization": f"Bearer {self._config.main_be_bearer_token}",
            "x-user-id": self._config.main_be_user_id,
        }
        params: dict[str, str] = {}
        if start_date:
            params["startDate"] = start_date
        if end_date:
            params["endDate"] = end_date

        try:
            with httpx.Client(timeout=30.0) as client:
                resp = client.get(
                    f"{self._config.main_be_api_base_url}/api/v1/dashboard/stories-needing-update",
                    headers=headers,
                    params=params,
                )
                if resp.status_code == 401:
                    raise RuntimeError("Unauthorized: Invalid or expired bearer token (401). Please check your Bearer Token in the Drive Sync configuration.")
                if resp.status_code in (200, 201):
                    return resp.json()
                logger.warning("get_stories_needing_update returned %d: %s", resp.status_code, resp.text[:300])
                return {"success": False, "message": f"HTTP {resp.status_code}", "data": None}
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 401:
                raise RuntimeError("Unauthorized: Invalid or expired bearer token (401). Please check your Bearer Token in the Drive Sync configuration.")
            raise
        except Exception as exc:
            if "401" in str(exc):
                raise RuntimeError("Unauthorized: Invalid or expired bearer token (401). Please check your Bearer Token in the Drive Sync configuration.")
            logger.warning("get_stories_needing_update exception: %s", exc)
            return {"success": False, "message": str(exc), "data": None}

    def validate_token(self) -> tuple[bool, int, str]:
        """
        Validate the main BE bearer token by making a simple GET /api/v1/story.
        Returns (valid, status_code, message).
        """
        if self._config is None:
            return (False, 0, "Drive sync config not set.")
        if not self._config.main_be_bearer_token:
            return (False, 0, "Bearer token is not set.")
        if not self._config.main_be_api_base_url:
            return (False, 0, "Main BE API base URL is not set.")
        url = f"{self._config.main_be_api_base_url}/api/v1/story"
        headers = {
            "Authorization": f"Bearer {self._config.main_be_bearer_token}",
            "x-user-id": self._config.main_be_user_id,
        }
        try:
            with httpx.Client(timeout=30.0) as client:
                resp = client.get(url, headers=headers, params={"page": 1, "limit": 1})
                if resp.status_code == 401:
                    return (False, resp.status_code, "Unauthorized: Invalid or expired bearer token.")
                if resp.status_code in (200, 201):
                    return (True, resp.status_code, "Token is valid.")
                return (False, resp.status_code, resp.text[:200] or resp.reason_phrase)
        except httpx.RequestError as exc:
            return (False, 0, f"Request failed: {exc}")


