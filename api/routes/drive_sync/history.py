"""History endpoints for drive sync — proxy to BedReadDriveSync."""

from __future__ import annotations

from api.service_client import service_async_client

import os

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel

router = APIRouter(tags=["Drive Sync"])


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
    async with service_async_client(timeout=60.0) as client:
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
    async with service_async_client(timeout=60.0) as client:
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


async def _proxy_patch(path: str, json_body: dict | None = None) -> JSONResponse:
    import httpx
    url = f"{_ds_url()}{path}"
    async with service_async_client(timeout=60.0) as client:
        resp = await client.patch(url, json=json_body or {})
        try:
            resp.raise_for_status()
        except httpx.HTTPStatusError:
            try:
                detail = resp.json()
            except Exception:
                detail = {"detail": resp.text or resp.reason_phrase}
            return JSONResponse(status_code=resp.status_code, content=detail)
        return JSONResponse(content=resp.json())


async def _proxy_delete(path: str) -> JSONResponse:
    import httpx
    url = f"{_ds_url()}{path}"
    async with service_async_client(timeout=60.0) as client:
        resp = await client.delete(url)
        try:
            resp.raise_for_status()
        except httpx.HTTPStatusError:
            try:
                detail = resp.json()
            except Exception:
                detail = {"detail": resp.text or resp.reason_phrase}
            return JSONResponse(status_code=resp.status_code, content=detail)
        return JSONResponse(content=resp.json())


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
