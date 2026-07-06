"""Folder listing and preview endpoints for drive sync — proxy to BedReadDriveSync."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

from api.routes.drive_sync.proxy import drive_get, drive_post

router = APIRouter(tags=["Drive Sync"])


async def _proxy_get(path: str, params: dict | None = None) -> JSONResponse:
    return await drive_get(path, params=params, timeout=120.0)


async def _proxy_post(path: str, json_body: dict | None = None) -> JSONResponse:
    return await drive_post(path, json_body=json_body, timeout=300.0)


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
