"""External API client for the auto-audio service."""

from __future__ import annotations

from pathlib import Path
from typing import Optional

import httpx

from .config import _get_external_api_config


class ExternalAPIClient:
    """HTTP client for the external main-BE API (story/audio data)."""

    def __init__(self) -> None:
        pass

    def get(self, path: str, params: Optional[dict] = None) -> list | dict:
        api_base, headers = _get_external_api_config()
        url = f"{api_base}{path}"
        with httpx.Client(timeout=30.0) as client:
            resp = client.get(url, headers=headers, params=params or {})
            resp.raise_for_status()
            return resp.json()

    def post(self, path: str, json_data: Optional[dict] = None) -> dict:
        api_base, headers = _get_external_api_config()
        url = f"{api_base}{path}"
        with httpx.Client(timeout=60.0) as client:
            resp = client.post(url, headers=headers, json=json_data or {})
            resp.raise_for_status()
            raw = resp.json()
            if isinstance(raw, dict) and "data" in raw:
                return raw["data"]
            return raw

    def put(self, url: str, data: bytes, content_type: str = "audio/wav",
            extra_headers: Optional[dict] = None) -> httpx.Response:
        headers = {"Content-Type": content_type}
        if extra_headers:
            headers.update(extra_headers)
        with httpx.Client(timeout=120.0) as client:
            resp = client.put(url, content=data, headers=headers)
            resp.raise_for_status()
            return resp

    def put_with_retry(self, url: str, data: bytes, content_type: str = "audio/wav",
                       extra_headers: Optional[dict] = None, max_retries: int = 3) -> httpx.Response:
        headers = {"Content-Type": content_type}
        if extra_headers:
            headers.update(extra_headers)
        last_exc: Exception | None = None
        for attempt in range(max_retries):
            try:
                with httpx.Client(timeout=120.0) as client:
                    resp = client.put(url, content=data, headers=headers)
                    resp.raise_for_status()
                    return resp
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code == 503 and attempt < max_retries - 1:
                    last_exc = exc
                    import time
                    time.sleep(2 ** attempt)
                    continue
                raise
        raise last_exc or RuntimeError("Unexpected retry failure")

    def fetch_chapter_content(self, story_id: str, chapter_num: int) -> Optional[tuple[str, str]]:
        try:
            data = self.get(f"/api/v1/story/{story_id}/chapter/{chapter_num}")
            if isinstance(data, dict):
                data = data.get("data", data)
                content = data.get("content") or data.get("plainContent") or data.get("plain_content") or ""
                title = data.get("title", f"Chapter {chapter_num}")
                return title, content
            return None
        except Exception:
            return None

    def fetch_stories_needing_update(self) -> list[dict]:
        from .config import _get_external_api_config as _cfg
        api_base, headers = _cfg()
        url = f"{api_base}/api/v1/dashboard/stories-needing-update"
        with httpx.Client(timeout=30.0) as client:
            resp = client.get(url, headers=headers)
            resp.raise_for_status()
            raw = resp.json()
            if isinstance(raw, dict):
                data = raw.get("data", {})
                if isinstance(data, dict):
                    items = data.get("data", [])
                    if isinstance(items, list):
                        return items
                    items = data.get("items", [])
                    if isinstance(items, list):
                        return items
                    return []
                elif isinstance(data, list):
                    return data
            if isinstance(raw, list):
                return raw
            return []

    def fetch_all_stories(self) -> list[dict]:
        all_stories: list[dict] = []
        page = 1
        while True:
            data = self.get("/api/v1/story/discover", {"page": page, "limit": 100})
            if isinstance(data, dict):
                nested = data.get("data", {})
                items = nested.get("items", []) if isinstance(nested, dict) else []
                if isinstance(items, list):
                    if not items:
                        break
                    all_stories.extend(items)
                    if len(items) < 100:
                        break
                else:
                    if isinstance(nested, list):
                        all_stories.extend(nested)
                        break
                    break
            elif isinstance(data, list):
                all_stories.extend(data)
                break
            else:
                break
            page += 1
        return all_stories

    def fetch_recent_stories(self, limit: int = 20) -> list[dict]:
        data = self.get("/api/v1/story/discover", {"sort": "recently_updated", "limit": limit})
        if isinstance(data, dict):
            nested = data.get("data", {})
            items = nested.get("items", []) if isinstance(nested, dict) else []
            if isinstance(items, list):
                return items
            if isinstance(nested, list):
                return nested
            return []
        elif isinstance(data, list):
            return data
        return []

    def fetch_story_chapters(self, story_id: str) -> list[dict]:
        try:
            data = self.get(f"/api/v1/story/{story_id}/chapters")
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 404:
                return []
            raise
        if isinstance(data, dict):
            chapters = data.get("data", [])
            if isinstance(chapters, list):
                return chapters
        if isinstance(data, list):
            return data
        return []

    def fetch_story_metadata(self, story_id: str) -> dict:
        try:
            data = self.get(f"/api/v1/story/{story_id}")
            if isinstance(data, dict):
                return data.get("data", data)
            return {}
        except Exception:
            return {}

    def build_chapter_id_map(self, story_id: str, chapter_indices: list[int]) -> dict[int, str]:
        chapters = self.fetch_story_chapters(story_id)
        chapter_map: dict[int, str] = {}
        for ch in chapters:
            idx = ch.get("index") or ch.get("chapterNumber") or ch.get("chapter_number") or 0
            cid = ch.get("chapterId") or ch.get("id") or ""
            if int(idx) in chapter_indices and cid:
                chapter_map[int(idx)] = str(cid)
        return chapter_map

    def fetch_story_audio(self, story_id: str) -> list[dict]:
        try:
            data = self.get(f"/api/v1/story/{story_id}/audio")
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 404:
                return []
            raise
        if isinstance(data, dict):
            items = data.get("data", [])
            if isinstance(items, list):
                return items
        if isinstance(data, list):
            return data
        return []

    def get_presigned_url(self, story_id: str, chapter_id: str, file_name: str,
                          mime_type: str, file_size: int, voice: Optional[str]) -> dict:
        return self.post(
            f"/api/v1/story/{story_id}/chapter/{chapter_id}/audio/presigned-url",
            {
                "fileName": file_name,
                "mimeType": mime_type,
                "fileSize": file_size,
                "voice": voice,
            },
        )

    def complete_audio_upload(self, story_id: str, chapter_id: str,
                               key: str, voice: Optional[str]) -> None:
        self.post(
            f"/api/v1/story/{story_id}/chapter/{chapter_id}/audio/complete",
            {"key": key, "voice": voice},
        )
