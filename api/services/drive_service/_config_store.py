"""ConfigStoreMixin: PostgreSQL config/status persistence for DriveSyncService."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Optional, TYPE_CHECKING

from api.repositories.drive_sync_repository import DriveSyncRepository
from api.services.drive_service._paths import _STATUS_FILE

if TYPE_CHECKING:
    from api.models.drive_sync import DriveSyncConfig, DriveSyncLogEntry, DriveSyncStatus

logger = logging.getLogger(__name__)


class ConfigStoreMixin:
    """
    Mix-in providing config and status load/save/get/update.

    Drive sync config now lives in PostgreSQL via the shared app_settings table.
    """

    def __init__(self) -> None:
        super().__init__()
        self._config: Optional["DriveSyncConfig"] = None
        self._status: "DriveSyncStatus" = None  # type: ignore[assignment]
        self._current_sync_id: Optional[str] = None
        self._current_log: list["DriveSyncLogEntry"] = []
        self._repo = DriveSyncRepository()
        self._load_config()
        self._load_status()

    def _config_path(self) -> Path:
        return Path(self._config.service_account_json_path) if self._config else Path("db://app_settings/drive_sync_config")

    def _write_example_config(self) -> None:
        return None

    def _load_config(self) -> None:
        from api.models.drive_sync import DriveSyncConfig

        raw = self._repo.load_drive_config()
        if raw is None:
            return
        try:
            self._config = DriveSyncConfig(**raw)
            logger.info("Drive sync config loaded from PostgreSQL.")
        except Exception as exc:
            logger.warning("Failed to load drive sync config: %s", exc)

    def _save_config(self) -> None:
        if self._config is None:
            return
        self._repo.save_drive_config(self._config.model_dump())
        logger.info("Drive sync config saved to PostgreSQL.")

    def _load_status(self) -> None:
        from api.models.drive_sync import DriveSyncStatus

        raw = self._repo.load_status()
        if raw:
            self._status = DriveSyncStatus(**raw)
            return
        if not _STATUS_FILE.exists():
            self._status = DriveSyncStatus(enabled=self._config.enabled if self._config else True)
            self._save_status()
            return
        try:
            raw = json.loads(_STATUS_FILE.read_text(encoding="utf-8"))
            self._status = DriveSyncStatus(**raw)
        except Exception as exc:
            logger.warning("Failed to load drive sync status: %s", exc)
            self._status = DriveSyncStatus(enabled=self._config.enabled if self._config else True)
            self._save_status()

    def _save_status(self) -> None:
        self._repo.save_status(self._status)

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

    def reset_runtime_state(self) -> None:
        """Clear in-memory DriveSync state after the gateway development cleanup."""
        from api.models.drive_sync import DriveSyncStatus

        self._config = None
        self._status = DriveSyncStatus()
        self._current_sync_id = None
        self._current_log = []
        if hasattr(self, "_folder_cache"):
            self._folder_cache.clear()
        if hasattr(self, "_server_cache"):
            self._server_cache = None
        if hasattr(self, "_tls") and hasattr(self._tls, "drive_service"):
            delattr(self._tls, "drive_service")
