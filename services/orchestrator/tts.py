"""TTS integration for the auto-audio service."""

from __future__ import annotations

import time
from pathlib import Path
from typing import Optional

import httpx

from .config import _get_bedreadvoices_url


class TTSClient:
    """Client for the BedReadVoices TTS endpoints."""

    def __init__(self) -> None:
        self._bedread_url = _get_bedreadvoices_url()

    def speak(self, text: str, voice: str, lang: str, speed: float, format: str) -> Optional[str]:
        try:
            resp = self._post("/api/tts/speak", {
                "text": text,
                "voice": voice,
                "lang": lang,
                "speed": speed,
                "format": format,
            })
            return resp.get("job_id")
        except Exception:
            return None

    def get_job(self, job_id: str) -> Optional[dict]:
        try:
            return self._get(f"/api/tts/jobs/{job_id}")
        except Exception:
            return None

    def poll_until_done(self, job_id: str, timeout: int = 0) -> tuple[bool, Optional[Path]]:
        start = time.time()
        while timeout <= 0 or time.time() - start < timeout:
            job = self.get_job(job_id)
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

    def _post(self, path: str, json_data: dict) -> dict:
        url = f"{self._bedread_url}{path}"
        with httpx.Client(timeout=300.0) as client:
            resp = client.post(url, json=json_data)
            resp.raise_for_status()
            return resp.json()

    def _get(self, path: str) -> dict | None:
        url = f"{self._bedread_url}{path}"
        with httpx.Client(timeout=30.0) as client:
            resp = client.get(url)
            if resp.status_code == 404:
                return None
            resp.raise_for_status()
            return resp.json()
