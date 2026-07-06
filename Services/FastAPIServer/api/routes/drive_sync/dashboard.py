"""Dashboard analytics endpoints for drive sync — proxy to BedReadDriveSync."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

from api.routes.drive_sync.proxy import drive_get

router = APIRouter(tags=["Drive Sync"])


async def _proxy_get(path: str, params: dict | None = None) -> JSONResponse:
    return await drive_get(path, params=params, timeout=60.0)


@router.get("/dashboard/stories-needing-update")
async def get_stories_needing_update(
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
) -> JSONResponse:
    params = {}
    if start_date:
        params["start_date"] = start_date
    if end_date:
        params["end_date"] = end_date
    return await _proxy_get("/api/drive-sync/dashboard/stories-needing-update", params=params)
