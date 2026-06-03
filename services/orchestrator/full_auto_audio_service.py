"""Auto Audio orchestration service — discovers stories with missing audio and auto-generates TTS via downstream microservices."""

from __future__ import annotations

import json
import logging
import platform
import random
import shutil
import subprocess
import tempfile
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from threading import Event, Lock, Thread
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

_AVAILABLE_VOICES = ["af_heart", "af_bella"]
_OUTPUT_BASE_NAME = "output"
_AUTO_AUDIO_LOGS_DIR_NAME = "auto_audio_logs"

_settings_cache: dict | None = None
_settings_cache_time: float = 0
_SETTINGS_CACHE_TTL = 5.0  # seconds


def _get_settings() -> dict:
    """Load settings with a short in-process cache to avoid repeated disk I/O."""
    global _settings_cache, _settings_cache_time
    now = time.time()
    if _settings_cache is not None and (now - _settings_cache_time) < _SETTINGS_CACHE_TTL:
        return _settings_cache
    try:
        settings_file = Path(__file__).parent.parent.parent.parent / "FastAPIServer" / "data" / "user_settings.json"
        with open(settings_file, "r", encoding="utf-8") as f:
            _settings_cache = json.load(f)
            _settings_cache_time = now
    except Exception:
        _settings_cache = {}
    return _settings_cache if _settings_cache is not None else {}


def _get_service_url(service_key: str) -> str:
    """Resolve a downstream service URL from env vars."""
    import os
    urls_raw = os.environ.get("SERVICE_URLS", "{}")
    try:
        import json as _json
        urls = _json.loads(urls_raw)
        url = urls.get(service_key, "")
        if url:
            return url.rstrip("/")
    except Exception:
        pass
    from api.routes.settings import _load_settings
    settings = _load_settings()
    return settings.get(f"_service_url_{service_key}", "")


def _get_novelcrawler_url() -> str:
    import os
    return os.environ.get("SERVICE_URLS_NovelCrawler", "http://localhost:8002").rstrip("/")


def _get_bedreadvoices_url() -> str:
    import os
    return os.environ.get("SERVICE_URLS_BedReadVoices", "http://localhost:8001").rstrip("/")


def _get_bedreadvoices_output_base() -> Path:
    import os
    base = os.environ.get("BEDREADVOICES_ROOT", "D:\\Developer\\Nova\\CreateStoryMicroService\\BedReadVoices")
    return Path(base) / "output" / "bedread"


def _get_drivesync_url() -> str:
    import os
    return os.environ.get("SERVICE_URLS_BedReadDriveSync", "http://localhost:8003").rstrip("/")


class AutoAudioConfigError(Exception):
    """Raised when required auto audio configuration is missing."""
    pass


def _get_external_api_config() -> tuple[str, dict]:
    """Get external API base URL and auth headers from the shared drive_sync_config.json."""
    from api.config import load_external_api_config, DriveSyncConfigError

    try:
        config = load_external_api_config()
        headers = {"x-user-id": config["main_be_user_id"]}
        if config.get("main_be_bearer_token"):
            headers["Authorization"] = f"Bearer {config['main_be_bearer_token']}"
        return config["main_be_api_base_url"].rstrip("/"), headers
    except DriveSyncConfigError as exc:
        raise AutoAudioConfigError(str(exc)) from exc
    except Exception as exc:
        logger.warning("Failed to get drive sync config: %s", exc)
        raise AutoAudioConfigError(
            "No Drive Sync configuration found. "
            "Please configure your Drive Sync settings in Settings > Drive Sync Configuration."
        ) from exc


@dataclass
class LogEntry:
    timestamp: str
    step: int
    message: str
    level: str = "info"

    def to_dict(self) -> dict:
        return {
            "timestamp": self.timestamp,
            "step": self.step,
            "message": self.message,
            "level": self.level,
        }


@dataclass
class MissingChapterInfo:
    chapter_id: str
    chapter_index: int
    title: str


@dataclass
class StoryMissingAudio:
    story_id: str
    story_title: str
    missing_chapters: list[MissingChapterInfo]
    existing_voice: Optional[str] = None


@dataclass
class StoryResult:
    story_id: str
    story_title: str
    chapters_generated: int
    chapters_uploaded: int
    upload_errors: list[str]
    error: str = ""

    def to_dict(self) -> dict:
        return {
            "story_id": self.story_id,
            "story_title": self.story_title,
            "chapters_generated": self.chapters_generated,
            "chapters_uploaded": self.chapters_uploaded,
            "upload_errors": self.upload_errors,
            "error": self.error,
        }


@dataclass
class AutoAudioSession:
    session_id: str
    phase: str
    test_mode: bool
    voice: Optional[str]
    status: str
    current_step: int
    current_step_desc: str
    current_story: str
    progress: dict
    chapter_progress: dict
    stories_missing_audio: list[dict]
    logs: list[dict]
    started_at: Optional[str]
    finished_at: Optional[str]
    error: str
    story_results: list[dict] = field(default_factory=list)
    completed_stories: set[str] = field(default_factory=set)
    _stopping: bool = field(default=False)
    _lock: Lock = field(default_factory=Lock)
    limit: int = 20

    def to_dict(self) -> dict:
        with self._lock:
            return {
                "session_id": self.session_id,
                "phase": self.phase,
                "test_mode": self.test_mode,
                "voice": self.voice,
                "status": self.status,
                "current_step": self.current_step,
                "current_step_desc": self.current_step_desc,
                "current_story": self.current_story,
                "progress": self.progress,
                "chapter_progress": self.chapter_progress,
                "stories_missing_audio": self.stories_missing_audio,
                "logs": self.logs,
                "started_at": self.started_at,
                "finished_at": self.finished_at,
                "error": self.error,
                "story_results": self.story_results,
                "completed_stories": list(self.completed_stories),
            }

    def add_log(self, step: int, message: str, level: str = "info") -> None:
        with self._lock:
            self.logs.append(LogEntry(
                timestamp=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                step=step,
                message=message,
                level=level,
            ).to_dict())

    def set_step(self, step: int, desc: str, story: str = "") -> None:
        with self._lock:
            self.current_step = step
            self.current_step_desc = desc
            if story:
                self.current_story = story

    def set_status(self, status: str, error: str = "") -> None:
        with self._lock:
            self.status = status
            if error:
                self.error = error
            if status in ("completed", "error"):
                self.finished_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    def update_progress(self, done: int, total: int) -> None:
        with self._lock:
            self.progress = {"done": done, "total": total}

    def update_chapter_progress(self, done: int, total: int) -> None:
        with self._lock:
            self.chapter_progress = {"done": done, "total": total}

    def set_stories_preview(self, stories: list[dict]) -> None:
        with self._lock:
            self.stories_missing_audio = stories

    def add_story_result(self, result: dict) -> None:
        with self._lock:
            self.story_results.append(result)

    def record_completed_story(self, story_id: str) -> None:
        with self._lock:
            self.completed_stories.add(story_id)


