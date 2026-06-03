"""BedReadVoices client for the AutoAudio service."""

from __future__ import annotations

import random
import tempfile
from pathlib import Path
from typing import Optional

import httpx

from core.config import _get_bedreadvoices_url
from core.models import StoryMissingAudio


_AVAILABLE_VOICES = ["af_heart", "af_bella"]


class BedReadClient:
    """Client for the BedReadVoices batch generation endpoints."""

    def __init__(self) -> None:
        self._bedread_url = _get_bedreadvoices_url()
        self._client = httpx.Client(
            timeout=30.0,
            limits=httpx.Limits(max_connections=30, max_keepalive_connections=15),
        )

    def start_batch(
        self,
        story: StoryMissingAudio,
        voice: Optional[str],
    ) -> tuple[Optional[str], Optional[str], str]:
        chapter_numbers = [c.chapter_index for c in story.missing_chapters]
        if not chapter_numbers:
            return None, None, "No chapters to generate"

        chosen_voice = voice or story.existing_voice or random.choice(_AVAILABLE_VOICES)
        voice_source = "session" if voice else ("existing" if story.existing_voice else "random")

        try:
            resp = self._post("/api/bedread/generate", {
                "story_id": story.story_id,
                "story_title": story.story_title,
                "chapter_numbers": sorted(chapter_numbers),
                "voice": chosen_voice,
                "lang": "en-us",
                "speed": 0.69,
                "format": "wav",
                "from_auto_mode": True,
            })
            batch_id = resp.get("batch_id", "")
            return batch_id, chosen_voice, ""
        except Exception as exc:
            return None, None, str(exc)

    def get_batch_job(self, batch_id: str) -> Optional[dict]:
        resp = self._client.get(
            f"{self._bedread_url}/api/bedread/jobs/{batch_id}",
            timeout=30.0,
        )
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        return resp.json()

    def delete_batch_job(self, batch_id: str) -> None:
        url = f"{self._bedread_url}/api/bedread/jobs/{batch_id}"
        resp = self._client.delete(url, timeout=30.0)
        if resp.status_code == 404:
            return
        resp.raise_for_status()

    def delete_batch_output(self, batch_id: str) -> bool:
        url = f"{self._bedread_url}/api/bedread/jobs/{batch_id}/output"
        try:
            resp = self._client.delete(url, timeout=30.0)
            return resp.status_code == 200
        except Exception:
            return False

    def download_chapter(
        self,
        batch_id: str,
        chapter_num: int,
        filename: Optional[str] = None,
    ) -> Optional[Path]:
        url = f"{self._bedread_url}/api/bedread/jobs/{batch_id}/download?chapter={chapter_num}"
        try:
            resp = self._client.get(url, timeout=300.0)
            if resp.status_code == 404:
                return None
            resp.raise_for_status()
            tmp_dir = Path(tempfile.gettempdir()) / f"autoaudio_{batch_id}"
            tmp_dir.mkdir(parents=True, exist_ok=True)
            suffix = Path(filename).suffix if filename else ".wav"
            out_path = tmp_dir / f"chapter_{chapter_num}{suffix or '.wav'}"
            out_path.write_bytes(resp.content)
            return out_path
        except Exception:
            return None

    def _post(self, path: str, json_data: dict) -> dict:
        url = f"{self._bedread_url}{path}"
        resp = self._client.post(url, json=json_data, timeout=300.0)
        resp.raise_for_status()
        return resp.json()

    def _get(self, path: str) -> Optional[dict]:
        url = f"{self._bedread_url}{path}"
        resp = self._client.get(url, timeout=30.0)
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        return resp.json()
