"""MainBEClientMixin — main BE API client (story/chapter POST/GET) for DriveSyncService."""

from __future__ import annotations

import json
import logging
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
        except Exception as exc:
            logger.warning("get_all_server_stories exception: %s", exc)

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
    ) -> bool:
        """PUT story metadata (freeChaptersCount, maxChapter, and/or tags) on the main BE."""
        if self._config is None:
            return False
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
            return True
        try:
            with httpx.Client(timeout=30.0) as client:
                resp = client.put(url, content=self._json_body(payload), headers=headers)
                if resp.status_code in (200, 201):
                    self._append_log("info", f"Story metadata updated: freeChaptersCount={free_chapters_count}, maxChapter={max_chapter}")
                    return True
                self._append_log("warning", f"Story metadata PUT failed {resp.status_code}: {resp.text[:200]}")
        except Exception as exc:
            self._append_log("error", f"Story metadata PUT exception: {exc}")
        return False

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
            ok = self.put_story_metadata(story_id, max_chapter=new_max_chapter, free_chapters_count=free_chapters_count, tags=tags)
            if ok:
                self._append_log("info", f"[update] Story metadata updated", display_name, job_id=job_id)
            else:
                self._append_log("warning", "[update] Failed to update story metadata on server", display_name, job_id=job_id)

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
                if resp.status_code in (200, 201):
                    return resp.json()
                logger.warning("get_stories_needing_update returned %d: %s", resp.status_code, resp.text[:300])
                return {"success": False, "message": f"HTTP {resp.status_code}", "data": None}
        except Exception as exc:
            logger.warning("get_stories_needing_update exception: %s", exc)
            return {"success": False, "message": str(exc), "data": None}


