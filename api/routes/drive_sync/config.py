"""Config and status endpoints for drive sync."""

from __future__ import annotations

import os
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from api.auth import require_active_user, require_admin
from api.db import get_db
from api.repositories.shared_state import SharedStateRepository

router = APIRouter(tags=["Drive Sync"])


_DRIVE_SYNC_CONFIG_EXAMPLE = {
    "folder_id": "REPLACE_WITH_YOUR_GOOGLE_DRIVE_FOLDER_ID",
    "service_account_json_path": "db://external_credentials/google-service-account.json",
    "main_be_api_base_url": "REPLACE_WITH_YOUR_API_BASE_URL",
    "main_be_user_id": "REPLACE_WITH_YOUR_USER_ID",
    "enabled": True,
    "main_category_id": "154971fe-7da7-41c4-91ee-b2a9613d6fa0",
    "main_be_bearer_token": "REPLACE_WITH_YOUR_BEARER_TOKEN",
}


def _ds_url() -> str:
    return os.environ.get("SERVICE_URLS_BedReadDriveSync", "http://localhost:8003").rstrip("/")


def _extract_json_name(service_account_json_path: str | None) -> Optional[str]:
    if not service_account_json_path:
        return None
    return service_account_json_path.rsplit("/", 1)[-1]


def _config_response(config: dict) -> dict:
    return {
        "folder_id": config.get("folder_id", ""),
        "enabled": config.get("enabled", True),
        "main_be_api_base_url": config.get("main_be_api_base_url", ""),
        "main_category_id": config.get("main_category_id", "154971fe-7da7-41c4-91ee-b2a9613d6fa0"),
        "main_be_user_id": config.get("main_be_user_id"),
        "service_account_json_name": _extract_json_name(config.get("service_account_json_path")),
    }


async def _proxy_get(path: str, params: dict | None = None) -> JSONResponse:
    import httpx

    url = f"{_ds_url()}{path}"
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.get(url, params=params or {})
        try:
            resp.raise_for_status()
        except httpx.HTTPStatusError:
            try:
                detail = resp.json()
            except Exception:
                detail = {"detail": resp.text or resp.reason_phrase}
            return JSONResponse(status_code=resp.status_code, content=detail)
        return JSONResponse(content=resp.json())


async def _proxy_post(path: str, json_body: dict | None = None) -> JSONResponse:
    import httpx

    url = f"{_ds_url()}{path}"
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(url, json=json_body or {})
        try:
            resp.raise_for_status()
        except httpx.HTTPStatusError:
            try:
                detail = resp.json()
            except Exception:
                detail = {"detail": resp.text or resp.reason_phrase}
            return JSONResponse(status_code=resp.status_code, content=detail)
        return JSONResponse(content=resp.json())


async def _proxy_put(path: str, json_body: dict | None = None) -> JSONResponse:
    import httpx

    url = f"{_ds_url()}{path}"
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.put(url, json=json_body or {})
        try:
            resp.raise_for_status()
        except httpx.HTTPStatusError:
            try:
                detail = resp.json()
            except Exception:
                detail = {"detail": resp.text or resp.reason_phrase}
            return JSONResponse(status_code=resp.status_code, content=detail)
        return JSONResponse(content=resp.json())


class DriveSyncTokenResponse(BaseModel):
    token: Optional[str]


class DriveSyncUrlResponse(BaseModel):
    url: Optional[str]


@router.get("/config/token", response_model=DriveSyncTokenResponse)
async def get_main_be_token(
    db: Annotated[Session, Depends(get_db)],
    _admin=Depends(require_admin),
) -> JSONResponse:
    config = SharedStateRepository(db).get_drive_config() or {}
    return JSONResponse(content={"token": config.get("main_be_bearer_token")})


@router.get("/status")
async def get_sync_status(_user=Depends(require_active_user)) -> JSONResponse:
    return await _proxy_get("/api/drive-sync/status")


@router.get("/config")
async def get_sync_config(
    db: Annotated[Session, Depends(get_db)],
    _user=Depends(require_active_user),
) -> JSONResponse:
    config = SharedStateRepository(db).get_drive_config()
    if config is None:
        return JSONResponse(content=None)
    return JSONResponse(content=_config_response(config))


@router.post("/config")
async def create_or_update_sync_config(
    body: dict,
    db: Annotated[Session, Depends(get_db)],
    _admin=Depends(require_admin),
) -> JSONResponse:
    merged = {**_DRIVE_SYNC_CONFIG_EXAMPLE, **body}
    saved = SharedStateRepository(db).upsert_drive_config(merged)
    worker_resp = await _proxy_post("/api/drive-sync/config", json_body=saved)
    if worker_resp.status_code >= 400:
        return worker_resp
    return JSONResponse(content=_config_response(saved))


@router.put("/config")
async def update_sync_config(
    body: dict,
    db: Annotated[Session, Depends(get_db)],
    _admin=Depends(require_admin),
) -> JSONResponse:
    repo = SharedStateRepository(db)
    current = repo.get_drive_config()
    if current is None:
        raise HTTPException(status_code=400, detail="Drive sync not configured. POST /api/drive-sync/config first.")
    merged = {**current, **{k: v for k, v in body.items() if v is not None}}
    saved = repo.upsert_drive_config(merged)
    worker_resp = await _proxy_put("/api/drive-sync/config", json_body={k: v for k, v in body.items() if v is not None})
    if worker_resp.status_code >= 400:
        return worker_resp
    return JSONResponse(content=_config_response(saved))


@router.get("/config/url", response_model=DriveSyncUrlResponse)
async def get_main_be_url(
    db: Annotated[Session, Depends(get_db)],
    _user=Depends(require_active_user),
) -> JSONResponse:
    config = SharedStateRepository(db).get_drive_config() or {}
    return JSONResponse(content={"url": config.get("main_be_api_base_url")})


@router.get("/config/validate-token")
async def validate_bearer_token(_admin=Depends(require_admin)) -> JSONResponse:
    return await _proxy_get("/api/drive-sync/config/validate-token")
