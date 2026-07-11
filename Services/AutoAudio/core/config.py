"""Configuration helpers for the AutoAudio service."""

from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path

import httpx

from api.service_auth import internal_service_headers

logger = logging.getLogger(__name__)

_OUTPUT_BASE_NAME = "output"
_AUTO_AUDIO_LOGS_DIR_NAME = "auto_audio_logs"

_settings_cache: dict | None = None
_settings_cache_time: float = 0
_SETTINGS_CACHE_TTL = 5.0
_AUTO_AUDIO_SETTINGS_KEY = "auto_audio_settings"
_AUTO_AUDIO_SETTINGS_DEFAULTS = {
    "auto_audio_rest_seconds": 0,
    "auto_audio_upload_workers": 3,
    "auto_audio_batch_window": 2,
    "auto_audio_external_api_base": "",
    "auto_audio_test_story_ids": [
        "ce6176c4-aeb5-4ee1-847f-ee56df64a386",
        "07d59e98-d693-429b-a9d1-53ce2fd89e55",
    ],
}

_external_config_cache: dict | None = None
_external_config_cache_time: float = 0
_EXTERNAL_CONFIG_CACHE_TTL = 30.0
_EXTERNAL_CONFIG_STALE_TTL = 300.0


def _get_service_urls() -> dict:
    raw = os.environ.get("SERVICE_URLS", "{}")
    try:
        return json.loads(raw)
    except Exception:
        return {}


def _get_service_url(key: str, fallback: str) -> str:
    urls = _get_service_urls()
    return urls.get(key, fallback).rstrip("/")


def _get_app_setting(key: str) -> dict:
    try:
        from core.db import SessionLocal, init_db
        from core.db_models import AppSetting

        init_db()
        with SessionLocal() as db:
            row = db.get(AppSetting, key)
            return dict(row.value) if row is not None else {}
    except Exception as exc:
        logger.warning("Failed to load %s from PostgreSQL: %s", key, exc)
        return {}


def _save_app_setting(key: str, value: dict) -> dict:
    from core.db import SessionLocal, init_db
    from core.db_models import AppSetting

    init_db()
    with SessionLocal() as db:
        db.merge(AppSetting(key=key, value=value))
        db.commit()
    return value


def _get_settings() -> dict:
    global _settings_cache, _settings_cache_time
    now = time.time()
    if _settings_cache is not None and (now - _settings_cache_time) < _SETTINGS_CACHE_TTL:
        return _settings_cache
    _settings_cache = {
        **_AUTO_AUDIO_SETTINGS_DEFAULTS,
        **_get_app_setting(_AUTO_AUDIO_SETTINGS_KEY),
    }
    _settings_cache_time = now
    return _settings_cache


def get_owned_settings() -> dict:
    """Return AutoAudio-owned operational settings."""
    return dict(_get_settings())


def update_owned_settings(updates: dict) -> dict:
    """Persist a partial AutoAudio settings update in the AutoAudio database."""
    global _settings_cache, _settings_cache_time
    allowed = set(_AUTO_AUDIO_SETTINGS_DEFAULTS)
    current = _get_settings()
    current.update({key: value for key, value in updates.items() if key in allowed})
    _save_app_setting(_AUTO_AUDIO_SETTINGS_KEY, current)
    _settings_cache = dict(current)
    _settings_cache_time = time.time()
    return dict(current)


def reset_owned_settings_cache() -> None:
    """Discard local settings and DriveSync config caches after cleanup."""
    global _settings_cache, _settings_cache_time
    global _external_config_cache, _external_config_cache_time
    _settings_cache = None
    _settings_cache_time = 0
    _external_config_cache = None
    _external_config_cache_time = 0


def _get_bedreadvoices_url() -> str:
    return _get_service_url("BedReadVoices", "http://localhost:8001")


def _get_drivesync_url() -> str:
    return _get_service_url("BedReadDriveSync", "http://localhost:8003")


class AutoAudioConfigError(Exception):
    pass


def _get_external_api_config() -> tuple[str, dict]:
    """
    Load external API config from its owning DriveSync service.

    Returns (api_base_url, auth_headers).
    Raises AutoAudioConfigError if required fields are absent.
    """
    global _external_config_cache, _external_config_cache_time
    now = time.monotonic()
    config: dict = {}
    if _external_config_cache is not None and now - _external_config_cache_time < _EXTERNAL_CONFIG_CACHE_TTL:
        config = dict(_external_config_cache)
    else:
        url = f"{_get_drivesync_url()}/internal/v1/external-api-config"
        try:
            with httpx.Client(timeout=10.0, headers=internal_service_headers()) as client:
                response = client.get(url)
                response.raise_for_status()
                config = response.json()
            _external_config_cache = dict(config)
            _external_config_cache_time = now
        except (httpx.HTTPError, ValueError) as exc:
            if (
                _external_config_cache is not None
                and now - _external_config_cache_time <= _EXTERNAL_CONFIG_STALE_TTL
            ):
                logger.warning("DriveSync config unavailable; using last known config: %s", exc)
                config = dict(_external_config_cache)
            else:
                raise AutoAudioConfigError(
                    "Drive Sync configuration service is unavailable. Please try again shortly."
                ) from exc
    if not config:
        raise AutoAudioConfigError(
            "Drive sync config is not configured. "
            "Please configure your Drive Sync settings in Settings > Drive Sync Configuration."
        )

    api_url = config.get("external_api_base_url", "").strip()
    if not api_url:
        raise AutoAudioConfigError(
            "External API Base URL is not configured. "
            "Please set it in Settings > Drive Sync Configuration."
        )

    user_id = (config.get("external_api_user_id") or "").strip()
    if not user_id:
        raise AutoAudioConfigError(
            "User ID is not configured. "
            "Please set it in Settings > Drive Sync Configuration."
        )

    headers = {"x-user-id": user_id}
    if config.get("external_api_token"):
        headers["Authorization"] = f"Bearer {config['external_api_token']}"

    return api_url.rstrip("/"), headers
