"""Uploadability check and chapter update endpoints for drive sync — proxy to BedReadDriveSync."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .utils import _ds_url

router = APIRouter(tags=["Drive Sync"])


class UpdateChapterCountRequest(BaseModel):
    folder_id: str = Field(..., description="Drive folder ID")
    chapter_count: int = Field(..., ge=0, description="Current chapter count")


class BatchInspectRequest(BaseModel):
    folder_ids: list[str] = Field(
        default_factory=list,
        description="List of folder IDs to inspect.",
    )


class BatchUpdateRequest(BaseModel):
    folder_ids: list[str] = Field(
        default_factory=list,
        description="List of folder IDs to update.",
    )


async def _proxy_get(path: str, params: dict | None = None) -> JSONResponse:
    import httpx
    url = f"{_ds_url()}{path}"
    async with httpx.AsyncClient(timeout=600.0) as client:
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
    async with httpx.AsyncClient(timeout=600.0) as client:
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


@router.get("/check-uploadable")
async def check_uploadable() -> JSONResponse:
    return await _proxy_get("/api/drive-sync/check-uploadable")


@router.get("/check-updatable")
async def check_updatable() -> JSONResponse:
    return await _proxy_get("/api/drive-sync/check-updatable")


@router.get("/check-updatable/reader-finished")
async def check_updatable_reader_finished() -> JSONResponse:
    return await _proxy_get("/api/drive-sync/check-updatable/reader-finished")


@router.get("/check-updatable/reader-finished/debug")
async def check_updatable_reader_finished_debug() -> JSONResponse:
    return await _proxy_get("/api/drive-sync/check-updatable/reader-finished/debug")


@router.post("/update-chapter-count")
async def update_chapter_count(body: UpdateChapterCountRequest) -> JSONResponse:
    return await _proxy_post("/api/drive-sync/update-chapter-count", json_body=body.model_dump())


@router.post("/update-chapters/{folder_id}")
async def update_chapters(folder_id: str) -> JSONResponse:
    return await _proxy_post(f"/api/drive-sync/update-chapters/{folder_id}")


@router.get("/content-update/search")
async def search_content_update_story(keyword: str) -> JSONResponse:
    return await _proxy_get("/api/drive-sync/content-update/search", params={"keyword": keyword})


@router.get("/content-update/folder")
async def inspect_content_update_folder(folder_name: str) -> JSONResponse:
    return await _proxy_get("/api/drive-sync/content-update/folder", params={"folder_name": folder_name})


@router.get("/content-update/scan/{story_id}")
async def scan_content_update_story(story_id: str) -> JSONResponse:
    return await _proxy_get(f"/api/drive-sync/content-update/scan/{story_id}")


@router.post("/content-update/update-chapter")
async def update_content_chapter(body: dict) -> JSONResponse:
    return await _proxy_post("/api/drive-sync/content-update/update-chapter", json_body=body)


@router.post("/content-update/batch-inspect")
async def batch_inspect_content_folders(body: BatchInspectRequest) -> JSONResponse:
    return await _proxy_post("/api/drive-sync/content-update/batch-inspect", json_body=body.model_dump())


@router.post("/content-update/batch-update")
async def batch_update_content_folders(body: BatchUpdateRequest) -> JSONResponse:
    return await _proxy_post("/api/drive-sync/content-update/batch-update", json_body=body.model_dump())
