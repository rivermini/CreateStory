"""Metadata update endpoints — proxy to BedReadDriveSync."""

from __future__ import annotations

from api.service_client import service_async_client

import os

from fastapi import APIRouter
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/metadata-update", tags=["Drive Sync"])


def _ds_url() -> str:
    """Return BedReadDriveSync base URL, checking env vars and SERVICE_URLS JSON."""
    override = os.environ.get("SERVICE_URLS_BedReadDriveSync")
    if override:
        return override.rstrip("/")
    urls_raw = os.environ.get("SERVICE_URLS", "{}")
    try:
        import json
        service_urls = json.loads(urls_raw)
        if isinstance(service_urls, dict):
            url = service_urls.get("BedReadDriveSync")
            if url:
                return str(url).rstrip("/")
    except Exception:
        pass
    return "http://localhost:8003"


async def _proxy_get(path: str, params: dict | None = None) -> JSONResponse:
    import httpx
    url = f"{_ds_url()}{path}"
    async with service_async_client(timeout=600.0) as client:
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
    async with service_async_client(timeout=600.0) as client:
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
