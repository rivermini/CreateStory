"""DB-backed shared settings, credentials, and JSON document storage."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from api.models.db_models import AppSetting, ExternalCredential, MigrationAudit, SharedJsonDocument

SETTINGS_KEY = "user_settings"
DRIVE_SYNC_CONFIG_KEY = "drive_sync_config"
DRIVE_CREDENTIAL_NAME = "google_service_account"
DRIVE_CREDENTIAL_FILENAME = "google-service-account.json"


class SharedStateRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get_setting(self, key: str) -> dict[str, Any] | None:
        row = self.db.get(AppSetting, key)
        return dict(row.value) if row is not None else None

    def upsert_setting(self, key: str, value: dict[str, Any]) -> dict[str, Any]:
        row = self.db.get(AppSetting, key)
        if row is None:
            row = AppSetting(key=key, value=value)
            self.db.add(row)
        else:
            row.value = value
        self.db.commit()
        return value

    def get_drive_config(self) -> dict[str, Any] | None:
        return self.get_setting(DRIVE_SYNC_CONFIG_KEY)

    def upsert_drive_config(self, value: dict[str, Any]) -> dict[str, Any]:
        return self.upsert_setting(DRIVE_SYNC_CONFIG_KEY, value)

    def upsert_credential(self, name: str, filename: str, content: bytes, content_type: str | None = None) -> ExternalCredential:
        row = self.db.scalar(select(ExternalCredential).where(ExternalCredential.name == name))
        if row is None:
            row = ExternalCredential(name=name, filename=filename, content=content, content_type=content_type)
            self.db.add(row)
        else:
            row.filename = filename
            row.content = content
            row.content_type = content_type
        self.db.commit()
        self.db.refresh(row)
        return row

    def get_credential(self, name: str) -> ExternalCredential | None:
        return self.db.scalar(select(ExternalCredential).where(ExternalCredential.name == name))

    def upsert_json_document(self, namespace: str, key: str, data: dict | list, source_path: Path | None = None) -> SharedJsonDocument:
        row = self.db.scalar(
            select(SharedJsonDocument)
            .where(SharedJsonDocument.namespace == namespace)
            .where(SharedJsonDocument.key == key)
        )
        if row is None:
            row = SharedJsonDocument(namespace=namespace, key=key, data=data, source_path=str(source_path) if source_path else None)
            self.db.add(row)
        else:
            row.data = data
            row.source_path = str(source_path) if source_path else row.source_path
        self.db.commit()
        self.db.refresh(row)
        return row

    def record_audit(self, source_path: Path, target_table: str, row_count: int, notes: str | None = None) -> None:
        self.db.add(MigrationAudit(source_path=str(source_path), target_table=target_table, row_count=row_count, notes=notes))
        self.db.commit()


def drive_config_path() -> Path:
    from api.app_config import DATA_DIR

    return DATA_DIR / "drive_sync_config.json"


def settings_path() -> Path:
    from api.app_config import DATA_DIR

    return DATA_DIR / "user_settings.json"


def drive_credentials_path() -> Path:
    from api.app_config import DATA_DIR

    return DATA_DIR / "credentials" / DRIVE_CREDENTIAL_FILENAME


def read_json_file(path: Path) -> dict[str, Any] | list[Any] | None:
    if not path.exists():
        return None
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)

