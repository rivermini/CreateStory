"""Configuration helpers for the AutoAudio service."""

from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path
from typing import Optional

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


def _get_settings_file() -> Path:
    """Path to the user settings file. Falls back to FastAPIServer/data/user_settings.json."""
    env_path = os.environ.get("USER_SETTINGS_PATH", "").strip()
    if env_path:
        p = Path(env_path)
        return p if p.is_absolute() else (Path(__file__).parent.parent.parent / p).resolve()
    return Path(__file__).parent.parent.parent / "FastAPIServer" / "data" / "user_settings.json"


def _get_drive_sync_config_path() -> Path:
    """Path to the drive sync config. Falls back to FastAPIServer/data/drive_sync_config.json."""
    env_path = os.environ.get("DRIVE_SYNC_CONFIG_PATH", "").strip()
    if env_path:
        p = Path(env_path)
        return p if p.is_absolute() else (Path(__file__).parent.parent.parent / p).resolve()
    return Path(__file__).parent.parent.parent / "FastAPIServer" / "data" / "drive_sync_config.json"


def _get_settings() -> dict:
    global _settings_cache, _settings_cache_time
    now = time.time()
    if _settings_cache is not None and (now - _settings_cache_time) < _SETTINGS_CACHE_TTL:
        return _settings_cache
    settings_file = _get_settings_file()
    try:
        if settings_file.exists():
            with open(settings_file, "r", encoding="utf-8") as f:
                _settings_cache = json.load(f)
                _settings_cache_time = now
                return _settings_cache
    except Exception:
        pass
    _settings_cache = {}
    return _settings_cache


def _get_bedreadvoices_url() -> str:
    return _get_service_url("BedReadVoices", "http://localhost:8001")


def _get_drivesync_url() -> str:
    return _get_service_url("BedReadDriveSync", "http://localhost:8003")


class AutoAudioConfigError(Exception):
    pass


def _get_external_api_config() -> tuple[str, dict]:
    """
    Load external API config from drive_sync_config.json.

    Returns (api_base_url, auth_headers).
    Raises AutoAudioConfigError if the file is missing or required fields are absent.
    """
    config_path = _get_drive_sync_config_path()

    if not config_path.exists():
        raise AutoAudioConfigError(
            f"Drive sync config not found at {config_path}. "
            "Please configure your Drive Sync settings in Settings > Drive Sync Configuration."
        )

    try:
        with open(config_path, "r", encoding="utf-8") as f:
            config = json.load(f)
    except Exception as exc:
        raise AutoAudioConfigError(f"Failed to read drive sync config: {exc}") from exc

    if not config:
        raise AutoAudioConfigError(
            "Drive sync config is empty. "
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
