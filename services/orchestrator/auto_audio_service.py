"""Auto Audio service — proxies all operations to the BedReadVoices microservice.

FastAPIServer acts as the API gateway. The actual auto-audio orchestration logic
lives in the BedReadVoices service.
"""

from __future__ import annotations

import logging
import os
from typing import Optional

import httpx

logger = logging.getLogger(__name__)


def _bedreadvoices_url() -> str:
    return os.environ.get("SERVICE_URLS_BedReadVoices", "http://localhost:8001").rstrip("/")


# ── Re-exported types (mirrored from BedReadVoices for backward compatibility) ──


class AutoAudioConfigError(Exception):
    """Raised when required auto audio configuration is missing."""
    pass


class AutoAudioServiceProxy:
    """
    Thin proxy that delegates all auto-audio operations to the BedReadVoices
    microservice over HTTP. Maintains local session state so the FastAPIServer
    routes can query status/history without round-trips.
    """

    def __init__(self) -> None:
        self._active_session: Optional[dict] = None

    def start_session(
        self,
        phase: str,
        test_mode: bool,
        voice: Optional[str],
        limit: int = 20,
    ) -> str:
        url = f"{_bedreadvoices_url()}/api/auto-audio/start"
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
        url = f"{_bedreadvoices_url()}/api/auto-audio/status"
        with httpx.Client(timeout=30.0) as client:
            resp = client.get(url)
            if resp.status_code == 200:
                return resp.json()
            return None

    def stop_session(self) -> None:
        url = f"{_bedreadvoices_url()}/api/auto-audio/stop"
        with httpx.Client(timeout=30.0) as client:
            client.post(url)

    def get_history(self) -> list[dict]:
        url = f"{_bedreadvoices_url()}/api/auto-audio/history"
        with httpx.Client(timeout=30.0) as client:
            resp = client.get(url)
            resp.raise_for_status()
            return resp.json()

    def get_session(self, session_id: str) -> Optional[dict]:
        url = f"{_bedreadvoices_url()}/api/auto-audio/history/{session_id}"
        with httpx.Client(timeout=30.0) as client:
            resp = client.get(url)
            if resp.status_code == 404:
                return None
            resp.raise_for_status()
            return resp.json()

    def delete_session(self, session_id: str) -> bool:
        url = f"{_bedreadvoices_url()}/api/auto-audio/history/{session_id}"
        with httpx.Client(timeout=30.0) as client:
            resp = client.delete(url)
            if resp.status_code == 404:
                return False
            resp.raise_for_status()
            return True


_auto_audio_service: Optional[AutoAudioServiceProxy] = None


def get_auto_audio_service() -> AutoAudioServiceProxy:
    global _auto_audio_service
    if _auto_audio_service is None:
        _auto_audio_service = AutoAudioServiceProxy()
    return _auto_audio_service
