"""Shared config helpers used across multiple services."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)


def get_drive_sync_config_path() -> Path:
    """Return the path to the drive_sync_config.json file.
    This file lives in FastAPIServer/api/data/ and is the single source of truth
    for external API credentials shared by all services.
    """
    return Path(__file__).parent.parent / "api" / "data" / "drive_sync_config.json"


def load_external_api_config() -> dict:
    """
    Load the external API config from drive_sync_config.json.

    Returns a dict with:
      - main_be_api_base_url: str
      - main_be_user_id: str
      - main_be_bearer_token: str (may be empty)

    Raises DriveSyncConfigError if the file is missing or required fields are absent.
    """
    config_path = get_drive_sync_config_path()

    if not config_path.exists():
        raise DriveSyncConfigError(
            f"Drive sync config not found at {config_path}. "
            "Please configure your settings in the Drive Sync Configuration modal."
        )

    try:
        with open(config_path, "r", encoding="utf-8") as f:
            config = json.load(f)
    except Exception as exc:
        raise DriveSyncConfigError(f"Failed to read drive sync config: {exc}") from exc

    if not config:
        raise DriveSyncConfigError(
            "Drive sync config is empty. "
            "Please configure your settings in the Drive Sync Configuration modal."
        )

    api_url = config.get("main_be_api_base_url", "").strip()
    if not api_url:
        raise DriveSyncConfigError(
            "External API Base URL is not configured. "
            "Please set it in Settings > Drive Sync Configuration."
        )

    user_id = config.get("main_be_user_id", "").strip()
    if not user_id:
        raise DriveSyncConfigError(
            "User ID is not configured. "
            "Please set it in Settings > Drive Sync Configuration."
        )

    return {
        "main_be_api_base_url": api_url.rstrip("/"),
        "main_be_user_id": user_id,
        "main_be_bearer_token": config.get("main_be_bearer_token", "").strip(),
    }


class DriveSyncConfigError(Exception):
    """Raised when required drive-sync configuration is missing or invalid."""
    pass
