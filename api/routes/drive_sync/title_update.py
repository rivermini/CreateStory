"""Title update endpoints — proxy to BedReadDriveSync."""

from __future__ import annotations

from api.service_client import service_async_client

import os

from fastapi import APIRouter
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/title-update", tags=["Drive Sync"])


def _ds_url() -> str:
    """Return BedReadDriveSync base URL, checking env vars and SERVICE_URLS JSON."""
    # Per-service env var takes priority (e.g. SERVICE_URLS_BedReadDriveSync=http://localhost:8003)
    override = os.environ.get("SERVICE_URLS_BedReadDriveSync")
    if override:
        return override.rstrip("/")
    # Fall back to parsing the SERVICE_URLS JSON object
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


async def _proxy_post(path: str, json_body: dict | None = None) -> JSONResponse:
    import httpx
    url = f"{_ds_url()}{path}"
    try:
        async with service_async_client(timeout=300.0) as client:
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
    except Exception as exc:
        return JSONResponse(status_code=502, content={"detail": f"Upstream request failed: {exc}"})


@router.get("/check-all")
async def check_all() -> JSONResponse:
    return await _proxy_get("/api/drive-sync/title-update/check-all", timeout=300.0)


@router.get("/folder/{folder_id}/detail")
async def get_folder_detail(folder_id: str) -> JSONResponse:
    return await _proxy_get(
        f"/api/drive-sync/title-update/folder/{folder_id}/detail", timeout=120.0
    )


@router.post("/update-chapter/{story_id}/{folder_id}/{chapter_number}")
async def update_chapter_title(
    story_id: str, folder_id: str, chapter_number: int
) -> JSONResponse:
    return await _proxy_post(
        f"/api/drive-sync/title-update/update-chapter/{story_id}/{folder_id}/{chapter_number}"
    )


@router.post("/update-folder/{story_id}/{folder_id}")
async def update_folder_titles(story_id: str, folder_id: str) -> JSONResponse:
    return await _proxy_post(
        f"/api/drive-sync/title-update/update-folder/{story_id}/{folder_id}"
    )


@router.post("/batch-update")
async def batch_update(body: dict) -> JSONResponse:
    return await _proxy_post("/api/drive-sync/title-update/batch-update", json_body=body)
