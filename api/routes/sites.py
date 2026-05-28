"""Sites routes — proxy to NovelCrawler."""

from __future__ import annotations

import os
from typing import Optional

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/api/sites", tags=["Sites"])


def _nc_url() -> str:
    return os.environ.get("SERVICE_URLS_NovelCrawler", "http://localhost:8002").rstrip("/")


@router.get("/detect")
def detect_site(url: str = Query(...)) -> JSONResponse:
    """Detect which site a URL belongs to."""
    import httpx
    target_url = f"{_nc_url()}/api/sites/detect"
    with httpx.Client(timeout=30.0) as client:
        resp = client.get(target_url, params={"url": url})
        resp.raise_for_status()
        return JSONResponse(content=resp.json())


@router.get("")
def list_sites() -> JSONResponse:
    """Return info for all supported site configs."""
    import httpx
    target_url = f"{_nc_url()}/api/sites"
    with httpx.Client(timeout=30.0) as client:
        resp = client.get(target_url)
        resp.raise_for_status()
        return JSONResponse(content=resp.json())


@router.get("/chapters")
def get_chapters(url: str = Query(...)) -> JSONResponse:
    """Fetch the chapter list for a novel story URL."""
    import httpx
    target_url = f"{_nc_url()}/api/sites/chapters"
    with httpx.Client(timeout=60.0) as client:
        resp = client.get(target_url, params={"url": url})
        resp.raise_for_status()
        return JSONResponse(content=resp.json())