class AutoAudioService:
    """Orchestrates auto audio generation across all published stories via downstream microservices."""

    def __init__(self) -> None:
        self._active_session: Optional[AutoAudioSession] = None
        _project_root = Path(__file__).parent.parent.parent.resolve()
        self._output_base = _project_root / _OUTPUT_BASE_NAME
        self._logs_dir = self._output_base / _AUTO_AUDIO_LOGS_DIR_NAME
        self._logs_dir.mkdir(parents=True, exist_ok=True)
        self._history_file = self._logs_dir / "sessions.json"

    def _external_get(self, path: str, params: Optional[dict] = None) -> list | dict:
        api_base, headers = _get_external_api_config()
        url = f"{api_base}{path}"
        with httpx.Client(timeout=30.0) as client:
            resp = client.get(url, headers=headers, params=params or {})
            resp.raise_for_status()
            return resp.json()

    def _external_post(self, path: str, json_data: Optional[dict] = None) -> dict:
        api_base, headers = _get_external_api_config()
        url = f"{api_base}{path}"
        with httpx.Client(timeout=60.0) as client:
            resp = client.post(url, headers=headers, json=json_data or {})
            resp.raise_for_status()
            raw = resp.json()
            if isinstance(raw, dict) and "data" in raw:
                return raw["data"]
            return raw

    def _external_put(self, url: str, data: bytes, content_type: str = "audio/wav", extra_headers: Optional[dict] = None) -> httpx.Response:
        headers = {"Content-Type": content_type}
        if extra_headers:
            headers.update(extra_headers)
        with httpx.Client(timeout=120.0) as client:
            resp = client.put(url, content=data, headers=headers)
            resp.raise_for_status()
            return resp

    def _external_put_with_retry(self, url: str, data: bytes, content_type: str = "audio/wav", extra_headers: Optional[dict] = None, max_retries: int = 3) -> httpx.Response:
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

    def _bedread_post(self, path: str, json_data: Optional[dict] = None) -> dict:
        """POST to BedReadVoices service."""
        url = f"{_get_bedreadvoices_url()}{path}"
        with httpx.Client(timeout=300.0) as client:
            resp = client.post(url, json=json_data or {})
            resp.raise_for_status()
            return resp.json()

    def _bedread_get(self, path: str, params: Optional[dict] = None) -> dict | None:
        """GET from BedReadVoices service."""
        url = f"{_get_bedreadvoices_url()}{path}"
        with httpx.Client(timeout=30.0) as client:
            resp = client.get(url, params=params or {})
            if resp.status_code == 404:
                return None
            resp.raise_for_status()
            return resp.json()

    def _drivesync_get(self, path: str, params: Optional[dict] = None) -> dict | None:
        """GET from BedReadDriveSync service."""
        url = f"{_get_drivesync_url()}{path}"
        with httpx.Client(timeout=30.0) as client:
            resp = client.get(url, params=params or {})
            if resp.status_code == 404:
                return None
            resp.raise_for_status()
            return resp.json()

    def _drivesync_post(self, path: str, json_data: Optional[dict] = None) -> dict:
        """POST to BedReadDriveSync service."""
        url = f"{_get_drivesync_url()}{path}"
        with httpx.Client(timeout=300.0) as client:
            resp = client.post(url, json=json_data or {})
            resp.raise_for_status()
            return resp.json()

    def _fetch_chapter_content(self, story_id: str, chapter_num: int) -> Optional[tuple[str, str]]:
        """
        Fetch a single chapter's content from the external API.
        Returns (title, plain_text) or None if not found.
        """
        try:
            data = self._external_get(f"/api/v1/story/{story_id}/chapter/{chapter_num}")
            if isinstance(data, dict):
                data = data.get("data", data)
                content = data.get("content") or data.get("plainContent") or data.get("plain_content") or ""
                title = data.get("title", f"Chapter {chapter_num}")
                return title, content
            return None
        except Exception:
            return None

    def _tts_speak(self, text: str, voice: str, lang: str, speed: float, format: str) -> Optional[str]:
        """Call BedReadVoices /api/tts/speak to start a TTS job. Returns job_id or None."""
        try:
            resp = self._bedread_post("/api/tts/speak", {
                "text": text,
                "voice": voice,
                "lang": lang,
                "speed": speed,
                "format": format,
            })
            return resp.get("job_id")
        except Exception:
            return None

    def _tts_get_job(self, job_id: str) -> Optional[dict]:
        """Get TTS job status from BedReadVoices. Returns job dict or None."""
        try:
            return self._bedread_get(f"/api/tts/jobs/{job_id}")
        except Exception:
            return None

    def _tts_poll_until_done(self, job_id: str, timeout: int = 0) -> tuple[bool, Optional[Path]]:
        """
        Poll a TTS job until completed or timeout.
        When timeout <= 0, polls indefinitely until the job completes or fails.
        Returns (success, output_path).
        """
        start = time.time()
        while timeout <= 0 or time.time() - start < timeout:
            job = self._tts_get_job(job_id)
            if job is None:
                return False, None
            status = job.get("status", "unknown")
            if status == "completed":
                output_dir_str = job.get("output_dir")
                output_filename = job.get("output_filename", "")
                if output_dir_str and output_filename:
                    path = Path(output_dir_str) / output_filename
                    if path.exists():
                        return True, path
                return False, None
            elif status in ("failed", "cancelled"):
                return False, None
            time.sleep(2)
        return False, None

    def _persist_sessions(self, sessions: list[dict]) -> None:
        try:
            with open(self._history_file, "w", encoding="utf-8") as fh:
                json.dump(sessions, fh, indent=2)
        except Exception as exc:
            logger.warning("Failed to persist auto audio sessions: %s", exc)

    def _load_history(self) -> list[dict]:
        if not self._history_file.exists():
            return []
        try:
            with open(self._history_file, "r", encoding="utf-8") as fh:
                return json.load(fh)
        except Exception:
            return []

    def _persist_history(self, session: AutoAudioSession) -> None:
        try:
            history = self._load_history()
            history.insert(0, session.to_dict())
            self._persist_sessions(history[:100])
        except Exception as exc:
            logger.warning("Failed to persist auto audio session history: %s", exc)

    # ── Completed-story tracking (per-phase, persistent across sessions) ──

    def _get_completed_stories_path(self, phase: str) -> Path:
        return self._logs_dir / f"completed_stories_{phase}.json"

    def _load_completed_stories(self, phase: str) -> set[str]:
        """Return set of story IDs already successfully processed in this phase."""
        path = self._get_completed_stories_path(phase)
        if not path.exists():
            return set()
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            return set(data.get("story_ids", []))
        except Exception:
            return set()

    def _save_completed_stories(self, phase: str, completed: set[str]) -> None:
        path = self._get_completed_stories_path(phase)
        try:
            path.write_text(json.dumps({"story_ids": sorted(completed)}, indent=2), encoding="utf-8")
        except Exception as exc:
            logger.warning("Failed to save completed stories for phase %s: %s", phase, exc)

    def _skip_completed_stories(
        self,
        session: AutoAudioSession,
        stories: list[StoryMissingAudio],
    ) -> list[StoryMissingAudio]:
        """Filter out story IDs that were already successfully completed in this phase."""
        if session.phase not in ("phase1", "phase2", "phase3"):
            return stories
        completed = self._load_completed_stories(session.phase)
        if not completed:
            return stories

        skipped = [s for s in stories if s.story_id in completed]
        remaining = [s for s in stories if s.story_id not in completed]
        if skipped:
            session.add_log(
                3,
                f"Skipping {len(skipped)} already-processed story(ies) (found {len(remaining)} remaining)",
            )
        return remaining

    def _save_session_log(self, session: AutoAudioSession) -> None:
        try:
            log_path = self._logs_dir / f"session_{session.session_id}.json"
            with open(log_path, "w", encoding="utf-8") as fh:
                json.dump(session.to_dict(), fh, indent=2)
        except Exception as exc:
            logger.warning("Failed to save session log: %s", exc)

    def _fetch_all_stories(self) -> list[dict]:
        all_stories: list[dict] = []
        page = 1
        while True:
            data = self._external_get("/api/v1/story/discover", {"page": page, "limit": 100})
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

    def _fetch_recent_stories(self, limit: int = 20) -> list[dict]:
        data = self._external_get("/api/v1/story/discover", {"sort": "recently_updated", "limit": limit})
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

    def _fetch_stories_needing_update(self) -> list[dict]:
        api_base, headers = _get_external_api_config()
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

    def _fetch_story_chapters(self, story_id: str) -> list[dict]:
        data = self._external_get(f"/api/v1/story/{story_id}/chapters")
        if isinstance(data, dict):
            chapters = data.get("data", [])
            if isinstance(chapters, list):
                return chapters
        if isinstance(data, list):
            return data
        return []

    def _fetch_story_metadata(self, story_id: str) -> dict:
        """Fetch a single story's metadata (title, etc.) from the external API."""
        try:
            data = self._external_get(f"/api/v1/story/{story_id}")
            if isinstance(data, dict):
                return data.get("data", data)
            return {}
        except Exception:
            return {}

    def _build_chapter_id_map(self, story_id: str, chapter_indices: list[int]) -> dict[int, str]:
        """Fetch chapters and map chapter index to chapter ID for a given set of indices."""
        chapters = self._fetch_story_chapters(story_id)
        chapter_map: dict[int, str] = {}
        for ch in chapters:
            idx = ch.get("index") or ch.get("chapterNumber") or ch.get("chapter_number") or 0
            cid = ch.get("chapterId") or ch.get("id") or ""
            if int(idx) in chapter_indices and cid:
                chapter_map[int(idx)] = str(cid)
        return chapter_map

    def _fetch_story_audio(self, story_id: str) -> list[dict]:
        data = self._external_get(f"/api/v1/story/{story_id}/audio")
        if isinstance(data, dict):
            items = data.get("data", [])
            if isinstance(items, list):
                return items
        if isinstance(data, list):
            return data
        return []

    def _discover_stories_missing_audio(
        self,
        session: AutoAudioSession,
        story_ids: list[str],
        story_metadata: Optional[dict[str, dict]] = None,
    ) -> list[StoryMissingAudio]:
        session.set_step(2, "Discovering stories with missing audio")

        if story_metadata is None:
            story_metadata = {}

        if session.test_mode:
            session.add_log(2, f"Test mode: checking {len(story_ids)} test story IDs")
            stories_raw: list[dict] = [
                {**story_metadata.get(sid, {}), "storyId": sid, "_chapters": self._fetch_story_chapters(sid)}
                for sid in story_ids
                if self._fetch_story_chapters(sid)
            ]
            for raw in stories_raw:
                if "title" not in raw or not raw["title"]:
                    raw["title"] = f"Test Story {raw.get('storyId', sid)[:8]}"
        else:
            session.add_log(2, f"Discovering stories with missing audio among {len(story_ids)} stories...")
            stories_raw = [
                {"storyId": sid, **story_metadata.get(sid, {}), "_chapters": self._fetch_story_chapters(sid)}
                for sid in story_ids
                if self._fetch_story_chapters(sid)
            ]

        session.add_log(2, f"Found {len(stories_raw)} stories to check")

        missing_audio_stories: list[StoryMissingAudio] = []

        for raw_story in stories_raw:
            if session._stopping:
                session.add_log(2, "Stop requested, halting discovery", level="warning")
                break

            story_id = raw_story.get("storyId") or raw_story.get("story_id")
            if not story_id:
                continue
            story_title = raw_story.get("title", "Untitled")

            session.set_step(2, "Discovering stories with missing audio", story=story_title)

            if "_chapters" in raw_story:
                chapters = raw_story["_chapters"]
            else:
                chapters = self._fetch_story_chapters(story_id)

            missing: list[MissingChapterInfo] = []
            for ch in chapters:
                if session._stopping:
                    break

                chapter_id = ch.get("chapterId") or ch.get("id") or ""
                chapter_index = ch.get("index") or ch.get("chapterNumber") or ch.get("chapter_number") or 0
                title = ch.get("title", f"Chapter {chapter_index}")
                audio_url = ch.get("audioUrl") or ch.get("audio_url") or ""
                if not audio_url:
                    missing.append(MissingChapterInfo(
                        chapter_id=str(chapter_id),
                        chapter_index=chapter_index,
                        title=title,
                    ))

            if missing:
                existing_voice: Optional[str] = None
                existing_audio = self._fetch_story_audio(story_id)
                if existing_audio:
                    for audio in existing_audio:
                        v = audio.get("voice", "")
                        if v:
                            existing_voice = v
                            break

                missing_audio_stories.append(StoryMissingAudio(
                    story_id=str(story_id),
                    story_title=story_title,
                    missing_chapters=missing,
                    existing_voice=existing_voice,
                ))

        stopped = session._stopping
        session.add_log(2, f"Found {len(missing_audio_stories)} stories with missing audio{' (stopped early)' if stopped else ''}")
        return missing_audio_stories

    def _generate_audio_for_chapter(
        self,
        session: AutoAudioSession,
        story: StoryMissingAudio,
        chapter: MissingChapterInfo,
        voice: str,
    ) -> tuple[bool, Optional[Path]]:
        """
        Generate audio for a single chapter: fetch content + TTS + poll.
        Returns (success, local_file_path).
        """
        chapter_num = chapter.chapter_index
        session.set_step(4, f"Generating chapter {chapter_num}: {chapter.title}", story=session.current_story)

        chapter_data = self._fetch_chapter_content(story.story_id, chapter_num)
        if chapter_data is None:
            session.add_log(4, f"Chapter {chapter_num}: failed to fetch content", level="error")
            return False, None
        title, content = chapter_data
        if not content or not content.strip():
            session.add_log(4, f"Chapter {chapter_num}: empty content", level="error")
            return False, None

        job_id = self._tts_speak(content, voice, "en-us", 0.69, "wav")
        if not job_id:
            session.add_log(4, f"Chapter {chapter_num}: failed to start TTS job", level="error")
            return False, None

        session.add_log(4, f"Chapter {chapter_num}: TTS job {job_id} started")
        success, output_path = self._tts_poll_until_done(job_id)
        if not success or output_path is None:
            session.add_log(4, f"Chapter {chapter_num}: TTS job failed or timed out", level="error")
            return False, None

        session.add_log(4, f"Chapter {chapter_num}: audio generated ({output_path.name})")
        return True, output_path

    def _start_batch_job_for_story(
        self,
        session: AutoAudioSession,
        story: StoryMissingAudio,
    ) -> tuple[Optional[str], Optional[str], str]:
        chapter_numbers = [c.chapter_index for c in story.missing_chapters]
        if not chapter_numbers:
            return None, None, "No chapters to generate"

        voice = session.voice or story.existing_voice or random.choice(_AVAILABLE_VOICES)
        voice_source = "session" if session.voice else ("existing" if story.existing_voice else "random")
        session.add_log(3, f"Starting batch TTS for '{story.story_title}' — {len(chapter_numbers)} chapters, voice={voice} (source={voice_source})")
        session.set_step(4, f"Generating audio for {story.story_title}", story=story.story_title)

        try:
            resp = self._bedread_post("/api/bedread/generate", {
                "story_id": story.story_id,
                "story_title": story.story_title,
                "chapter_numbers": sorted(chapter_numbers),
                "voice": voice,
                "lang": "en-us",
                "speed": 0.69,
                "format": "wav",
                "from_auto_mode": True,
            })
            batch_id = resp.get("batch_id", "")
            return batch_id, voice, ""
        except Exception as exc:
            return None, None, str(exc)

    def _poll_batch_until_done(self, session: AutoAudioSession, batch_id: str, timeout_seconds: int = 3600) -> tuple[bool, list[dict]]:
        start = time.time()
        completed_files: list[dict] = []

        while time.time() - start < timeout_seconds:
            if session._stopping:
                session.add_log(4, "Batch polling interrupted — stop requested, cancelling batch job", level="warning")
                try:
                    self._bedread_delete(f"/api/bedread/jobs/{batch_id}")
                except Exception:
                    pass
                return False, completed_files

            job = None
            for attempt in range(3):
                try:
                    job = self._bedread_get(f"/api/bedread/jobs/{batch_id}")
                    break
                except httpx.ReadTimeout:
                    if attempt < 2:
                        session.add_log(4, f"Read timeout polling batch {batch_id} (attempt {attempt + 1}/3), retrying...", level="warning")
                        time.sleep(2 ** attempt)
                    else:
                        session.add_log(4, f"Read timeout polling batch {batch_id} (attempt {attempt + 1}/3), continuing...", level="warning")
                except httpx.HTTPStatusError as exc:
                    if exc.response.status_code == 503 and attempt < 2:
                        session.add_log(4, f"503 polling batch {batch_id} (attempt {attempt + 1}/3), retrying...", level="warning")
                        time.sleep(2 ** attempt)
                    else:
                        session.add_log(4, f"HTTP error polling batch {batch_id}: {exc.response.status_code}", level="error")
                        job = None
                        break

            if job is None:
                session.add_log(4, f"Batch job {batch_id} not found", level="error")
                return False, completed_files

            statuses = [c.get("status") for c in job.get("chapters", [])]
            done = sum(1 for s in statuses if s == "completed")
            total = len(statuses)

            if all(s in ("completed", "failed") for s in statuses):
                for ch in job.get("chapters", []):
                    if ch.get("status") == "completed" and ch.get("output_filename"):
                        completed_files.append({
                            "chapter_id": ch.get("chapter_id", ""),
                            "chapter_index": ch.get("chapter_number"),
                            "filename": ch.get("output_filename"),
                        })
                return True, completed_files

            session.set_step(5, f"Generating audio ({done}/{total})", story=session.current_story)
            time.sleep(5)

        session.add_log(4, f"Batch job {batch_id} timed out after {timeout_seconds}s", level="error")
        return False, completed_files

    def _bedread_delete(self, path: str) -> dict:
        url = f"{_get_bedreadvoices_url()}{path}"
        with httpx.Client(timeout=30.0) as client:
            resp = client.delete(url)
            if resp.status_code == 404:
                return {}
            resp.raise_for_status()
            return resp.json()

    def _bedread_delete_output(self, session: AutoAudioSession, batch_id: str) -> None:
        try:
            self._bedread_delete(f"/api/bedread/jobs/{batch_id}/output")
            session.add_log(9, f"Deleted BedReadVoices batch {batch_id} output directory")
        except Exception as exc:
            session.add_log(9, f"Failed to delete BedReadVoices batch {batch_id} output: {exc}", level="warning")

    def _bedread_download_chapter(self, batch_id: str, chapter_num: int) -> Optional[Path]:
        """Download a single chapter's audio file from BedReadVoices. Returns local temp path."""
        url = f"{_get_bedreadvoices_url()}/api/bedread/jobs/{batch_id}/download?chapter={chapter_num}"
        try:
            with httpx.Client(timeout=300.0) as client:
                resp = client.get(url)
                if resp.status_code == 404:
                    return None
                resp.raise_for_status()
            tmp_dir = Path(tempfile.gettempdir()) / f"bedread_auto_{batch_id}"
            tmp_dir.mkdir(parents=True, exist_ok=True)
            out_path = tmp_dir / f"chapter_{chapter_num}.wav"
            out_path.write_bytes(resp.content)
            return out_path
        except Exception:
            return None

    def _get_batch_output_dir(self, batch_id: str) -> Optional[Path]:
        base = _get_bedreadvoices_output_base()
        output_dir = base / batch_id
        if output_dir.exists():
            return output_dir
        return None

    def _process_story(self, session: AutoAudioSession, story: StoryMissingAudio) -> StoryResult:
        result = StoryResult(
            story_id=story.story_id,
            story_title=story.story_title,
            chapters_generated=0,
            chapters_uploaded=0,
            upload_errors=[],
        )

        batch_id, voice, err = self._start_batch_job_for_story(session, story)
        if not batch_id:
            result.error = err
            session.add_log(4, f"Failed to start batch job: {err}", level="error")
            return result

        session.set_step(5, f"Polling batch job for {story.story_title}", story=story.story_title)
        success, completed_files = self._poll_batch_until_done(session, batch_id)

        if session._stopping:
            result.chapters_generated = len(completed_files)
            session.add_log(4, f"Stopped mid-poll, {len(completed_files)} chapters already done", level="warning")
            return result

        result.chapters_generated = len(completed_files)

        if not success and not completed_files:
            result.error = "Batch job failed or timed out"
            session.add_log(4, f"Batch job for '{story.story_title}' failed", level="error")
            return result

        self._upload_completed_batch(session, story, batch_id, voice, completed_files, result)
        return result

    def _upload_completed_batch(
        self,
        session: AutoAudioSession,
        story: StoryMissingAudio,
        batch_id: str,
        voice: Optional[str],
        completed_files: list[dict],
        result: StoryResult,
    ) -> None:
        """Download and upload all completed files for a batch. Used by both sequential and pipeline modes."""
        session.set_step(6, f"Downloading {len(completed_files)} audio files from BedReadVoices", story=story.story_title)

        chapter_indices = [int(f.get("chapter_index", 0) or 0) for f in completed_files]
        chapter_id_by_index = self._build_chapter_id_map(story.story_id, chapter_indices)

        for i, file_info in enumerate(completed_files):
            if session._stopping:
                break

            chapter_index = int(file_info.get("chapter_index", 0) or 0)
            chapter_id = chapter_id_by_index.get(chapter_index, "")

            if not chapter_id:
                session.add_log(6, f"Chapter index {chapter_index}: no chapter ID found in server response — skipping upload", level="error")
                result.upload_errors.append(f"Chapter {chapter_index}: missing chapter ID")
                continue

            session.set_step(6, f"Downloading chapter {i + 1}/{len(completed_files)} for {story.story_title}", story=story.story_title)
            session.add_log(6, f"Downloading chapter {chapter_index} from BedReadVoices (batch_id={batch_id})")

            local_path = self._bedread_download_chapter(batch_id, chapter_index)

            if local_path is None or not local_path.exists():
                session.add_log(6, f"Failed to download chapter {chapter_index} from BedReadVoices", level="error")
                result.upload_errors.append(f"Chapter {chapter_index}: download failed")
                continue

            session.add_log(6, f"Downloaded chapter {chapter_index}: {local_path.stat().st_size} bytes")
            ok = self._upload_audio_to_story(
                session, story.story_id,
                chapter_id,
                local_path,
                voice,
            )
            if ok:
                result.chapters_uploaded += 1
                self._delete_local_audio_files(session, local_path)
            else:
                result.upload_errors.append(f"Chapter {chapter_index}: upload failed")

        session.set_step(6, f"Uploaded {result.chapters_uploaded}/{len(completed_files)} audio files for {story.story_title}", story=story.story_title)

        temp_batch_dir = Path(tempfile.gettempdir()) / f"bedread_auto_{batch_id}"
        if temp_batch_dir.exists():
            self._delete_batch_output_dir(session, batch_id, temp_batch_dir)

        self._bedread_delete_output(session, batch_id)
        session.add_log(9, f"Deleted BedReadVoices batch {batch_id} output directory")

    def _delete_batch_output_dir(self, session: AutoAudioSession, batch_id: str, output_dir: Path) -> None:
        """Remove the temp batch download directory after all chapters are processed."""
        try:
            if output_dir.exists():
                shutil.rmtree(output_dir)
                session.add_log(9, f"Removed batch temp directory: {output_dir}")
        except Exception as exc:
            session.add_log(9, f"Failed to remove temp directory {output_dir}: {exc}", level="warning")


    def _upload_audio_to_story(
        self,
        session: AutoAudioSession,
        story_id: str,
        chapter_id: str,
        local_file_path: Path,
        voice: Optional[str],
    ) -> bool:
        session.set_step(6, f"Uploading audio for chapter {chapter_id}", story=session.current_story)

        try:
            compressed = self._compress_audio_to_opus(session, local_file_path)
            mime_type = "audio/ogg"
            file_name = compressed.name
            file_size = compressed.size

            session.add_log(
                6,
                f"Compressed chapter {chapter_id}: {compressed.original} -> {compressed.compressed} bytes",
            )

            presigned_resp = self._external_post(
                f"/api/v1/story/{story_id}/chapter/{chapter_id}/audio/presigned-url",
                {
                    "fileName": file_name,
                    "mimeType": mime_type,
                    "fileSize": file_size,
                    "voice": voice,
                },
            )

            presigned_url = presigned_resp.get("uploadUrl")
            if not presigned_url:
                session.add_log(6, f"No presigned URL returned for chapter {chapter_id}", level="error")
                return False

            required_headers = presigned_resp.get("requiredHeaders", {})
            self._external_put_with_retry(presigned_url, compressed.data, mime_type, required_headers)

            self._external_post(
                f"/api/v1/story/{story_id}/chapter/{chapter_id}/audio/complete",
                {"key": presigned_resp.get("key", ""), "voice": voice},
            )

            session.add_log(6, f"Uploaded chapter {chapter_id} audio")
            return True

        except httpx.HTTPStatusError as exc:
            session.add_log(6, f"HTTP error uploading chapter {chapter_id}: {exc.response.status_code} {exc.response.text} (retries exhausted)", level="error")
            return False
        except Exception as exc:
            session.add_log(6, f"Error uploading chapter {chapter_id}: {exc}", level="error")
            return False

    MAX_AUDIO_SIZE_BYTES = 20 * 1024 * 1024
    TARGET_BITRATE_KBPS = 48
    OPUS_EXTENSION = "opus"

    def _find_ffmpeg(self) -> Optional[Path]:
        """Find FFmpeg binary. Checks vendor dirs, system PATH, then imageio-ffmpeg package."""
        import shutil as _sh
        project_root = Path(__file__).parent.parent.parent.parent
        vendor_ffmpeg = project_root / "vendor" / "ffmpeg" / "bin" / "ffmpeg.exe"
        if vendor_ffmpeg.exists():
            return vendor_ffmpeg
        brv_root = project_root / "BedReadVoices"
        brv_ffmpeg = brv_root / "vendor" / "ffmpeg" / "bin" / "ffmpeg.exe"
        if brv_ffmpeg.exists():
            return brv_ffmpeg
        path = _sh.which("ffmpeg")
        if path:
            return Path(path)
        try:
            import imageio_ffmpeg as _imf
            exe = _imf.get_ffmpeg_exe()
            if exe and Path(exe).exists():
                return Path(exe)
        except Exception:
            pass
        return None

    def _compress_audio_to_opus(
        self,
        session: AutoAudioSession,
        audio_path: Path,
    ) -> "_CompressedAudio":
        """
        Compress a WAV file to Opus using FFmpeg — matches old BE behavior exactly.
        """
        audio_bytes = audio_path.read_bytes()
        original_size = len(audio_bytes)

        ffmpeg_path = self._find_ffmpeg()
        if not ffmpeg_path:
            session.add_log(6, "FFmpeg not found, uploading original audio as-is (pip install imageio-ffmpeg to enable Opus compression)", level="warning")
            return _CompressedAudio(
                data=audio_bytes,
                name=audio_path.name,
                original=original_size,
                compressed=original_size,
                size=original_size,
            )

        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            output_path = tmp_path / f"{audio_path.stem}.{self.OPUS_EXTENSION}"

            cmd = [
                str(ffmpeg_path),
                "-y",
                "-i", str(audio_path),
                "-vn",
                "-map_metadata", "-1",
                "-c:a", "libopus",
                "-b:a", f"{self.TARGET_BITRATE_KBPS}k",
                "-vbr", "on",
                "-compression_level", "10",
                "-ac", "1",
                str(output_path),
            ]
            result = subprocess.run(cmd, capture_output=True, text=True)
            if result.returncode != 0:
                session.add_log(6, f"FFmpeg error: {result.stderr[:200]}", level="warning")
                return _CompressedAudio(
                    data=audio_bytes,
                    name=audio_path.name,
                    original=original_size,
                    compressed=original_size,
                    size=original_size,
                )

            if not output_path.exists():
                session.add_log(6, "FFmpeg did not produce output file", level="warning")
                return _CompressedAudio(
                    data=audio_bytes,
                    name=audio_path.name,
                    original=original_size,
                    compressed=original_size,
                    size=original_size,
                )

            compressed_size = output_path.stat().st_size

            if compressed_size > self.MAX_AUDIO_SIZE_BYTES:
                session.add_log(
                    6,
                    f"Compressed audio still exceeds {self.MAX_AUDIO_SIZE_BYTES} bytes "
                    f"({compressed_size} bytes, original {original_size})",
                    level="error",
                )
                return _CompressedAudio(
                    data=audio_bytes,
                    name=audio_path.name,
                    original=original_size,
                    compressed=original_size,
                    size=original_size,
                )

            safe_name = audio_path.stem + f".{self.OPUS_EXTENSION}"
            opus_data = output_path.read_bytes()
            reduction_pct = (1 - compressed_size / original_size) * 100 if original_size > 0 else 0
            session.add_log(
                6,
                f"Compressed: {original_size} -> {compressed_size} bytes "
                f"({reduction_pct:.1f}% reduction, {self.TARGET_BITRATE_KBPS}kbps opus)",
            )
            return _CompressedAudio(
                data=opus_data,
                name=safe_name,
                original=original_size,
                compressed=compressed_size,
                size=compressed_size,
            )

    def _delete_local_audio_files(self, session: AutoAudioSession, generated_file: Path) -> None:
        """Delete the local TTS output file after successful upload."""
        deleted = []
        try:
            if generated_file.exists():
                generated_file.unlink()
                deleted.append(str(generated_file))
        except Exception as exc:
            session.add_log(9, f"Failed to delete generated file {generated_file}: {exc}", level="warning")
            return

        if deleted:
            session.add_log(9, f"Deleted {len(deleted)} local audio file(s): {deleted}")

    def _run_session(self, session: AutoAudioSession) -> None:
        session.started_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        session.set_status("running")

        try:
            session.set_step(1, "Validating configuration")
            _get_external_api_config()

            def _update_chapter_progress(missing_list: list[StoryMissingAudio]) -> None:
                total = sum(len(s.missing_chapters) for s in missing_list)
                done = sum(r.get("chapters_uploaded", 0) for r in session.story_results)
                session.update_chapter_progress(done, total)

            test_story_ids: list[str] = []
            if session.test_mode:
                test_story_ids = _get_settings().get("auto_audio_test_story_ids", [])
                if not test_story_ids:
                    raise AutoAudioConfigError(
                        "Test Story IDs are not configured. "
                        "Please set them in Settings > Auto Audio Settings."
                    )
                session.add_log(0, f"Test mode: using {len(test_story_ids)} test story IDs")

            needing_update_ids: set[str] = set()
            needing_update_meta: dict[str, dict] = {}
            if session.phase == "phase1":
                if session.test_mode:
                    needing_update_ids = set(test_story_ids)
                    session.add_log(1, f"Test mode: checking {len(needing_update_ids)} test story IDs")
                    for sid in test_story_ids:
                        meta = self._fetch_story_metadata(sid)
                        if meta:
                            needing_update_meta[sid] = meta
                else:
                    session.set_step(1, "Fetching stories needing update")
                    session.add_log(1, "Phase 1: Fetching stories needing update...")
                    needing_update_raw = self._fetch_stories_needing_update()
                    needing_update_ids = {
                        str(s.get("storyId") or s.get("story_id") or s.get("id"))
                        for s in needing_update_raw
                        if s.get("storyId") or s.get("story_id") or s.get("id")
                    }
                    needing_update_meta = {
                        str(s.get("storyId") or s.get("story_id") or s.get("id")): s
                        for s in needing_update_raw
                    }
                session.add_log(1, f"Found {len(needing_update_ids)} stories needing update")

                if not needing_update_ids:
                    session.add_log(1, "No stories needing update found", level="info")
                    session.set_status("completed")
                    session.add_log(11, "Auto audio session completed (no stories to process)")
                    session.set_step(11, "Saving session log")
                    self._save_session_log(session)
                    self._persist_history(session)
                    return

                session.set_step(1, "Discovering missing audio in stories needing update")
                phase1_missing = self._discover_stories_missing_audio(session, list(needing_update_ids), needing_update_meta)
                session.add_log(1, f"Phase 1: {len(phase1_missing)} stories with missing audio")

                if not phase1_missing:
                    session.add_log(1, "No stories with missing audio found", level="info")
                    session.set_status("completed")
                    session.add_log(11, "Auto audio session completed successfully")
                    session.set_step(11, "Saving session log")
                    self._save_session_log(session)
                    self._persist_history(session)
                    return

                session.set_stories_preview([
                    {"storyId": s.story_id, "title": s.story_title, "missingCount": len(s.missing_chapters), "existingVoice": s.existing_voice}
                    for s in phase1_missing
                ])
                _update_chapter_progress(phase1_missing)

                phase1_missing = self._skip_completed_stories(session, phase1_missing)
                if not phase1_missing:
                    session.add_log(3, "All phase 1 stories already processed — nothing to do")
                    session.set_status("completed")
                    session.add_log(11, "Auto audio session completed successfully")
                    session.set_step(11, "Saving session log")
                    self._save_session_log(session)
                    self._persist_history(session)
                    return

                session.set_step(3, "Processing stories needing update")
                session.update_progress(0, len(phase1_missing))
                self._run_story_pipeline(session, phase1_missing, "phase1")

            elif session.phase == "phase2":
                if session.test_mode:
                    all_story_ids = list(test_story_ids)
                    session.add_log(1, f"Test mode: checking {len(all_story_ids)} test story IDs")
                    all_stories = [{"storyId": sid} for sid in test_story_ids]
                    for s in all_stories:
                        meta = self._fetch_story_metadata(s["storyId"])
                        if meta:
                            s.update(meta)
                else:
                    session.set_step(1, "Fetching all published stories")
                    session.add_log(1, "Phase 2: Fetching all published stories...")
                    all_stories = self._fetch_all_stories()
                    all_story_ids = [
                        str(s.get("storyId") or s.get("story_id") or s.get("id"))
                        for s in all_stories
                        if (s.get("storyId") or s.get("story_id") or s.get("id"))
                    ]
                    session.add_log(1, f"Found {len(all_story_ids)} published stories total")

                if not all_story_ids:
                    session.add_log(1, "No published stories found", level="info")
                    session.set_status("completed")
                    session.add_log(11, "Auto audio session completed (no stories to process)")
                    session.set_step(11, "Saving session log")
                    self._save_session_log(session)
                    self._persist_history(session)
                    return

                phase2_meta = {str(s.get("storyId") or s.get("story_id") or s.get("id")): s for s in all_stories}
                session.set_step(1, "Discovering stories with missing audio")
                phase2_missing = self._discover_stories_missing_audio(session, all_story_ids, phase2_meta)
                session.add_log(1, f"Phase 2: {len(phase2_missing)} stories with missing audio")

                if not phase2_missing:
                    session.add_log(1, "No stories with missing audio found", level="info")
                    session.set_status("completed")
                    session.add_log(11, "Auto audio session completed successfully")
                    session.set_step(11, "Saving session log")
                    self._save_session_log(session)
                    self._persist_history(session)
                    return

                session.set_stories_preview([
                    {"storyId": s.story_id, "title": s.story_title, "missingCount": len(s.missing_chapters), "existingVoice": s.existing_voice}
                    for s in phase2_missing
                ])
                _update_chapter_progress(phase2_missing)

                phase2_missing = self._skip_completed_stories(session, phase2_missing)
                if not phase2_missing:
                    session.add_log(3, "All phase 2 stories already processed — nothing to do")
                    session.set_status("completed")
                    session.add_log(11, "Auto audio session completed successfully")
                    session.set_step(11, "Saving session log")
                    self._save_session_log(session)
                    self._persist_history(session)
                    return

                session.set_step(3, "Processing stories with missing audio")
                session.update_progress(0, len(phase2_missing))
                self._run_story_pipeline(session, phase2_missing, "phase2")

            elif session.phase == "phase3":
                phase_limit = session.limit
                if session.test_mode:
                    recent_story_ids = list(test_story_ids[:phase_limit])
                    session.add_log(1, f"Test mode: checking {len(recent_story_ids)} test story IDs (limit={phase_limit})")
                    recent_stories = [{"storyId": sid} for sid in test_story_ids[:phase_limit]]
                    for s in recent_stories:
                        meta = self._fetch_story_metadata(s["storyId"])
                        if meta:
                            s.update(meta)
                else:
                    session.set_step(1, f"Fetching {phase_limit} most recently updated stories")
                    session.add_log(1, f"Phase 3: Fetching {phase_limit} most recently updated stories...")
                    recent_stories = self._fetch_recent_stories(limit=phase_limit)
                    recent_story_ids = [
                        str(s.get("storyId") or s.get("story_id") or s.get("id"))
                        for s in recent_stories
                        if (s.get("storyId") or s.get("story_id") or s.get("id"))
                    ]
                    session.add_log(1, f"Found {len(recent_story_ids)} recently updated stories")

                if not recent_story_ids:
                    session.add_log(1, "No recently updated stories found", level="info")
                    session.set_status("completed")
                    session.add_log(11, "Auto audio session completed (no stories to process)")
                    session.set_step(11, "Saving session log")
                    self._save_session_log(session)
                    self._persist_history(session)
                    return

                phase3_missing: list[StoryMissingAudio] = []
                session.set_step(1, "Discovering stories with missing audio")
                phase3_meta = {str(s.get("storyId") or s.get("story_id") or s.get("id")): s for s in recent_stories}
                phase3_missing = self._discover_stories_missing_audio(session, recent_story_ids, phase3_meta)
                session.add_log(1, f"Phase 3: {len(phase3_missing)} stories with missing audio")

                if not phase3_missing:
                    session.add_log(1, "No stories with missing audio found", level="info")
                    session.set_status("completed")
                    session.add_log(11, "Auto audio session completed successfully")
                    session.set_step(11, "Saving session log")
                    self._save_session_log(session)
                    self._persist_history(session)
                    return

                session.set_stories_preview([
                    {"storyId": s.story_id, "title": s.story_title, "missingCount": len(s.missing_chapters), "existingVoice": s.existing_voice}
                    for s in phase3_missing
                ])
                _update_chapter_progress(phase3_missing)

                phase3_missing = self._skip_completed_stories(session, phase3_missing)
                if not phase3_missing:
                    session.add_log(3, "All phase 3 stories already processed — nothing to do")
                    session.set_status("completed")
                    session.add_log(11, "Auto audio session completed successfully")
                    session.set_step(11, "Saving session log")
                    self._save_session_log(session)
                    self._persist_history(session)
                    return

                session.set_step(3, "Processing recently updated stories with missing audio")
                session.update_progress(0, len(phase3_missing))
                self._run_story_pipeline(session, phase3_missing, "phase3")

            if session._stopping:
                session.set_status("stopped")
                session.add_log(11, "Auto audio session stopped by user")
            else:
                session.set_status("completed")
                session.add_log(11, "Auto audio session completed successfully")

            session.set_step(11, "Saving session log")
            self._save_session_log(session)
            self._persist_history(session)

            self._active_session = None

        except Exception as exc:
            logger.exception("Auto audio session error")
            session.set_status("error", error=str(exc))
            session.add_log(0, f"Fatal error: {exc}", level="error")
            self._save_session_log(session)
            self._persist_history(session)
            self._active_session = None

    def _run_story_pipeline(
        self,
        session: AutoAudioSession,
        stories: list[StoryMissingAudio],
        phase_name: str,
    ) -> None:
        """
        Process stories in a pipeline: after each story's TTS finishes, start the next
        story's TTS immediately so generation overlaps with the current story's upload.
        """
        if not stories:
            return

        n = len(stories)
        pending_batch: dict | None = None
        next_batch_event = Event()

        def _start_next_batch(next_story: StoryMissingAudio) -> None:
            nonlocal pending_batch
            batch_id, voice, err = self._start_batch_job_for_story(session, next_story)
            if not batch_id:
                pending_batch = {"story": next_story, "batch_id": None, "voice": None,
                                "completed_files": [], "error": err}
            else:
                pending_batch = {"story": next_story, "batch_id": batch_id, "voice": voice,
                                "completed_files": [], "error": None}
            next_batch_event.set()

        i = 0
        while i < n:
            if session._stopping:
                session.add_log(3, "Stop requested, halting pipeline", level="warning")
                session.set_status("stopping")
                break

            story = stories[i]
            session.add_log(3, f"[{i+1}/{n}] {story.story_title}")
            session.set_step(3, f"[{i+1}/{n}] {story.story_title}", story=story.story_title)
            session.update_progress(i + 1, n)

            batch_id, voice, err = self._start_batch_job_for_story(session, story)
            if not batch_id:
                result = StoryResult(story_id=story.story_id, story_title=story.story_title,
                                    chapters_generated=0, chapters_uploaded=0, upload_errors=[], error=err)
                session.add_log(4, f"Failed to start batch job: {err}", level="error")
                self._finalize_story(session, result, story, stories)
                i += 1
                continue

            session.set_step(5, f"Polling batch job for {story.story_title}", story=story.story_title)
            success, completed_files = self._poll_batch_until_done(session, batch_id)
            chapters_gen = len(completed_files)

            if session._stopping:
                result = StoryResult(story_id=story.story_id, story_title=story.story_title,
                                    chapters_generated=chapters_gen, chapters_uploaded=0, upload_errors=[])
                session.add_log(4, f"Stopped mid-poll, {chapters_gen} chapters already done", level="warning")
                self._finalize_story(session, result, story, stories)
                break

            if not success and not completed_files:
                result = StoryResult(story_id=story.story_id, story_title=story.story_title,
                                    chapters_generated=0, chapters_uploaded=0, upload_errors=[],
                                    error="Batch job failed or timed out")
                session.add_log(4, f"Batch job for '{story.story_title}' failed", level="error")
                self._finalize_story(session, result, story, stories)
                i += 1
                continue

            result = StoryResult(story_id=story.story_id, story_title=story.story_title,
                                chapters_generated=chapters_gen, chapters_uploaded=0, upload_errors=[])

            started_next = False
            if i + 1 < n and not session._stopping:
                next_story = stories[i + 1]
                pending_batch = None
                next_batch_event.clear()
                bg = Thread(target=_start_next_batch, args=(next_story,), daemon=True)
                bg.start()
                started_next = True

            self._upload_completed_batch(session, story, batch_id, voice, completed_files, result)
            self._finalize_story(session, result, story, stories)

            if started_next and not session._stopping:
                next_batch_event.wait(timeout=30)
                if session._stopping:
                    if pending_batch and pending_batch.get("batch_id"):
                        try:
                            self._bedread_delete(f"/api/bedread/jobs/{pending_batch['batch_id']}")
                        except Exception:
                            pass
                    break

                if pending_batch is None:
                    session.add_log(4, "Next batch failed to start, continuing sequentially", level="warning")
                elif pending_batch.get("error"):
                    session.add_log(4, f"Next batch failed: {pending_batch['error']}", level="warning")
                elif pending_batch.get("batch_id"):
                    next_story = pending_batch["story"]
                    next_batch_id = pending_batch["batch_id"]
                    next_voice = pending_batch["voice"]

                    session.add_log(3, f"[{i+2}/{n}] {next_story.story_title} (started in background)")
                    session.set_step(5, f"Polling batch job for {next_story.story_title}", story=next_story.story_title)
                    success2, completed_files2 = self._poll_batch_until_done(session, next_batch_id)
                    chapters_gen2 = len(completed_files2)

                    if session._stopping:
                        result2 = StoryResult(story_id=next_story.story_id, story_title=next_story.story_title,
                                            chapters_generated=chapters_gen2, chapters_uploaded=0, upload_errors=[])
                        session.add_log(4, f"Stopped mid-poll (next), {chapters_gen2} chapters already done", level="warning")
                        self._finalize_story(session, result2, next_story, stories)
                        break

                    if not success2 and not completed_files2:
                        result2 = StoryResult(story_id=next_story.story_id, story_title=next_story.story_title,
                                            chapters_generated=0, chapters_uploaded=0, upload_errors=[],
                                            error="Batch job failed or timed out")
                        session.add_log(4, f"Batch job for '{next_story.story_title}' failed", level="error")
                        self._finalize_story(session, result2, next_story, stories)
                    else:
                        result2 = StoryResult(story_id=next_story.story_id, story_title=next_story.story_title,
                                            chapters_generated=chapters_gen2, chapters_uploaded=0, upload_errors=[])
                        self._upload_completed_batch(session, next_story, next_batch_id, next_voice, completed_files2, result2)
                        self._finalize_story(session, result2, next_story, stories)

                    i += 1

            if session._stopping:
                break

            rest_seconds = _get_settings().get("auto_audio_rest_seconds", 30)
            if rest_seconds > 0:
                session.set_step(10, f"Resting {rest_seconds}s before next story")
                session.add_log(10, f"Resting {rest_seconds}s before next story")
                for _ in range(rest_seconds):
                    if session._stopping:
                        break
                    time.sleep(1)

            i += 1

    def _finalize_story(
        self,
        session: AutoAudioSession,
        result: StoryResult,
        story: StoryMissingAudio,
        all_stories: list[StoryMissingAudio],
    ) -> None:
        session.add_story_result(result.to_dict())
        if result.chapters_uploaded > 0:
            session.record_completed_story(story.story_id)
            self._save_completed_stories(session.phase, session.completed_stories)
        total_ch = sum(len(s.missing_chapters) for s in all_stories)
        done_ch = sum(r.get("chapters_uploaded", 0) for r in session.story_results)
        session.update_chapter_progress(done_ch, total_ch)
        session.set_step(7, f"Completed: {story.story_title}", story=story.story_title)
        session.add_log(7, f"Done: generated={result.chapters_generated}, uploaded={result.chapters_uploaded}")

    def start_session(self, phase: str, test_mode: bool, voice: Optional[str], limit: int = 20) -> str:
        if self._active_session is not None:
            existing = self._active_session
            if existing.status in ("running", "stopping"):
                raise RuntimeError("A session is already running. Stop it first.")

        session_id = str(uuid.uuid4())[:8]
        session = AutoAudioSession(
            session_id=session_id,
            phase=phase,
            test_mode=test_mode,
            voice=voice,
            status="idle",
            current_step=0,
            current_step_desc="Initializing",
            current_story="",
            progress={"done": 0, "total": 0},
            chapter_progress={"done": 0, "total": 0},
            stories_missing_audio=[],
            logs=[],
            started_at=None,
            finished_at=None,
            error="",
            limit=limit,
        )

        self._active_session = session
        thread = Thread(target=self._run_session, args=(session,), daemon=True)
        thread.start()

        session.add_log(0, f"Session {session_id} started (phase={phase}, test_mode={test_mode}, voice={'random' if voice is None else voice})")
        session.set_status("running")
        return session_id

    def get_status(self) -> Optional[AutoAudioSession]:
        return self._active_session

    def stop_session(self) -> None:
        if self._active_session is None:
            return
        session = self._active_session
        if session.status in ("completed", "error"):
            return
        session._stopping = True
        session.add_log(0, "Stop requested")
        session.set_status("stopping")

    def get_history(self) -> list[dict]:
        return self._load_history()

    def get_session(self, session_id: str) -> Optional[dict]:
        for session_data in self._load_history():
            if session_data.get("session_id") == session_id:
                return session_data
        active = self._active_session
        if active and active.session_id == session_id:
            return active.to_dict()
        return None

    def delete_session(self, session_id: str) -> bool:
        """Remove a session from history. Returns True if deleted, False if not found."""
        history = self._load_history()
        original_len = len(history)
        history = [s for s in history if s.get("session_id") != session_id]
        if len(history) == original_len:
            return False
        self._persist_sessions(history)
        log_path = self._logs_dir / f"session_{session_id}.json"
        if log_path.exists():
            try:
                log_path.unlink()
            except Exception:
                pass
        return True


_auto_audio_service: Optional[AutoAudioService] = None


def get_auto_audio_service() -> AutoAudioService:
    global _auto_audio_service
    if _auto_audio_service is None:
        _auto_audio_service = AutoAudioService()
    return _auto_audio_service


@dataclass
class _CompressedAudio:
    data: bytes
    name: str
    original: int
    compressed: int
    size: int
