"""Folder listing and preview endpoints for drive sync — proxy to BedReadDriveSync."""

from __future__ import annotations

from api.service_client import service_async_client

import os
from typing import Optional

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

router = APIRouter(tags=["Drive Sync"])


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


async def _proxy_get(path: str, params: dict | None = None) -> JSONResponse:
    import httpx
    url = f"{_ds_url()}{path}"
    async with service_async_client(timeout=120.0) as client:
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
    async with service_async_client(timeout=300.0) as client:
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


@router.get("/folders/all")
async def list_all_drive_items() -> JSONResponse:
    return await _proxy_get("/api/drive-sync/folders/all")


@router.get("/folders")
async def list_drive_folders(
    limit: int = Query(50),
    offset: int = Query(0),
    counts: bool = Query(False),
) -> JSONResponse:
    return await _proxy_get("/api/drive-sync/folders", params={"limit": limit, "offset": offset, "counts": counts})


@router.get("/folders/{folder_id}/preview")
async def preview_story_folder(folder_id: str) -> JSONResponse:
    return await _proxy_get(f"/api/drive-sync/folders/{folder_id}/preview")


@router.post("/folders/{folder_id}/sync")
async def sync_single_folder(folder_id: str) -> JSONResponse:
    return await _proxy_post(f"/api/drive-sync/folders/{folder_id}/sync")


@router.get("/folders/{folder_id}/file/{filename}")
async def get_folder_file_content(folder_id: str, filename: str) -> JSONResponse:
    return await _proxy_get(f"/api/drive-sync/folders/{folder_id}/file/{filename}")


@router.get("/folders/{folder_id}/chapter-breakdown")
async def get_folder_chapter_breakdown(folder_id: str) -> JSONResponse:
    return await _proxy_get(f"/api/drive-sync/folders/{folder_id}/chapter-breakdown")


@router.post("/trigger")
async def trigger_sync() -> JSONResponse:
    return await _proxy_post("/api/drive-sync/trigger")
