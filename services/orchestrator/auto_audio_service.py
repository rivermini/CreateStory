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

    def __init__(self) -> None:
        self._active_session: Optional[dict] = None
        self._cache: dict[str, tuple[float, object]] = {}
        self._lock = Lock()

    def _cached_get(self, key: str, fetch_fn) -> object:
        """Return cached value if fresh, otherwise fetch and cache it."""
        now = time.monotonic()
        with self._lock:
            if key in self._cache:
                ts, val = self._cache[key]
                if now - ts < self._CACHE_TTL:
                    return val
            val = fetch_fn()
            self._cache[key] = (now, val)
            return val

    def _invalidate_cache(self, *keys: str) -> None:
        with self._lock:
            for k in keys:
                self._cache.pop(k, None)

    def start_session(
        self,
        phase: str,
        test_mode: bool,
        voice: Optional[str],
        limit: int = 20,
    ) -> str:
        self._invalidate_cache("status", "history")
        url = f"{_autoaudio_url()}/api/auto-audio/start"
        with httpx.Client(timeout=30.0) as client:
            resp = client.post(url, json={
                "phase": phase,
                "test_mode": test_mode,
                "voice": voice,
                "limit": limit,
            })
            resp.raise_for_status()
            data = resp.json()
            return data["session_id"]

    def get_status(self) -> Optional[dict]:
        def fetch() -> Optional[dict]:
            url = f"{_autoaudio_url()}/api/auto-audio/status"
            with httpx.Client(timeout=30.0) as client:
                resp = client.get(url)
                if resp.status_code == 200:
                    return resp.json()
                return None

        return self._cached_get("status", fetch)

    def stop_session(self) -> None:
        self._invalidate_cache("status")
        url = f"{_autoaudio_url()}/api/auto-audio/stop"
        with httpx.Client(timeout=30.0) as client:
            resp = client.post(url)
            resp.raise_for_status()

    def pause_session(self) -> dict:
        self._invalidate_cache("status")
        url = f"{_autoaudio_url()}/api/auto-audio/pause"
        with httpx.Client(timeout=30.0) as client:
            resp = client.post(url)
            resp.raise_for_status()
            return resp.json()

    def resume_session(self) -> dict:
        self._invalidate_cache("status")
        url = f"{_autoaudio_url()}/api/auto-audio/resume"
        with httpx.Client(timeout=30.0) as client:
            resp = client.post(url)
            resp.raise_for_status()
            return resp.json()

    def get_history(self) -> list[dict]:
        def fetch() -> list[dict]:
            import time
            t0 = time.monotonic()
            url = f"{_autoaudio_url()}/api/auto-audio/history"
            with httpx.Client(timeout=30.0) as client:
                resp = client.get(url)
                resp.raise_for_status()
                logger.info("AutoAudioServiceProxy.get_history: upstream took %.1fms", (time.monotonic() - t0) * 1000)
                return resp.json()

        return self._cached_get("history", fetch)

    def get_session(self, session_id: str) -> Optional[dict]:
        # Build a per-session cache key so individual session detail loads
        # are cached independently and don't invalidate the whole history list.
        key = f"session:{session_id}"

        def fetch() -> Optional[dict]:
            url = f"{_autoaudio_url()}/api/auto-audio/history/{session_id}"
            with httpx.Client(timeout=30.0) as client:
                resp = client.get(url)
                if resp.status_code == 404:
                    return None
                resp.raise_for_status()
                return resp.json()

        return self._cached_get(key, fetch)

    def delete_session(self, session_id: str) -> bool:
        self._invalidate_cache("status", "history", f"session:{session_id}")
        url = f"{_autoaudio_url()}/api/auto-audio/history/{session_id}"
        with httpx.Client(timeout=30.0) as client:
            resp = client.delete(url)
            if resp.status_code == 404:
                return False
            resp.raise_for_status()
            return True

    def delete_sessions_batch(self, session_ids: list[str]) -> int:
        self._invalidate_cache("status", "history", *[f"session:{sid}" for sid in session_ids])
        url = f"{_autoaudio_url()}/api/auto-audio/history/batch-delete"
        with httpx.Client(timeout=30.0) as client:
            resp = client.post(url, json={"session_ids": session_ids})
            resp.raise_for_status()
            return resp.json().get("deleted", 0)


_auto_audio_service: Optional[AutoAudioServiceProxy] = None


def get_auto_audio_service() -> AutoAudioServiceProxy:
    global _auto_audio_service
    if _auto_audio_service is None:
        _auto_audio_service = AutoAudioServiceProxy()
    return _auto_audio_service
