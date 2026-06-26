"""Job management endpoints for drive sync — proxy to BedReadDriveSync."""

from __future__ import annotations

from api.service_client import service_async_client

import os

from fastapi import APIRouter
from fastapi.responses import JSONResponse

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
    async with service_async_client(timeout=120.0) as client:
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


@router.post("/jobs/delete")
async def delete_jobs_bulk(body: dict) -> JSONResponse:
    return await _proxy_post("/api/drive-sync/jobs/delete", json_body=body)


@router.post("/jobs")
async def create_job(body: dict) -> JSONResponse:
    return await _proxy_post("/api/drive-sync/jobs", json_body=body)


@router.get("/jobs")
async def list_jobs(limit: int = 100, offset: int = 0) -> JSONResponse:
    return await _proxy_get("/api/drive-sync/jobs", params={"limit": limit, "offset": offset})


@router.get("/jobs/{job_id}")
async def get_job(job_id: str) -> JSONResponse:
    return await _proxy_get(f"/api/drive-sync/jobs/{job_id}")


@router.delete("/jobs/{job_id}")
async def delete_job(job_id: str) -> JSONResponse:
    return await _proxy_delete(f"/api/drive-sync/jobs/{job_id}")
