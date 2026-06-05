"""Shared config helpers used across BedReadVoices."""

from __future__ import annotations

from api.db import SessionLocal, init_db
from api.models.db_models import AppSetting


def load_external_api_config() -> dict:
    """
    Load external API config from PostgreSQL app_settings.

    Returns a dict with:
      - main_be_api_base_url: str
      - main_be_user_id: str
      - main_be_bearer_token: str (may be empty)

    Raises DriveSyncConfigError if required fields are absent.
    """
    init_db()
    with SessionLocal() as db:
        row = db.get(AppSetting, "drive_sync_config")
        config = dict(row.value) if row is not None else {}

    if not config:
        raise DriveSyncConfigError(
            "Drive sync config is not configured. "
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
