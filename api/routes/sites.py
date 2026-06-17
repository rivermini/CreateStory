"""Sites routes — proxy to NovelCrawler."""

from __future__ import annotations

import httpx
import os
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse

from api.auth import require_active_user
from api.middleware import get_shared_http_client

router = APIRouter(prefix="/api/sites", tags=["Sites"], dependencies=[Depends(require_active_user)])


def _nc_url() -> str:
    return os.environ.get("SERVICE_URLS_NovelCrawler", "http://localhost:8002").rstrip("/")


@router.get("/detect")
async def detect_site(
    url: Annotated[str, Query()],
    client: Annotated["httpx.AsyncClient", Depends(get_shared_http_client)],
) -> JSONResponse:
    """Detect which site a URL belongs to."""
    target_url = f"{_nc_url()}/api/sites/detect"
    resp = await client.get(target_url, params={"url": url})
    resp.raise_for_status()
    return JSONResponse(content=resp.json())


@router.get("")
async def list_sites(
    client: Annotated["httpx.AsyncClient", Depends(get_shared_http_client)],
) -> JSONResponse:
    """Return info for all supported site configs."""
    target_url = f"{_nc_url()}/api/sites"
    resp = await client.get(target_url)
    resp.raise_for_status()
    return JSONResponse(content=resp.json())


@router.get("/chapters")
async def get_chapters(
    url: Annotated[str, Query()],
    client: Annotated["httpx.AsyncClient", Depends(get_shared_http_client)],
) -> JSONResponse:
    """Fetch the chapter list for a novel story URL."""
    target_url = f"{_nc_url()}/api/sites/chapters"
    resp = await client.get(target_url, params={"url": url})
    resp.raise_for_status()
    return JSONResponse(content=resp.json())
