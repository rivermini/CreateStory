"""Settings API — persisted crawl defaults and user preferences."""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from api.models.settings import SettingsResponse, SettingsUpdateRequest

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/settings", tags=["Settings"])

SETTINGS_FILE = Path(__file__).parent.parent.parent / "data" / "user_settings.json"


def _write_example_file(path: Path, example: dict) -> None:
    """Write example defaults to disk for the user to see and edit."""
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(example, f, indent=2)
    except Exception:
        pass  # Non-critical — user can still see defaults in API response


_SETTINGS_EXAMPLE = {
    "theme": "light",
    "crawl_mode": "count",
    "crawl_default_count": 10,
    "crawl_default_range_from": 1,
    "crawl_default_range_to": 10,
    "crawl_auto_max_chapters": False,
    "auto_audio_rest_seconds": 30,
    "auto_audio_external_api_base": "",
    "auto_audio_test_story_ids": [
        "ce6176c4-aeb5-4ee1-847f-ee56df64a386",
        "07d59e98-d693-429b-a9d1-53ce2fd89e55",
    ],
    "tts_concurrency": None,
}


def _propagate_tts_concurrency(concurrency: int | None) -> None:
    """Tell BedReadVoices to update its TTS worker concurrency."""
    import httpx
    bv_url = os.environ.get("SERVICE_URLS_BedReadVoices", "http://localhost:8001").rstrip("/")
    try:
        with httpx.Client(timeout=10.0) as client:
            resp = client.post(f"{bv_url}/api/tts/concurrency", json={"concurrency": concurrency})
            resp.raise_for_status()
            logger.info("Propagated tts_concurrency=%s to BedReadVoices.", concurrency if concurrency is not None else "auto")
    except Exception as exc:
        logger.warning("Failed to propagate tts_concurrency to BedReadVoices: %s", exc)


def _load_settings() -> dict:
    """Load settings from disk, returning defaults if absent or corrupted."""
    try:
        SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
        if SETTINGS_FILE.exists():
            with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
                return {**_SETTINGS_EXAMPLE, **json.load(f)}
    except Exception as exc:
        logger.warning("Failed to load settings, using defaults: %s", exc)
    # First load — write example defaults to disk for the user to see/edit
    _write_example_file(SETTINGS_FILE, _SETTINGS_EXAMPLE)
    return _SETTINGS_EXAMPLE


def _save_settings(data: dict) -> None:
    """Persist settings to disk."""
    try:
        SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
    except Exception as exc:
        logger.error("Failed to save settings: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to save settings.")


@router.get("", response_model=SettingsResponse)
async def get_settings() -> SettingsResponse:
    """Return current user settings."""
    data = _load_settings()
    _propagate_tts_concurrency(data.get("tts_concurrency"))
    return SettingsResponse(**data)


@router.put("", response_model=SettingsResponse)
async def update_settings(req: SettingsUpdateRequest) -> SettingsResponse:
    """Partially update user settings. Only explicitly sent fields are updated."""
    data = _load_settings()

    if req.theme is not None:
        if req.theme not in ("light", "dark"):
            raise HTTPException(status_code=400, detail="theme must be 'light' or 'dark'")
        data["theme"] = req.theme

    if req.crawl_mode is not None:
        if req.crawl_mode not in ("count", "range"):
            raise HTTPException(status_code=400, detail="crawl_mode must be 'count' or 'range'")
        data["crawl_mode"] = req.crawl_mode

    if req.crawl_default_count is not None:
        data["crawl_default_count"] = req.crawl_default_count
    if req.crawl_default_range_from is not None:
        data["crawl_default_range_from"] = req.crawl_default_range_from
    if req.crawl_default_range_to is not None:
        data["crawl_default_range_to"] = req.crawl_default_range_to
    if req.crawl_auto_max_chapters is not None:
        data["crawl_auto_max_chapters"] = req.crawl_auto_max_chapters
    if req.auto_audio_rest_seconds is not None:
        data["auto_audio_rest_seconds"] = req.auto_audio_rest_seconds
    if req.auto_audio_external_api_base is not None:
        data["auto_audio_external_api_base"] = req.auto_audio_external_api_base
    if req.auto_audio_test_story_ids is not None:
        data["auto_audio_test_story_ids"] = req.auto_audio_test_story_ids
    if "tts_concurrency" in req.model_fields_set:
        data["tts_concurrency"] = req.tts_concurrency
        _propagate_tts_concurrency(req.tts_concurrency)

    _save_settings(data)
    logger.info("Settings updated: %s", data)
    return SettingsResponse(**data)
