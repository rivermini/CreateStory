"""Settings API composed from Gateway, AutoAudio, and BedReadVoices ownership."""

from __future__ import annotations

import logging
import os
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from api.auth import require_active_user, require_operator
from api.db import get_db
from api.middleware import get_shared_http_client
from api.models.settings import SettingsResponse, SettingsUpdateRequest
from api.repositories.shared_state import SETTINGS_KEY, SharedStateRepository

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/settings", tags=["Settings"])

_GATEWAY_DEFAULTS = {
    "theme": "light",
    "crawl_mode": "count",
    "crawl_default_count": 10,
    "crawl_default_range_from": 1,
    "crawl_default_range_to": 10,
    "crawl_auto_max_chapters": False,
}
_AUTO_DEFAULTS = {
    "auto_audio_rest_seconds": 0,
    "auto_audio_upload_workers": 3,
    "auto_audio_batch_window": 2,
    "auto_audio_external_api_base": "",
    "auto_audio_test_story_ids": [
        "ce6176c4-aeb5-4ee1-847f-ee56df64a386",
        "07d59e98-d693-429b-a9d1-53ce2fd89e55",
    ],
}
_TTS_DEFAULTS = {"tts_concurrency": 1}
_GATEWAY_KEYS = frozenset(_GATEWAY_DEFAULTS)
_AUTO_KEYS = frozenset(_AUTO_DEFAULTS)

_auto_cache: dict = dict(_AUTO_DEFAULTS)
_tts_cache: dict = dict(_TTS_DEFAULTS)


def reset_worker_settings_cache() -> None:
    """Reset last-known worker settings after an explicit development wipe."""
    global _auto_cache, _tts_cache
    _auto_cache = dict(_AUTO_DEFAULTS)
    _tts_cache = dict(_TTS_DEFAULTS)


def _auto_url() -> str:
    return os.environ.get("SERVICE_URLS_AutoAudio", "http://localhost:8004").rstrip("/")


def _voices_url() -> str:
    return os.environ.get("SERVICE_URLS_BedReadVoices", "http://localhost:8001").rstrip("/")


def _load_gateway_settings(db: Session) -> dict:
    repo = SharedStateRepository(db)
    stored = repo.get_setting(SETTINGS_KEY) or {}
    # Strip legacy worker-owned fields whenever this row is rewritten.
    owned = {key: value for key, value in stored.items() if key in _GATEWAY_KEYS}
    data = {**_GATEWAY_DEFAULTS, **owned}
    if stored != data:
        repo.upsert_setting(SETTINGS_KEY, data)
    return data


async def _load_worker_settings(client: httpx.AsyncClient) -> tuple[dict, dict]:
    global _auto_cache, _tts_cache
    try:
        response = await client.get(f"{_auto_url()}/api/auto-audio/settings", timeout=10.0)
        response.raise_for_status()
        _auto_cache = {**_AUTO_DEFAULTS, **response.json()}
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("AutoAudio settings unavailable; using last known values: %s", exc)

    try:
        response = await client.get(f"{_voices_url()}/api/tts/concurrency", timeout=10.0)
        response.raise_for_status()
        payload = response.json()
        _tts_cache = {"tts_concurrency": int(payload.get("concurrency", 1))}
    except (httpx.HTTPError, ValueError, TypeError) as exc:
        logger.warning("BedReadVoices settings unavailable; using last known values: %s", exc)
    return dict(_auto_cache), dict(_tts_cache)


async def _combined_settings(db: Session, client: httpx.AsyncClient) -> dict:
    auto, tts = await _load_worker_settings(client)
    return {**_load_gateway_settings(db), **auto, **tts}


@router.get("", response_model=SettingsResponse)
async def get_settings(
    db: Annotated[Session, Depends(get_db)],
    client: Annotated[httpx.AsyncClient, Depends(get_shared_http_client)],
    _user=Depends(require_active_user),
) -> SettingsResponse:
    return SettingsResponse(**(await _combined_settings(db, client)))


@router.put("", response_model=SettingsResponse)
async def update_settings(
    req: SettingsUpdateRequest,
    db: Annotated[Session, Depends(get_db)],
    client: Annotated[httpx.AsyncClient, Depends(get_shared_http_client)],
    _operator=Depends(require_operator),
) -> SettingsResponse:
    updates = req.model_dump(exclude_unset=True, exclude_none=True)
    if updates.get("theme") not in (None, "light", "dark"):
        raise HTTPException(status_code=400, detail="theme must be 'light' or 'dark'")
    if updates.get("crawl_mode") not in (None, "count", "range"):
        raise HTTPException(status_code=400, detail="crawl_mode must be 'count' or 'range'")

    auto_updates = {key: value for key, value in updates.items() if key in _AUTO_KEYS}
    if auto_updates:
        try:
            response = await client.put(
                f"{_auto_url()}/api/auto-audio/settings",
                json=auto_updates,
                timeout=15.0,
            )
            response.raise_for_status()
            global _auto_cache
            _auto_cache = {**_AUTO_DEFAULTS, **response.json()}
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=502, detail="AutoAudio settings service is unavailable.") from exc

    if "tts_concurrency" in updates:
        try:
            response = await client.post(
                f"{_voices_url()}/api/tts/concurrency",
                json={"concurrency": updates["tts_concurrency"]},
                timeout=15.0,
            )
            response.raise_for_status()
            global _tts_cache
            _tts_cache = {"tts_concurrency": int(response.json()["concurrency"])}
        except (httpx.HTTPError, KeyError, TypeError, ValueError) as exc:
            raise HTTPException(status_code=502, detail="BedReadVoices settings service is unavailable.") from exc

    gateway = _load_gateway_settings(db)
    gateway.update({key: value for key, value in updates.items() if key in _GATEWAY_KEYS})
    try:
        SharedStateRepository(db).upsert_setting(SETTINGS_KEY, gateway)
    except Exception as exc:
        logger.exception("Failed to save Gateway settings")
        raise HTTPException(status_code=500, detail="Failed to save settings.") from exc

    return SettingsResponse(**{**gateway, **_auto_cache, **_tts_cache})
