"""Shared config helpers used across gateway routes."""

from __future__ import annotations

from sqlalchemy.orm import Session

from api.db import SessionLocal
from api.repositories.shared_state import SharedStateRepository


class DriveSyncConfigError(Exception):
    """Raised when required drive-sync configuration is missing or invalid."""


def _load_drive_sync_config(db: Session | None = None) -> dict:
    if db is not None:
        return SharedStateRepository(db).get_drive_config() or {}

    with SessionLocal() as session:
        return SharedStateRepository(session).get_drive_config() or {}


def load_external_api_config(db: Session | None = None) -> dict:
    """
    Load the external API config from PostgreSQL app_settings.

    Returns a dict with:
      - main_be_api_base_url: str
      - main_be_user_id: str
      - main_be_bearer_token: str (may be empty)

    Raises DriveSyncConfigError if required fields are absent.
    """
    config = _load_drive_sync_config(db)
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
