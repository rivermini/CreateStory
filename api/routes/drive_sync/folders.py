"""Folder listing and preview endpoints for drive sync — proxy to BedReadDriveSync."""

from __future__ import annotations

import os
from typing import Optional

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

router = APIRouter(tags=["Drive Sync"])


def _ds_url() -> str:
    return os.environ.get("SERVICE_URLS_BedReadDriveSync", "http://localhost:8003").rstrip("/")


async def _proxy_get(path: str, params: dict | None = None) -> JSONResponse:
    import httpx
    url = f"{_ds_url()}{path}"
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.get(url, params=params or {})
        resp.raise_for_status()
        return JSONResponse(content=resp.json())


async def _proxy_post(path: str, json_body: dict | None = None) -> JSONResponse:
    import httpx
    url = f"{_ds_url()}{path}"
    async with httpx.AsyncClient(timeout=300.0) as client:
        resp = await client.post(url, json=json_body or {})
        resp.raise_for_status()
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
