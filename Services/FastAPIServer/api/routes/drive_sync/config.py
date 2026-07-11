"""DriveSync configuration proxy; DriveSync is the sole data owner."""

from __future__ import annotations

from typing import Annotated, Optional

from fastapi import APIRouter, Depends, Header
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from api.auth import require_active_user, require_operator
from api.routes.drive_sync.proxy import drive_get, drive_post, drive_put

router = APIRouter(tags=["Drive Sync"])


class DriveSyncUrlResponse(BaseModel):
    url: Optional[str]


class DriveSyncUpdateRequest(BaseModel):
    enabled: Optional[bool] = None
    main_category_id: Optional[str] = None
    main_be_user_id: Optional[str] = None
    main_be_api_base_url: Optional[str] = None


def _token_headers(token: str | None) -> dict[str, str] | None:
    if not token or token == "REPLACE_WITH_YOUR_BEARER_TOKEN":
        return None
    return {"X-Auth-Token": token}


@router.get("/status")
async def get_sync_status(_user=Depends(require_active_user)) -> JSONResponse:
    return await drive_get("/api/drive-sync/status", timeout=60.0)


@router.get("/config")
async def get_sync_config(_user=Depends(require_active_user)) -> JSONResponse:
    return await drive_get("/api/drive-sync/config", timeout=60.0)


@router.post("/config")
async def create_or_update_sync_config(
    body: dict,
    _operator=Depends(require_operator),
    x_auth_token: Annotated[Optional[str], Header(alias="X-Auth-Token")] = None,
) -> JSONResponse:
    incoming_token = body.pop("main_be_bearer_token", None)
    return await drive_post(
        "/api/drive-sync/config",
        json_body=body,
        headers=_token_headers(x_auth_token or incoming_token),
        timeout=120.0,
    )


@router.put("/config")
async def update_sync_config(
    body: DriveSyncUpdateRequest,
    _operator=Depends(require_operator),
    x_auth_token: Annotated[Optional[str], Header(alias="X-Auth-Token")] = None,
) -> JSONResponse:
    return await drive_put(
        "/api/drive-sync/config",
        json_body=body.model_dump(exclude_none=True),
        headers=_token_headers(x_auth_token),
        timeout=120.0,
    )


@router.get("/config/url", response_model=DriveSyncUrlResponse)
async def get_main_be_url(_user=Depends(require_active_user)) -> JSONResponse:
    return await drive_get("/api/drive-sync/config/url", timeout=60.0)


@router.get("/config/validate-token")
async def validate_bearer_token(_operator=Depends(require_operator)) -> JSONResponse:
    return await drive_get("/api/drive-sync/config/validate-token", timeout=60.0)
