"""Configuration owned by BedReadVoices and read from DriveSync."""

from __future__ import annotations

import logging
import os
import time

import httpx

from api.db import SessionLocal, init_db
from api.models.db_models import AppSetting
from api.service_auth import internal_service_headers

logger = logging.getLogger(__name__)

_TTS_SETTINGS_KEY = "tts_settings"
_external_config_cache: dict | None = None
_external_config_cache_time = 0.0
_EXTERNAL_CONFIG_CACHE_TTL = 30.0
_EXTERNAL_CONFIG_STALE_TTL = 300.0


def reset_external_config_cache() -> None:
    """Discard DriveSync configuration cached by this service."""
    global _external_config_cache, _external_config_cache_time
    _external_config_cache = None
    _external_config_cache_time = 0.0


def load_tts_settings() -> dict:
    init_db()
    with SessionLocal() as db:
        row = db.get(AppSetting, _TTS_SETTINGS_KEY)
        return dict(row.value) if row is not None else {}


def save_tts_settings(value: dict) -> dict:
    init_db()
    with SessionLocal() as db:
        db.merge(AppSetting(key=_TTS_SETTINGS_KEY, value=value))
        db.commit()
    return value


def _drive_sync_url() -> str:
    return os.environ.get("SERVICE_URLS_BedReadDriveSync", "http://localhost:8003").rstrip("/")


def load_external_api_config() -> dict:
    """Fetch DriveSync-owned external API configuration through its internal API."""
    global _external_config_cache, _external_config_cache_time
    now = time.monotonic()
    config: dict = {}
    if _external_config_cache is not None and now - _external_config_cache_time < _EXTERNAL_CONFIG_CACHE_TTL:
        config = dict(_external_config_cache)
    else:
        try:
            with httpx.Client(timeout=10.0, headers=internal_service_headers()) as client:
                response = client.get(f"{_drive_sync_url()}/internal/v1/external-api-config")
                response.raise_for_status()
                config = response.json()
            _external_config_cache = dict(config)
            _external_config_cache_time = now
        except (httpx.HTTPError, ValueError) as exc:
            if (
                _external_config_cache is None
                or now - _external_config_cache_time > _EXTERNAL_CONFIG_STALE_TTL
            ):
                raise DriveSyncConfigError(
                    "Drive Sync configuration service is unavailable. Please try again shortly."
                ) from exc
            logger.warning("DriveSync config unavailable; using last known config: %s", exc)
            config = dict(_external_config_cache)

    api_url = (config.get("external_api_base_url") or "").strip()
    user_id = (config.get("external_api_user_id") or "").strip()
    if not api_url:
        raise DriveSyncConfigError("External API Base URL is not configured.")
    if not user_id:
        raise DriveSyncConfigError("External API user ID is not configured.")
    return {
        "main_be_api_base_url": api_url.rstrip("/"),
        "main_be_user_id": user_id,
        "main_be_bearer_token": (config.get("external_api_token") or "").strip(),
    }


class DriveSyncConfigError(Exception):
    """Raised when required DriveSync configuration is missing or unavailable."""
