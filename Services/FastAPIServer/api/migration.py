"""One-time import helpers for existing shared JSON-backed state."""

from __future__ import annotations

import logging

from sqlalchemy.orm import Session

from api.repositories.shared_state import (
    DRIVE_CREDENTIAL_FILENAME,
    DRIVE_CREDENTIAL_NAME,
    SETTINGS_KEY,
    SharedStateRepository,
    drive_config_path,
    drive_credentials_path,
    read_json_file,
    settings_path,
)
from api.app_config import DATA_DIR

logger = logging.getLogger(__name__)


def import_existing_shared_state(db: Session, settings_defaults: dict, drive_defaults: dict) -> None:
    repo = SharedStateRepository(db)

    if repo.get_setting(SETTINGS_KEY) is None:
        imported = read_json_file(settings_path())
        if isinstance(imported, dict):
            repo.upsert_setting(SETTINGS_KEY, {**settings_defaults, **imported})
            repo.record_audit(settings_path(), "app_settings", 1, "Imported user settings")
        else:
            repo.upsert_setting(SETTINGS_KEY, settings_defaults)
        logger.info("Shared settings initialized in PostgreSQL.")

    if repo.get_drive_config() is None:
        imported = read_json_file(drive_config_path())
        if isinstance(imported, dict):
            repo.upsert_drive_config({**drive_defaults, **imported})
            repo.record_audit(drive_config_path(), "app_settings", 1, "Imported drive sync config")
            logger.info("Drive sync config imported into PostgreSQL.")

    if repo.get_credential(DRIVE_CREDENTIAL_NAME) is None:
        credential_path = drive_credentials_path()
        if credential_path.exists():
            repo.upsert_credential(
                DRIVE_CREDENTIAL_NAME,
                DRIVE_CREDENTIAL_FILENAME,
                credential_path.read_bytes(),
                "application/json",
            )
            repo.record_audit(credential_path, "external_credentials", 1, "Imported Google service account JSON")
            logger.info("Drive credential imported into PostgreSQL.")

    sync_jobs_path = DATA_DIR / "sync_jobs.json"
    imported_jobs = read_json_file(sync_jobs_path)
    if isinstance(imported_jobs, list):
        repo.upsert_json_document("drive_sync", "sync_jobs", imported_jobs, sync_jobs_path)
        repo.record_audit(sync_jobs_path, "shared_json_documents", len(imported_jobs), "Imported sync job queue snapshot")
