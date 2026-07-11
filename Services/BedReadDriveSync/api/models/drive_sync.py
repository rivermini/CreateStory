"""Pydantic models for the Drive Sync feature."""

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field


class DriveSyncConfig(BaseModel):
    """Full drive sync configuration — persisted to data/drive_sync_config.json."""

    folder_id: str
    service_account_json_path: str
    main_be_api_base_url: str
    main_be_user_id: Optional[str] = None
    enabled: bool = True
    main_category_id: str = "154971fe-7da7-41c4-91ee-b2a9613d6fa0"
    main_be_bearer_token: Optional[str] = None  # set only via X-Auth-Token header; never returned in responses


class DriveSyncLogEntry(BaseModel):
    """A single log entry from a sync run."""

    timestamp: str
    level: str
    message: str
    story_name: Optional[str] = None


class DriveSyncStatus(BaseModel):
    """In-memory sync status — tracks run results."""

    enabled: bool = True
    stories_found: int = 0
    chapters_added: int = 0
    stories_created: int = 0
    last_sync_at: Optional[datetime] = None
    errors: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Request / Response models exposed by the API
# ---------------------------------------------------------------------------

class DriveSyncConfigResponse(BaseModel):
    """API response for GET /api/drive-sync/config."""

    folder_id: str
    enabled: bool
    main_be_api_base_url: str
    main_category_id: str
    main_be_user_id: Optional[str] = None
    service_account_json_name: Optional[str] = None


class DriveSyncProgressResponse(BaseModel):
    """API response for GET /api/drive-sync/status."""

    status: DriveSyncStatus
    current_sync_id: Optional[str]
    log: list[DriveSyncLogEntry]


class DriveSyncTriggerResponse(BaseModel):
    """API response for POST /api/drive-sync/trigger."""

    message: str
    sync_id: str
    stories_found: int


class DriveSyncUpdateRequest(BaseModel):
    """Request body for PUT /api/drive-sync/config.

    Note: bearer tokens must be set via POST /config with the X-Auth-Token header,
    not in the request body. This model does not accept ``main_be_bearer_token``.
    """

    enabled: Optional[bool] = None
    main_category_id: Optional[str] = None
    main_be_user_id: Optional[str] = None
    main_be_api_base_url: Optional[str] = None


# ---------------------------------------------------------------------------
# Action History models
# ---------------------------------------------------------------------------

class ActionKind(str):
    """Allowed action kind values."""
    UPLOAD_SINGLE = "upload_single"
    UPLOAD_BATCH = "upload_batch"
    UPDATE_SINGLE = "update_single"
    UPDATE_BATCH = "update_batch"
    TEST_SYNC = "test_sync"
    CONFIG_SAVE = "config_save"


class ActionStatus(str):
    """Allowed action status values."""
    RUNNING = "running"
    SUCCESS = "success"
    ERROR = "error"
    CANCELLED = "cancelled"


class HistoryItem(BaseModel):
    """An individual item within a batch action entry."""
    id: str
    label: str
    status: str
    message: Optional[str] = None


class HistoryEntry(BaseModel):
    """A single action history entry."""
    id: str
    created_by_user_id: Optional[str] = None
    timestamp: str
    kind: str
    status: str
    title: str
    subtitle: str
    items: Optional[list[HistoryItem]] = None
    error: Optional[str] = None


class HistoryListResponse(BaseModel):
    """API response for GET /api/drive-sync/history."""
    entries: list[HistoryEntry]
    total: int
    limit: int
    offset: int


class HistoryAddResponse(BaseModel):
    """API response for POST /api/drive-sync/history."""
    id: str
    timestamp: str


class HistoryUpdateResponse(BaseModel):
    """API response for PATCH /api/drive-sync/history/{id}."""
    id: str
    success: bool


class HistoryDeleteResponse(BaseModel):
    """API response for DELETE /api/drive-sync/history."""
    deleted_count: int


# ---------------------------------------------------------------------------
# Sync Job models
# ---------------------------------------------------------------------------

class JobStatus(str):
    """Allowed sync job status values."""
    QUEUED = "queued"
    RUNNING = "running"
    SUCCESS = "success"
    ERROR = "error"
    CANCELLED = "cancelled"


class JobKind(str):
    """Allowed sync job kind values."""
    UPLOAD_SINGLE = "upload_single"
    UPDATE_SINGLE = "update_single"
    CHAPTER_CONTENT_UPDATE = "chapter_content_update"
    METADATA_UPDATE = "metadata_update"
    COVER_UPDATE = "cover_update"
    BANNER_UPDATE = "banner_update"
    INTRO_UPDATE = "intro_update"
    TITLE_UPDATE = "title_update"


class JobLogEntry(BaseModel):
    """A single log line within a sync job."""
    timestamp: str
    level: str
    message: str


class SyncJob(BaseModel):
    """A single sync job — tracks upload/update of a single story folder."""
    id: str
    created_by_user_id: Optional[str] = None
    kind: str
    status: str
    folder_id: str
    folder_name: str
    display_name: str
    created_at: str
    started_at: Optional[str] = None
    finished_at: Optional[str] = None
    result_message: Optional[str] = None
    chapters_added: int = 0
    chapters_skipped: int = 0
    error: Optional[str] = None
    logs: list[JobLogEntry] = Field(default_factory=list)
    main_be_api_base_url: Optional[str] = None
    chapters_count: Optional[int] = None
    payload: dict[str, Any] = Field(default_factory=dict)
    client_batch_id: Optional[str] = None
    batch_item_index: Optional[int] = None
    attempt_count: int = 0
    claimed_at: Optional[datetime] = None
    last_heartbeat_at: Optional[datetime] = None
    last_error: Optional[str] = None


class JobCreateRequest(BaseModel):
    """Request body for POST /api/drive-sync/jobs."""
    kind: str
    folder_id: str
    folder_name: str
    display_name: str
    main_be_api_base_url: Optional[str] = None
    chapters_count: Optional[int] = None


class JobCreateResponse(BaseModel):
    """API response for POST /api/drive-sync/jobs."""
    id: str
    status: str
    message: str


class JobResponse(BaseModel):
    """API response for GET /api/drive-sync/jobs/{id}."""
    job: SyncJob


class JobListResponse(BaseModel):
    """API response for GET /api/drive-sync/jobs."""
    jobs: list[SyncJob]
    total: int
    queued: int = 0
    running: int = 0
    completed: int = 0
    failed: int = 0


class JobBatchCreateRequest(BaseModel):
    client_batch_id: str
    jobs: list[JobCreateRequest]


class JobBatchCreateResponse(BaseModel):
    client_batch_id: str
    jobs: list[JobCreateResponse]


class JobQueryRequest(BaseModel):
    ids: list[str]


class JobQueryResponse(BaseModel):
    jobs: list[SyncJob]


class TokenValidationResponse(BaseModel):
    """API response for GET /api/drive-sync/config/validate-token."""
    valid: bool
    status_code: Optional[int] = None
    message: Optional[str] = None
