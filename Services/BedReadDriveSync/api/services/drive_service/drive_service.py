"""
Google Drive folder sync service.

Scans a shared Drive folder for story folders (DONE_ / EXTENDED_ prefix),
downloads chapter files, and syncs them to the main BE via POST /api/v1/story/
and POST /api/v1/story/{id}/chapter.

This module is the composition layer — the actual implementation lives in
the mix-in modules in this package.  Each mix-in adds a focused slice of
behaviour while preserving the original method surface.
"""

from __future__ import annotations

import logging
import re
import ssl
import sys
import random
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Any, Callable, Optional

try:
    import fcntl  # Unix/Linux/macOS
except ImportError:
    fcntl = None

try:
    import msvcrt  # Windows
except ImportError:
    msvcrt = None

import httpx
import httplib2
from googleapiclient.errors import HttpError

if TYPE_CHECKING:
    from api.models.drive_sync import (
        DriveSyncConfig,
        DriveSyncLogEntry,
        DriveSyncStatus,
        HistoryEntry,
        HistoryItem,
        JobKind,
        JobLogEntry,
        JobStatus,
        SyncJob,
    )

from api.models.drive_sync import (
    DriveSyncConfig,
    DriveSyncLogEntry,
    DriveSyncStatus,
    HistoryEntry,
    HistoryItem,
    JobKind,
    JobLogEntry,
    JobStatus,
    SyncJob,
)
from api.db import init_db
from api.repositories.drive_sync_repository import DriveSyncRepository

logger = logging.getLogger(__name__)

from api.services.drive_service._paths import (
    _MAX_HISTORY_ENTRIES,
    _MAX_JOBS_ENTRIES,
    _RANDOM_AUTHOR_IDS,
    _RE_STATUS_PREFIX,
    _RE_SOURCE_SUFFIX,
    _PLATFORM_TO_ENUM,
    _CATEGORY_MAP,
    _DRIVE_CALL_RETRIES,
    _DRIVE_CALL_BACKOFF_BASE,
    _DRIVE_CALL_SEMAPHORE,
    _ACTION_KINDS,
    _ACTION_STATUSES,
    _SYSTEM_FOLDERS,
    _natural_sort_key,
)

_JOB_STATUS_VALID = {JobStatus.QUEUED, JobStatus.RUNNING, JobStatus.SUCCESS, JobStatus.ERROR, JobStatus.CANCELLED}
_JOB_KINDS_VALID = {
    JobKind.UPLOAD_SINGLE, JobKind.UPDATE_SINGLE, JobKind.CHAPTER_CONTENT_UPDATE,
    JobKind.METADATA_UPDATE, JobKind.COVER_UPDATE, JobKind.BANNER_UPDATE,
    JobKind.INTRO_UPDATE, JobKind.TITLE_UPDATE,
}


# -------------------------------------------------------------------------
# Import mix-ins (local to this package)
# -------------------------------------------------------------------------

from api.services.drive_service._config_store import ConfigStoreMixin
from api.services.drive_service._drive_api import DriveAPIMixin
from api.services.drive_service._parsers import ParsersMixin
from api.services.drive_service._main_be_client import MainBEClientMixin
from api.services.drive_service._history_jobs import HistoryJobsMixin
from api.services.drive_service._cover_update import CoverUpdateMixin
from api.services.drive_service._banner_update import BannerUpdateMixin
from api.services.drive_service._intro_update import IntroUpdateMixin
from api.services.drive_service._metadata_update import MetadataUpdateMixin
from api.services.drive_service._title_update import TitleUpdateMixin


class DriveSyncService(
    ConfigStoreMixin,
    DriveAPIMixin,
    ParsersMixin,
    MainBEClientMixin,
    HistoryJobsMixin,
    CoverUpdateMixin,
    BannerUpdateMixin,
    IntroUpdateMixin,
    MetadataUpdateMixin,
    TitleUpdateMixin,
):
    """Unified Drive sync service — all mix-ins composed into one class."""
    pass


# -------------------------------------------------------------------------
# Module-level singleton + config init helpers
# -------------------------------------------------------------------------

_service_instance: Optional[DriveSyncService] = None


def get_drive_sync_service() -> DriveSyncService:
    global _service_instance
    if _service_instance is None:
        init_db()
        _service_instance = DriveSyncService()
    return _service_instance


def init_drive_sync_config(
    folder_id: str,
    service_account_json_path: str,
    main_be_api_base_url: str,
    main_be_user_id: Optional[str] = None,
    main_category_id: str = "154971fe-7da7-41c4-91ee-b2a9613d6fa0",
    main_be_bearer_token: Optional[str] = None,
) -> DriveSyncConfig:
    """Initialize (or update) the drive sync config in PostgreSQL.

    If ``main_be_bearer_token`` is not supplied, the existing token (in-memory
    or persisted) is preserved rather than overwritten with ``None``.
    """
    global _service_instance
    existing_token: Optional[str] = None
    if _service_instance is not None and getattr(_service_instance, "_config", None) is not None:
        existing_token = _service_instance._config.main_be_bearer_token
    elif _service_instance is not None:
        try:
            raw = _service_instance._repo.load_drive_config()
            if isinstance(raw, dict):
                existing_token = raw.get("main_be_bearer_token")
        except Exception:
            existing_token = None

    resolved_token = main_be_bearer_token if main_be_bearer_token else existing_token

    config = DriveSyncConfig(
        folder_id=folder_id,
        service_account_json_path=service_account_json_path,
        enabled=True,
        main_be_api_base_url=main_be_api_base_url,
        main_be_user_id=main_be_user_id,
        main_category_id=main_category_id,
        main_be_bearer_token=resolved_token,
    )
    DriveSyncRepository().save_drive_config(config.model_dump(mode="json"))
    if _service_instance is not None:
        _service_instance._config = config
    logger.info("Drive sync config initialised (folder=%s).", folder_id)
    return config


_download_file_content = DriveSyncService._get_file_content
