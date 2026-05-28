"""Job management endpoints for drive sync — proxy to BedReadDriveSync."""

from __future__ import annotations

import os

from fastapi import APIRouter
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


async def _proxy_post(path: str, json_body: dict | None = None) -> JSONResponse:
    import httpx
    url = f"{_ds_url()}{path}"
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(url, json=json_body or {})
        resp.raise_for_status()
        return JSONResponse(content=resp.json())


async def _proxy_delete(path: str, json_body: dict | None = None) -> JSONResponse:
    import httpx
    url = f"{_ds_url()}{path}"
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.delete(url, json=json_body or {})
        resp.raise_for_status()
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
