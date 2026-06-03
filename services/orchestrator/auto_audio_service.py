"""Auto Audio service — proxies all operations to the AutoAudio microservice.

FastAPIServer acts as the API gateway. The actual auto-audio orchestration logic
lives in the standalone AutoAudio service.
"""

from __future__ import annotations

import json
import logging
import os
import time
from threading import Lock
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

# Parse SERVICE_URLS JSON env var for the AutoAudio microservice URL.
# This matches the JSON format used by process-compose and the AutoAudio config.
_AUTO_AUDIO_URL: str | None = None


def _autoaudio_url() -> str:
    global _AUTO_AUDIO_URL
    if _AUTO_AUDIO_URL:
        return _AUTO_AUDIO_URL

    # First, try the legacy dotenv-style key (SERVICE_URLS.AutoAudio=http://...)
    url = os.environ.get("SERVICE_URLS.AutoAudio")
    if url:
        _AUTO_AUDIO_URL = url.rstrip("/")
        return _AUTO_AUDIO_URL

    # Fall back to parsing the JSON SERVICE_URLS dict
    raw = os.environ.get("SERVICE_URLS", "{}")
    try:
        urls = json.loads(raw)
        url = urls.get("AutoAudio", "http://localhost:8004")
    except Exception:
        url = "http://localhost:8004"
    _AUTO_AUDIO_URL = url.rstrip("/")
    return _AUTO_AUDIO_URL


# ── Re-exported types (mirrored from AutoAudio for backward compatibility) ──


class AutoAudioConfigError(Exception):
    """Raised when required auto audio configuration is missing."""
    pass


