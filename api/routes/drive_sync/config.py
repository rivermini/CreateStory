"""Config and status endpoints for drive sync."""

import asyncio
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from api.models.drive_sync import DriveSyncConfigResponse, DriveSyncProgressResponse, TokenValidationResponse
from api.services.drive_service import get_drive_sync_service, init_drive_sync_config


router = APIRouter(tags=["Drive Sync"])


def _extract_json_name(service_account_json_path: str) -> Optional[str]:
    """Extract just the filename from a full path like 'credentials/foo.json'."""
    if not service_account_json_path:
        return None
    return service_account_json_path.rsplit("/", 1)[-1]


class InitDriveSyncRequest(BaseModel):
    """Request body for POST /api/drive-sync/config."""
    folder_id: str
    service_account_json_path: str
    main_be_api_base_url: str
    main_be_user_id: Optional[str] = None
    main_category_id: str = "154971fe-7da7-41c4-91ee-b2a9613d6fa0"
    main_be_bearer_token: Optional[str] = None


class DriveSyncTokenResponse(BaseModel):
    """API response for GET /api/drive-sync/config/token."""
    token: Optional[str]


class DriveSyncUrlResponse(BaseModel):
    """API response for GET /api/drive-sync/config/url."""
    url: Optional[str]


# GET /api/drive-sync/config/token
@router.get("/config/token", response_model=DriveSyncTokenResponse, tags=["Drive Sync"])
async def get_main_be_token() -> DriveSyncTokenResponse:
    """Returns the stored Main BE bearer token, or null if not set."""
    service = get_drive_sync_service()
    cfg = service.get_config()
    if cfg is None:
        return DriveSyncTokenResponse(token=None)
    return DriveSyncTokenResponse(token=cfg.main_be_bearer_token)


# GET /api/drive-sync/status
@router.get("/status", response_model=DriveSyncProgressResponse, tags=["Drive Sync"])
async def get_sync_status() -> DriveSyncProgressResponse:
    """Returns the current sync status, last sync log, and whether a sync is running."""
    service = get_drive_sync_service()
    return DriveSyncProgressResponse(
        status=service.get_status(),
        current_sync_id=service.get_current_sync_id(),
        log=service.get_current_log(),
    )


# GET /api/drive-sync/config
@router.get("/config", response_model=Optional[DriveSyncConfigResponse], tags=["Drive Sync"])
async def get_sync_config() -> Optional[DriveSyncConfigResponse]:
    """Returns the current drive sync configuration (minus sensitive fields)."""
    service = get_drive_sync_service()
    cfg = service.get_config()
    if cfg is None:
        return None
    return DriveSyncConfigResponse(
        folder_id=cfg.folder_id,
        enabled=cfg.enabled,
        main_be_api_base_url=cfg.main_be_api_base_url,
        main_category_id=cfg.main_category_id,
        main_be_user_id=cfg.main_be_user_id,
        service_account_json_name=_extract_json_name(cfg.service_account_json_path),
    )


# POST /api/drive-sync/config
@router.post("/config", response_model=DriveSyncConfigResponse, tags=["Drive Sync"])
async def create_or_update_sync_config(body: InitDriveSyncRequest) -> DriveSyncConfigResponse:
    """Initialize or update the Google Drive sync configuration."""
    cfg = init_drive_sync_config(
        folder_id=body.folder_id,
        service_account_json_path=body.service_account_json_path,
        main_be_api_base_url=body.main_be_api_base_url,
        main_be_user_id=body.main_be_user_id,
        main_category_id=body.main_category_id,
        main_be_bearer_token=body.main_be_bearer_token,
    )
    import logging
    logger = logging.getLogger(__name__)
    logger.info("Drive sync config initialized: folder=%s", cfg.folder_id)
    return DriveSyncConfigResponse(
        folder_id=cfg.folder_id,
        enabled=cfg.enabled,
        main_be_api_base_url=cfg.main_be_api_base_url,
        main_category_id=cfg.main_category_id,
        main_be_user_id=cfg.main_be_user_id,
        service_account_json_name=_extract_json_name(cfg.service_account_json_path),
    )


# PUT /api/drive-sync/config
@router.put("/config", response_model=DriveSyncConfigResponse, tags=["Drive Sync"])
async def update_sync_config(body) -> DriveSyncConfigResponse:
    """Partially update the drive sync configuration."""
    from api.models.drive_sync import DriveSyncUpdateRequest
    service = get_drive_sync_service()
    if service.get_config() is None:
        raise HTTPException(
            status_code=400,
            detail="Drive sync not configured. POST /api/drive-sync/config first.",
        )
    kwargs = {k: v for k, v in body.model_dump().items() if v is not None}
    updated = service.update_config(**kwargs)
    return DriveSyncConfigResponse(
        folder_id=updated.folder_id,
        enabled=updated.enabled,
        main_be_api_base_url=updated.main_be_api_base_url,
        main_category_id=updated.main_category_id,
        main_be_user_id=updated.main_be_user_id,
        service_account_json_name=_extract_json_name(updated.service_account_json_path),
    )


# GET /api/drive-sync/config/url
@router.get("/config/url", response_model=DriveSyncUrlResponse, tags=["Drive Sync"])
async def get_main_be_url() -> DriveSyncUrlResponse:
    """Returns the stored Main BE API base URL, or null if not set."""
    service = get_drive_sync_service()
    cfg = service.get_config()
    if cfg is None:
        return DriveSyncUrlResponse(url=None)
    return DriveSyncUrlResponse(url=cfg.main_be_api_base_url)


# GET /api/drive-sync/config/validate-token
@router.get("/config/validate-token", response_model=TokenValidationResponse, tags=["Drive Sync"])
async def validate_bearer_token() -> TokenValidationResponse:
    """Validate the stored Main BE bearer token by calling GET /api/v1/story."""
    service = get_drive_sync_service()
    if service.get_config() is None:
        raise HTTPException(status_code=400, detail="Drive sync not configured.")
    valid, status_code, message = service.validate_token()
    return TokenValidationResponse(valid=valid, status_code=status_code, message=message)
