"""Configuration helpers for the AutoAudio service."""

from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path

logger = logging.getLogger(__name__)

_OUTPUT_BASE_NAME = "output"
_AUTO_AUDIO_LOGS_DIR_NAME = "auto_audio_logs"

_settings_cache: dict | None = None
_settings_cache_time: float = 0
_SETTINGS_CACHE_TTL = 5.0


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


def _get_settings() -> dict:
    global _settings_cache, _settings_cache_time
    now = time.time()
    if _settings_cache is not None and (now - _settings_cache_time) < _SETTINGS_CACHE_TTL:
        return _settings_cache
    _settings_cache = _get_app_setting("user_settings")
    _settings_cache_time = now
    return _settings_cache


def _get_bedreadvoices_url() -> str:
    return _get_service_url("BedReadVoices", "http://localhost:8001")


def _get_drivesync_url() -> str:
    return _get_service_url("BedReadDriveSync", "http://localhost:8003")


class AutoAudioConfigError(Exception):
    pass


def _get_external_api_config() -> tuple[str, dict]:
    """
    Load external API config from PostgreSQL app_settings.

    Returns (api_base_url, auth_headers).
    Raises AutoAudioConfigError if required fields are absent.
    """
    config = _get_app_setting("drive_sync_config")
    if not config:
        raise AutoAudioConfigError(
            "Drive sync config is not configured. "
            "Please configure your Drive Sync settings in Settings > Drive Sync Configuration."
        )

    api_url = config.get("main_be_api_base_url", "").strip()
    if not api_url:
        raise AutoAudioConfigError(
            "External API Base URL is not configured. "
            "Please set it in Settings > Drive Sync Configuration."
        )

    user_id = config.get("main_be_user_id", "").strip()
    if not user_id:
        raise AutoAudioConfigError(
            "User ID is not configured. "
            "Please set it in Settings > Drive Sync Configuration."
        )

    headers = {"x-user-id": user_id}
    if config.get("main_be_bearer_token"):
        headers["Authorization"] = f"Bearer {config['main_be_bearer_token']}"

    return api_url.rstrip("/"), headers
