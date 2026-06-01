"""Configuration helpers for the auto-audio service."""

from __future__ import annotations

import json
import logging
import time
from pathlib import Path
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

_OUTPUT_BASE_NAME = "output"
_AUTO_AUDIO_LOGS_DIR_NAME = "auto_audio_logs"

_settings_cache: dict | None = None
_settings_cache_time: float = 0
_SETTINGS_CACHE_TTL = 5.0


def _get_settings() -> dict:
    global _settings_cache, _settings_cache_time
    now = time.time()
    if _settings_cache is not None and (now - _settings_cache_time) < _SETTINGS_CACHE_TTL:
        return _settings_cache
    try:
        settings_file = Path(__file__).parent.parent.parent / "api" / "data" / "user_settings.json"
        with open(settings_file, "r", encoding="utf-8") as f:
            _settings_cache = json.load(f)
            _settings_cache_time = now
    except Exception:
        _settings_cache = {}
    return _settings_cache if _settings_cache is not None else {}


def _get_bedreadvoices_url() -> str:
    import os
    return os.environ.get("SERVICE_URLS_BedReadVoices", "http://localhost:8001").rstrip("/")


def _get_bedreadvoices_output_base() -> Path:
    import os
    base = os.environ.get("BEDREADVOICES_ROOT", "D:\\Developer\\Nova\\CreateStoryMicroService\\BedReadVoices")
    return Path(base) / "output" / "bedread"


def _get_drivesync_url() -> str:
    import os
    return os.environ.get("SERVICE_URLS_BedReadDriveSync", "http://localhost:8003").rstrip("/")


class AutoAudioConfigError(Exception):
    pass


def _get_external_api_config() -> tuple[str, dict]:
    """Get external API base URL and auth headers from the shared drive_sync_config.json."""
    from api.config import load_external_api_config, DriveSyncConfigError

    try:
        config = load_external_api_config()
        headers = {"x-user-id": config["main_be_user_id"]}
        if config.get("main_be_bearer_token"):
            headers["Authorization"] = f"Bearer {config['main_be_bearer_token']}"
        return config["main_be_api_base_url"].rstrip("/"), headers
    except DriveSyncConfigError as exc:
        raise AutoAudioConfigError(str(exc)) from exc
    except Exception as exc:
        logger.warning("Failed to get drive sync config: %s", exc)
        raise AutoAudioConfigError(
            "No Drive Sync configuration found. "
            "Please configure your Drive Sync settings in Settings > Drive Sync Configuration."
        ) from exc
