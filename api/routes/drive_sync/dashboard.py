"""Dashboard analytics endpoints for drive sync — proxy to BedReadDriveSync."""

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
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.get(url, params=params or {})
        resp.raise_for_status()
        return JSONResponse(content=resp.json())


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
