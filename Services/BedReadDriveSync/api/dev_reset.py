"""Development-only cleanup for DriveSync-owned runtime data."""

from __future__ import annotations

from typing import Callable

from sqlalchemy import delete

from api.db import SessionLocal
from api.models.db_models import (
    AppSetting,
    BannerUpdateHistoryRecord,
    CoverUpdateHistoryRecord,
    DriveSyncHistoryRecord,
    DriveSyncJobRecord,
    DriveSyncStatusRecord,
    ExternalCredential,
    IntroUpdateHistoryRecord,
)


OWNED_RUNTIME_MODELS = (
    DriveSyncJobRecord,
    DriveSyncHistoryRecord,
    CoverUpdateHistoryRecord,
    BannerUpdateHistoryRecord,
    IntroUpdateHistoryRecord,
    DriveSyncStatusRecord,
    AppSetting,
    ExternalCredential,
)


def clear_owned_runtime_data(session_factory: Callable = SessionLocal) -> dict[str, list[str]]:
    """Clear the queue, histories, status, config/cache settings, and credential."""
    cleared_tables: list[str] = []
    with session_factory() as db:
        for model in OWNED_RUNTIME_MODELS:
            db.execute(delete(model))
            cleared_tables.append(model.__tablename__)
        db.commit()
    return {"cleared_tables": cleared_tables, "deleted_paths": []}
