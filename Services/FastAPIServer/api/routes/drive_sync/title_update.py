"""Title update endpoints — proxy to BedReadDriveSync."""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from api.routes.drive_sync.proxy import drive_get, drive_post

router = APIRouter(prefix="/title-update", tags=["Drive Sync"])


async def _proxy_get(path: str, params: dict | None = None, timeout: float = 60.0) -> JSONResponse:
    return await drive_get(path, params=params, timeout=timeout)


async def _proxy_post(path: str, json_body: dict | None = None) -> JSONResponse:
    return await drive_post(path, json_body=json_body, timeout=300.0)


@router.get("/check-all")
async def check_all() -> JSONResponse:
    return await _proxy_get("/api/drive-sync/title-update/check-all", timeout=300.0)


@router.get("/folder/{folder_id}/detail")
async def get_folder_detail(folder_id: str) -> JSONResponse:
    return await _proxy_get(
        f"/api/drive-sync/title-update/folder/{folder_id}/detail", timeout=120.0
    )


@router.post("/update-chapter/{story_id}/{folder_id}/{chapter_number}")
async def update_chapter_title(
    story_id: str, folder_id: str, chapter_number: int
) -> JSONResponse:
    return await _proxy_post(
        f"/api/drive-sync/title-update/update-chapter/{story_id}/{folder_id}/{chapter_number}"
    )


@router.post("/update-folder/{story_id}/{folder_id}")
async def update_folder_titles(story_id: str, folder_id: str) -> JSONResponse:
    return await _proxy_post(
        f"/api/drive-sync/title-update/update-folder/{story_id}/{folder_id}"
    )


@router.post("/batch-update")
async def batch_update(body: dict) -> JSONResponse:
    return await _proxy_post("/api/drive-sync/title-update/batch-update", json_body=body)
