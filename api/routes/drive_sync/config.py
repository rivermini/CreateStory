"""Config and status endpoints for drive sync — proxy to BedReadDriveSync."""

from __future__ import annotations

import os
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

router = APIRouter(tags=["Drive Sync"])


def _ds_url() -> str:
    return os.environ.get("SERVICE_URLS_BedReadDriveSync", "http://localhost:8003").rstrip("/")


async def _proxy_get(path: str, params: dict | None = None) -> JSONResponse:
    import httpx
    url = f"{_ds_url()}{path}"
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.get(url, params=params or {})
        resp.raise_for_status()
        return JSONResponse(content=resp.json())


async def _proxy_post(path: str, json_body: dict | None = None) -> JSONResponse:
    import httpx
    url = f"{_ds_url()}{path}"
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(url, json=json_body or {})
        resp.raise_for_status()
        return JSONResponse(content=resp.json())


async def _proxy_put(path: str, json_body: dict | None = None) -> JSONResponse:
    import httpx
    url = f"{_ds_url()}{path}"
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.put(url, json=json_body or {})
        resp.raise_for_status()
        return JSONResponse(content=resp.json())


class DriveSyncTokenResponse(BaseModel):
    token: Optional[str]


class DriveSyncUrlResponse(BaseModel):
    url: Optional[str]


@router.get("/config/token", response_model=DriveSyncTokenResponse)
async def get_main_be_token() -> JSONResponse:
    return await _proxy_get("/api/drive-sync/config/token")


@router.get("/status")
async def get_sync_status() -> JSONResponse:
    return await _proxy_get("/api/drive-sync/status")


@router.get("/config")
async def get_sync_config() -> JSONResponse:
    return await _proxy_get("/api/drive-sync/config")


@router.post("/config")
async def create_or_update_sync_config(body: dict) -> JSONResponse:
    return await _proxy_post("/api/drive-sync/config", json_body=body)


@router.put("/config")
async def update_sync_config(body: dict) -> JSONResponse:
    return await _proxy_put("/api/drive-sync/config", json_body=body)


@router.get("/config/url", response_model=DriveSyncUrlResponse)
async def get_main_be_url() -> JSONResponse:
    return await _proxy_get("/api/drive-sync/config/url")
