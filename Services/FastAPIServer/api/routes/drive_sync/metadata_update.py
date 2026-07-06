"""Metadata update endpoints — proxy to BedReadDriveSync."""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from api.routes.drive_sync.proxy import drive_get, drive_post

router = APIRouter(prefix="/metadata-update", tags=["Drive Sync"])


async def _proxy_get(path: str, params: dict | None = None) -> JSONResponse:
    return await drive_get(path, params=params, timeout=600.0)


async def _proxy_post(path: str, json_body: dict | None = None) -> JSONResponse:
    return await drive_post(path, json_body=json_body, timeout=600.0)


@router.get("/check-all")
async def check_all() -> JSONResponse:
    return await _proxy_get("/api/drive-sync/metadata-update/check-all")


@router.get("/check-updated")
async def check_updated() -> JSONResponse:
    return await _proxy_get("/api/drive-sync/metadata-update/check-updated")


@router.get("/difference/{folder_id}/{story_id}/{field}")
async def get_metadata_difference_detail(folder_id: str, story_id: str, field: str) -> JSONResponse:
    return await _proxy_get(f"/api/drive-sync/metadata-update/difference/{folder_id}/{story_id}/{field}")


@router.post("/update-metadata/{folder_id}/{story_id}")
async def update_metadata(folder_id: str, story_id: str, body: dict) -> JSONResponse:
    return await _proxy_post(f"/api/drive-sync/metadata-update/update-metadata/{folder_id}/{story_id}", json_body=body)
