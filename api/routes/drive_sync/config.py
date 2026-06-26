"""Config and status endpoints for drive sync."""

from __future__ import annotations

from api.service_client import service_async_client

import os
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
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
}


_PLACEHOLDER_VALUES = {
    "REPLACE_WITH_YOUR_GOOGLE_DRIVE_FOLDER_ID",
    "REPLACE_WITH_YOUR_API_BASE_URL",
    "REPLACE_WITH_YOUR_USER_ID",
    "REPLACE_WITH_YOUR_BEARER_TOKEN",
}


def _is_placeholder(value: object | None) -> bool:
    return isinstance(value, str) and value in _PLACEHOLDER_VALUES


def _ds_url() -> str:
    """Return BedReadDriveSync base URL, checking env vars and SERVICE_URLS JSON."""
    override = os.environ.get("SERVICE_URLS_BedReadDriveSync")
    if override:
        return override.rstrip("/")
    urls_raw = os.environ.get("SERVICE_URLS", "{}")
    try:
        import json
        service_urls = json.loads(urls_raw)
        if isinstance(service_urls, dict):
            url = service_urls.get("BedReadDriveSync")
            if url:
                return str(url).rstrip("/")
    except Exception:
        pass
    return "http://localhost:8003"


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
    async with service_async_client(timeout=60.0) as client:
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


async def _proxy_post(path: str, json_body: dict | None = None, headers: dict | None = None) -> JSONResponse:
    import httpx

    url = f"{_ds_url()}{path}"
    async with service_async_client(timeout=120.0) as client:
        resp = await client.post(url, json=json_body or {}, headers=headers or {})
        try:
            resp.raise_for_status()
        except httpx.HTTPStatusError:
            try:
                detail = resp.json()
            except Exception:
                detail = {"detail": resp.text or resp.reason_phrase}
            return JSONResponse(status_code=resp.status_code, content=detail)
        return JSONResponse(content=resp.json())


async def _proxy_put(path: str, json_body: dict | None = None, headers: dict | None = None) -> JSONResponse:
    import httpx

    url = f"{_ds_url()}{path}"
    async with service_async_client(timeout=120.0) as client:
        resp = await client.put(url, json=json_body or {}, headers=headers or {})
        try:
            resp.raise_for_status()
        except httpx.HTTPStatusError:
            try:
                detail = resp.json()
            except Exception:
                detail = {"detail": resp.text or resp.reason_phrase}
            return JSONResponse(status_code=resp.status_code, content=detail)
        return JSONResponse(content=resp.json())


class DriveSyncUrlResponse(BaseModel):
    url: Optional[str]


class DriveSyncUpdateRequest(BaseModel):
    enabled: Optional[bool] = None
    main_category_id: Optional[str] = None
    main_be_user_id: Optional[str] = None
    main_be_api_base_url: Optional[str] = None


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
    x_auth_token: Annotated[Optional[str], Header(alias="X-Auth-Token")] = None,
) -> JSONResponse:
    repo = SharedStateRepository(db)
    existing = repo.get_drive_config() or {}
    incoming_token = body.get("main_be_bearer_token")
    if _is_placeholder(incoming_token):
        incoming_token = None

    if x_auth_token:
        resolved_token: Optional[str] = x_auth_token
    elif incoming_token:
        resolved_token = incoming_token
    else:
        resolved_token = existing.get("main_be_bearer_token")

    merged: dict = {**_DRIVE_SYNC_CONFIG_EXAMPLE, **body}
    if "main_be_bearer_token" not in body:
        merged.pop("main_be_bearer_token", None)
    if resolved_token is not None:
        merged["main_be_bearer_token"] = resolved_token

    saved = repo.upsert_drive_config(merged)

    worker_body = {k: v for k, v in saved.items() if k != "main_be_bearer_token"}
    worker_headers: dict[str, str] = {}
    if resolved_token:
        worker_headers["X-Auth-Token"] = resolved_token
    worker_resp = await _proxy_post("/api/drive-sync/config", json_body=worker_body, headers=worker_headers or None)
    if worker_resp.status_code >= 400:
        return worker_resp
    return JSONResponse(content=_config_response(saved))


@router.put("/config")
async def update_sync_config(
    body: DriveSyncUpdateRequest,
    db: Annotated[Session, Depends(get_db)],
    _admin=Depends(require_admin),
    x_auth_token: Annotated[Optional[str], Header(alias="X-Auth-Token")] = None,
) -> JSONResponse:
    repo = SharedStateRepository(db)
    current = repo.get_drive_config()
    if current is None:
        raise HTTPException(status_code=400, detail="Drive sync not configured. POST /api/drive-sync/config first.")
    updates = body.model_dump(exclude_none=True)
    merged = {**current, **updates}
    saved = repo.upsert_drive_config(merged)
    worker_body = updates
    worker_headers: dict[str, str] = {}
    if x_auth_token:
        worker_headers["X-Auth-Token"] = x_auth_token
    worker_resp = await _proxy_put("/api/drive-sync/config", json_body=worker_body, headers=worker_headers or None)
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