class AutoAudioServiceProxy:
    """
    Thin proxy that delegates all auto-audio operations to the AutoAudio
    microservice over HTTP. Maintains a local cache with a 5-second TTL so
    frequent polls (e.g. status every 2s, history every 10s) don't each
    trigger a full round-trip to the AutoAudio service.
    """

    _CACHE_TTL = 5.0  # seconds
    _STATUS_CACHE_TTL = 1.0  # seconds

    def __init__(self) -> None:
        self._active_session: Optional[dict] = None
        self._cache: dict[str, tuple[float, object]] = {}
        self._lock = Lock()
        self._client = httpx.Client(
            timeout=30.0,
            limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
        )

    def _cached_get(self, key: str, fetch_fn) -> object:
        """Return cached value if fresh, otherwise fetch and cache it."""
        now = time.monotonic()
        ttl = self._STATUS_CACHE_TTL if key.startswith("status") else self._CACHE_TTL
        with self._lock:
            if key in self._cache:
                ts, val = self._cache[key]
                if now - ts < ttl:
                    return val
            val = fetch_fn()
            self._cache[key] = (now, val)
            return val

    def _invalidate_cache(self, *keys: str) -> None:
        with self._lock:
            for k in keys:
                if k == "status":
                    for existing_key in list(self._cache):
                        if existing_key.startswith("status"):
                            self._cache.pop(existing_key, None)
                else:
                    self._cache.pop(k, None)

    def _normalize_status_summary(self, data: Optional[dict]) -> Optional[dict]:
        if data is None:
            return None
        if "progress" in data and "logs" in data and "chapter_progress" in data:
            return data

        total_stories = int(data.get("total_stories", 0) or 0)
        total_chapters = int(data.get("total_chapters", 0) or 0)
        status = data.get("status", "")
        done_status = status in ("completed", "error", "stopped")

        return {
            **data,
            "current_story": data.get("current_story", ""),
            "progress": data.get(
                "progress",
                {"done": total_stories if done_status else 0, "total": total_stories},
            ),
            "chapter_progress": data.get(
                "chapter_progress",
                {"done": total_chapters if done_status else 0, "total": total_chapters},
            ),
            "stories_missing_audio": data.get("stories_missing_audio", []),
            "logs": data.get("logs", []),
            "story_results": data.get("story_results", []),
            "is_paused": data.get("is_paused", False),
        }

    def start_session(
        self,
        phase: str,
        test_mode: bool,
        voice: Optional[str],
        limit: int = 20,
    ) -> str:
        self._invalidate_cache("status", "history")
        url = f"{_autoaudio_url()}/api/auto-audio/start"
        resp = self._client.post(url, json={
            "phase": phase,
            "test_mode": test_mode,
            "voice": voice,
            "limit": limit,
        }, timeout=30.0)
        resp.raise_for_status()
        data = resp.json()
        return data["session_id"]

    def get_status(
        self,
        log_limit: Optional[int] = None,
        result_limit: Optional[int] = None,
        compact: bool = False,
    ) -> Optional[dict]:
        cache_key = f"status:{int(compact)}:{log_limit}:{result_limit}"

        def fetch() -> Optional[dict]:
            url = f"{_autoaudio_url()}/api/auto-audio/status"
            params: dict[str, object] = {}
            if log_limit is not None:
                params["log_limit"] = log_limit
            if result_limit is not None:
                params["result_limit"] = result_limit
            if compact:
                params["compact"] = "true"
            resp = self._client.get(url, params=params, timeout=30.0)
            if resp.status_code == 200:
                return self._normalize_status_summary(resp.json())
            return None

        return self._cached_get(cache_key, fetch)

    def stop_session(self) -> None:
        self._invalidate_cache("status")
        url = f"{_autoaudio_url()}/api/auto-audio/stop"
        resp = self._client.post(url, timeout=30.0)
        resp.raise_for_status()

    def pause_session(self) -> dict:
        self._invalidate_cache("status")
        url = f"{_autoaudio_url()}/api/auto-audio/pause"
        resp = self._client.post(url, timeout=30.0)
        resp.raise_for_status()
        return resp.json()

    def resume_session(self) -> dict:
        self._invalidate_cache("status")
        url = f"{_autoaudio_url()}/api/auto-audio/resume"
        resp = self._client.post(url, timeout=30.0)
        resp.raise_for_status()
        return resp.json()

    def get_history(self) -> list[dict]:
        def fetch() -> list[dict]:
            url = f"{_autoaudio_url()}/api/auto-audio/history"
            resp = self._client.get(url, timeout=30.0)
            resp.raise_for_status()
            return resp.json()

        return self._cached_get("history", fetch)

    def get_session(self, session_id: str) -> Optional[dict]:
        # Build a per-session cache key so individual session detail loads
        # are cached independently and don't invalidate the whole history list.
        key = f"session:{session_id}"

        def fetch() -> Optional[dict]:
            url = f"{_autoaudio_url()}/api/auto-audio/history/{session_id}"
            resp = self._client.get(url, timeout=30.0)
            if resp.status_code == 404:
                return None
            resp.raise_for_status()
            return resp.json()

        return self._cached_get(key, fetch)

    def delete_session(self, session_id: str) -> bool:
        self._invalidate_cache("status", "history", f"session:{session_id}")
        url = f"{_autoaudio_url()}/api/auto-audio/history/{session_id}"
        resp = self._client.delete(url, timeout=30.0)
        if resp.status_code == 404:
            return False
        resp.raise_for_status()
        return True

    def delete_sessions_batch(self, session_ids: list[str]) -> int:
        self._invalidate_cache("status", "history", *[f"session:{sid}" for sid in session_ids])
        url = f"{_autoaudio_url()}/api/auto-audio/history/batch-delete"
        resp = self._client.post(url, json={"session_ids": session_ids}, timeout=30.0)
        resp.raise_for_status()
        return resp.json().get("deleted", 0)


_auto_audio_service: Optional[AutoAudioServiceProxy] = None


def get_auto_audio_service() -> AutoAudioServiceProxy:
    global _auto_audio_service
    if _auto_audio_service is None:
        _auto_audio_service = AutoAudioServiceProxy()
    return _auto_audio_service
