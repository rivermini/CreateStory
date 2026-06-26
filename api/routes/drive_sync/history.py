"""History endpoints for drive sync — proxy to BedReadDriveSync."""

from __future__ import annotations

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from api.routes.drive_sync.proxy import drive_delete, drive_get, drive_patch, drive_post

router = APIRouter(tags=["Drive Sync"])


async def _proxy_get(path: str, params: dict | None = None) -> JSONResponse:
    return await drive_get(path, params=params, timeout=60.0)


async def _proxy_post(path: str, json_body: dict | None = None) -> JSONResponse:
    return await drive_post(path, json_body=json_body, timeout=60.0)


async def _proxy_patch(path: str, json_body: dict | None = None) -> JSONResponse:
    return await drive_patch(path, json_body=json_body, timeout=60.0)


async def _proxy_delete(path: str) -> JSONResponse:
    return await drive_delete(path, timeout=60.0)


@router.get("/history")
async def get_history(limit: int = Query(200), offset: int = Query(0)) -> JSONResponse:
    return await _proxy_get("/api/drive-sync/history", params={"limit": limit, "offset": offset})


@router.post("/history")
async def add_history(body: dict) -> JSONResponse:
    return await _proxy_post("/api/drive-sync/history", json_body=body)


@router.patch("/history/{entry_id}")
async def update_history(entry_id: str, body: dict) -> JSONResponse:
    return await _proxy_patch(f"/api/drive-sync/history/{entry_id}", json_body=body)


@router.post("/history/clear")
async def delete_history(body: dict) -> JSONResponse:
    return await _proxy_post("/api/drive-sync/history/clear", json_body=body)
