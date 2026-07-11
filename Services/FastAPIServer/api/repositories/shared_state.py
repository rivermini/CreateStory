"""DB-backed Gateway settings and migration-archive storage."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from api.models.db_models import AppSetting, MigrationAudit, SharedJsonDocument

SETTINGS_KEY = "user_settings"


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


def settings_path() -> Path:
    from api.app_config import DATA_DIR

    return DATA_DIR / "user_settings.json"


def read_json_file(path: Path) -> dict[str, Any] | list[Any] | None:
    if not path.exists():
        return None
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)

