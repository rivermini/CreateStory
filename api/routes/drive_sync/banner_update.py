"""Banner update endpoints — proxy to BedReadDriveSync."""

from __future__ import annotations

from api.service_client import service_async_client

import os

from fastapi import APIRouter
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/banner-update", tags=["Drive Sync"])


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


async def _proxy_get(path: str, params: dict | None = None, timeout: float = 60.0) -> JSONResponse:
    import httpx
    url = f"{_ds_url()}{path}"
    try:
        async with service_async_client(timeout=timeout) as client:
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
    except Exception as exc:
        return JSONResponse(status_code=502, content={"detail": f"Upstream request failed: {exc}"})


async def _proxy_post(path: str, json_body: dict | None = None, params: dict | None = None) -> JSONResponse:
    import httpx
    url = f"{_ds_url()}{path}"
    try:
        async with service_async_client(timeout=120.0) as client:
            resp = await client.post(url, json=json_body or {}, params=params or {})
            try:
                resp.raise_for_status()
            except httpx.HTTPStatusError:
                try:
                    detail = resp.json()
                except Exception:
                    detail = {"detail": resp.text or resp.reason_phrase}
                return JSONResponse(status_code=resp.status_code, content=detail)
            return JSONResponse(content=resp.json())
    except Exception as exc:
        return JSONResponse(status_code=502, content={"detail": f"Upstream request failed: {exc}"})


@router.get("/check-all")
async def check_all(banner_filename: str = "banner1.jpg") -> JSONResponse:
    return await _proxy_get("/api/drive-sync/banner-update/check-all", params={"banner_filename": banner_filename}, timeout=120.0)


@router.get("/check-updated")
async def check_updated() -> JSONResponse:
    return await _proxy_get("/api/drive-sync/banner-update/check-updated")


@router.post("/upload/{folder_id}/{story_id}")
async def upload_banner(folder_id: str, story_id: str, banner_filename: str = "banner1.jpg") -> JSONResponse:
    return await _proxy_post(
        f"/api/drive-sync/banner-update/upload/{folder_id}/{story_id}",
        params={"banner_filename": banner_filename}
    )
