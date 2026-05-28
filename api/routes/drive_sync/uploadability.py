"""Uploadability check and chapter update endpoints for drive sync — proxy to BedReadDriveSync."""

from __future__ import annotations

import os
from typing import Optional

from fastapi import APIRouter
from fastapi.responses import JSONResponse

router = APIRouter(tags=["Drive Sync"])


def _ds_url() -> str:
    return os.environ.get("SERVICE_URLS_BedReadDriveSync", "http://localhost:8003").rstrip("/")


async def _proxy_get(path: str, params: dict | None = None) -> JSONResponse:
    import httpx
    url = f"{_ds_url()}{path}"
    async with httpx.AsyncClient(timeout=180.0) as client:
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
async def update_chapter_count(body: dict) -> JSONResponse:
    return await _proxy_post("/api/drive-sync/update-chapter-count", json_body=body)


@router.post("/update-chapters/{folder_id}")
async def update_chapters(folder_id: str) -> JSONResponse:
    return await _proxy_post(f"/api/drive-sync/update-chapters/{folder_id}")
