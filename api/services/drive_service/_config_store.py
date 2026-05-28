"""ConfigStoreMixin — config/status persistence for DriveSyncService."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from api.models.drive_sync import DriveSyncConfig, DriveSyncStatus, DriveSyncLogEntry

from api.services.drive_service._paths import (
    _CONFIG_FILE,
    _DATA_DIR,
    _STATUS_FILE,
)


class ConfigStoreMixin:
    """
    Mix-in providing config and status load/save/get/update.

    Adds to DriveSyncService:
      - _load_config, _save_config, _config_path
      - _load_status, _save_status
      - get_config, update_config, get_status, get_current_log, get_current_sync_id
    """

    def __init__(self) -> None:
        super().__init__()
        self._config: Optional["DriveSyncConfig"] = None
        self._status: "DriveSyncStatus" = None  # type: ignore[assignment]
        self._current_sync_id: Optional[str] = None
        self._current_log: list["DriveSyncLogEntry"] = []
        self._load_config()
        self._load_status()

    def _config_path(self) -> Path:
        path = Path(self._config.service_account_json_path) if self._config else _CONFIG_FILE
        return path

    def _load_config(self) -> None:
        from api.models.drive_sync import DriveSyncConfig

        if not _CONFIG_FILE.exists():
            return
        try:
            raw = json.loads(_CONFIG_FILE.read_text(encoding="utf-8"))
            self._config = DriveSyncConfig(**raw)
            logger.info("Drive sync config loaded from %s", _CONFIG_FILE)
        except Exception as exc:
            logger.warning("Failed to load drive sync config: %s", exc)

    def _save_config(self) -> None:
        _DATA_DIR.mkdir(parents=True, exist_ok=True)
        _CONFIG_FILE.write_text(
            json.dumps(self._config.model_dump(), indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        logger.info("Drive sync config saved.")

    def _load_status(self) -> None:
        from api.models.drive_sync import DriveSyncStatus

        if not _STATUS_FILE.exists():
            return
        try:
            raw = json.loads(_STATUS_FILE.read_text(encoding="utf-8"))
            self._status = DriveSyncStatus(**raw)
        except Exception as exc:
            logger.warning("Failed to load drive sync status: %s", exc)

    def _save_status(self) -> None:
        _DATA_DIR.mkdir(parents=True, exist_ok=True)
        _STATUS_FILE.write_text(
            json.dumps(self._status.model_dump(mode="json"), indent=2, ensure_ascii=False),
            encoding="utf-8",
        )

    def get_config(self) -> Optional["DriveSyncConfig"]:
        return self._config

    def update_config(self, **kwargs) -> "DriveSyncConfig":
        if self._config is None:
            raise RuntimeError("Drive sync config not set. Set it via POST /api/drive-sync/config first.")
        for key, value in kwargs.items():
            if value is not None and hasattr(self._config, key):
                setattr(self._config, key, value)
        self._save_config()
        return self._config

    def get_status(self) -> "DriveSyncStatus":
        return self._status

    def get_current_log(self) -> list["DriveSyncLogEntry"]:
        return self._current_log

    def get_current_sync_id(self) -> Optional[str]:
        return self._current_sync_id


logger = logging.getLogger(__name__)
