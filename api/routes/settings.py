"""Settings API: shared crawl defaults and user preferences."""

from __future__ import annotations

import httpx
import logging
import os
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from api.auth import require_active_user, require_admin
from api.db import get_db
from api.middleware import get_shared_http_client
from api.models.settings import SettingsResponse, SettingsUpdateRequest
from api.repositories.shared_state import SETTINGS_KEY, SharedStateRepository

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/settings", tags=["Settings"])

_SETTINGS_EXAMPLE = {
    "theme": "light",
    "crawl_mode": "count",
    "crawl_default_count": 10,
    "crawl_default_range_from": 1,
    "crawl_default_range_to": 10,
    "crawl_auto_max_chapters": False,
    "auto_audio_rest_seconds": 0,
    "auto_audio_upload_workers": 3,
    "auto_audio_batch_window": 2,
    "auto_audio_external_api_base": "",
    "auto_audio_test_story_ids": [
        "ce6176c4-aeb5-4ee1-847f-ee56df64a386",
        "07d59e98-d693-429b-a9d1-53ce2fd89e55",
    ],
    "tts_concurrency": 1,
}


async def _propagate_tts_concurrency(concurrency: int | None, client: httpx.AsyncClient) -> None:
    """Tell BedReadVoices to update its TTS worker concurrency (async)."""
    bv_url = os.environ.get("SERVICE_URLS_BedReadVoices", "http://localhost:8001").rstrip("/")
    if concurrency is None:
        concurrency = 1
    try:
        resp = await client.post(f"{bv_url}/api/tts/concurrency", json={"concurrency": concurrency})
        resp.raise_for_status()
        logger.info("Propagated tts_concurrency=%s to BedReadVoices.", concurrency)
    except Exception as exc:
        logger.warning("Failed to propagate tts_concurrency to BedReadVoices: %s", exc)


def _load_settings(db: Session) -> dict:
    """Load settings from PostgreSQL, seeding defaults when needed."""
    repo = SharedStateRepository(db)
    stored = repo.get_setting(SETTINGS_KEY)
    if stored is not None:
        return {**_SETTINGS_EXAMPLE, **stored}

    repo.upsert_setting(SETTINGS_KEY, _SETTINGS_EXAMPLE)
    return _SETTINGS_EXAMPLE


def _save_settings(db: Session, data: dict) -> None:
    """Persist settings to PostgreSQL."""
    try:
        SharedStateRepository(db).upsert_setting(SETTINGS_KEY, data)
    except Exception as exc:
        logger.error("Failed to save settings: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to save settings.")


@router.get("", response_model=SettingsResponse)
async def get_settings(
    db: Annotated[Session, Depends(get_db)],
    client: Annotated[httpx.AsyncClient, Depends(get_shared_http_client)],
    _user=Depends(require_active_user),
) -> SettingsResponse:
    """Return current shared settings."""
    data = _load_settings(db)
    await _propagate_tts_concurrency(data.get("tts_concurrency"), client)
    return SettingsResponse(**data)


@router.put("", response_model=SettingsResponse)
async def update_settings(
    req: SettingsUpdateRequest,
    db: Annotated[Session, Depends(get_db)],
    client: Annotated[httpx.AsyncClient, Depends(get_shared_http_client)],
    _admin=Depends(require_admin),
) -> SettingsResponse:
    """Partially update shared settings. Only explicitly sent fields are updated."""
    data = _load_settings(db)

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
    if req.auto_audio_upload_workers is not None:
        data["auto_audio_upload_workers"] = req.auto_audio_upload_workers
    if req.auto_audio_batch_window is not None:
        data["auto_audio_batch_window"] = req.auto_audio_batch_window
    if req.auto_audio_external_api_base is not None:
        data["auto_audio_external_api_base"] = req.auto_audio_external_api_base
    if req.auto_audio_test_story_ids is not None:
        data["auto_audio_test_story_ids"] = req.auto_audio_test_story_ids
    if "tts_concurrency" in req.model_fields_set:
        data["tts_concurrency"] = req.tts_concurrency or 1
        await _propagate_tts_concurrency(data["tts_concurrency"], client)

    _save_settings(db, data)
    logger.info("Settings updated: %s", data)
    return SettingsResponse(**data)
