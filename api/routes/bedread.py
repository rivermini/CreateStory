"""BedRead routes — proxy to BedReadVoices."""

from __future__ import annotations

import os
from typing import Optional

from fastapi import APIRouter, Body, Depends, Header, Query, Response
from fastapi.responses import JSONResponse, StreamingResponse

from api.auth import require_active_user
from api.config import load_external_api_config
from api.db import get_db

router = APIRouter(prefix="/api/bedread", tags=["BedRead"])
_AUTH = [Depends(require_active_user)]


def _bv_url() -> str:
    return os.environ.get("SERVICE_URLS_BedReadVoices", "http://localhost:8001").rstrip("/")


async def _proxy_get(path: str, params: dict | None = None, headers: dict | None = None) -> JSONResponse:
    import httpx
    url = f"{_bv_url()}{path}"
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.get(url, params=params or {}, headers=headers or {})
        resp.raise_for_status()
        return JSONResponse(content=resp.json())


async def _proxy_post(path: str, json_body: dict | None = None, headers: dict | None = None) -> JSONResponse:
    import httpx
    url = f"{_bv_url()}{path}"
    async with httpx.AsyncClient(timeout=300.0) as client:
        resp = await client.post(url, json=json_body or {}, headers=headers or {})
        resp.raise_for_status()
        return JSONResponse(content=resp.json())


async def _proxy_delete(path: str) -> JSONResponse:
    import httpx
    url = f"{_bv_url()}{path}"
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.delete(url)
        resp.raise_for_status()
        return JSONResponse(content=resp.json())


async def _proxy_stream(path: str, timeout: float = 300.0) -> StreamingResponse:
    import httpx
    url = f"{_bv_url()}{path}"
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        content_type = resp.headers.get("content-type", "application/octet-stream")
        hdrs = {k: v for k, v in resp.headers.items() if k.lower() not in ("host", "connection")}
        return StreamingResponse(resp.aiter_bytes(), media_type=content_type, headers=hdrs)


@router.get("/stories", dependencies=_AUTH)
async def list_stories() -> JSONResponse:
    return await _proxy_get("/api/bedread/stories")


@router.get("/stories/search", dependencies=_AUTH)
async def search_stories(
    keyword: Optional[str] = Query(None),
    categories: Optional[str] = Query(None),
    status: Optional[str] = Query("all"),
    sort: Optional[str] = Query("release_date"),
    minchapters: Optional[int] = Query(None),
    publishedWithin: Optional[int] = Query(None),
    page: int = Query(1),
    limit: int = Query(20),
) -> JSONResponse:
    params = {
        "keyword": keyword,
        "categories": categories,
        "status": status,
        "sort": sort,
        "minchapters": minchapters,
        "publishedWithin": publishedWithin,
        "page": page,
        "limit": limit,
    }
    params = {k: v for k, v in params.items() if v is not None}
    return await _proxy_get("/api/bedread/stories/search", params=params)


@router.get("/stories/{story_id}/chapters", dependencies=_AUTH)
async def get_story_chapters(
    story_id: str,
    x_user_id: Optional[str] = Header(None, alias="x-user-id"),
) -> JSONResponse:
    headers = {}
    if x_user_id:
        headers["x-user-id"] = x_user_id
    return await _proxy_get(f"/api/bedread/stories/{story_id}/chapters", headers=headers)


@router.post("/generate", dependencies=_AUTH)
async def start_batch_generate(
    request: dict = Body(...),
    x_user_id: Optional[str] = Header(None, alias="x-user-id"),
) -> JSONResponse:
    headers = {}
    if x_user_id:
        headers["x-user-id"] = x_user_id
    return await _proxy_post("/api/bedread/generate", json_body=request, headers=headers)


@router.get("/jobs/{batch_id}", dependencies=_AUTH)
async def get_batch_status(batch_id: str) -> JSONResponse:
    return await _proxy_get(f"/api/bedread/jobs/{batch_id}")


@router.get("/jobs", dependencies=_AUTH)
async def list_all_batch_jobs() -> JSONResponse:
    return await _proxy_get("/api/bedread/jobs")


@router.delete("/jobs/{batch_id}", dependencies=_AUTH)
async def cancel_batch(batch_id: str) -> JSONResponse:
    return await _proxy_delete(f"/api/bedread/jobs/{batch_id}")


@router.post("/jobs/{batch_id}/remove", dependencies=_AUTH)
async def remove_batch(batch_id: str) -> JSONResponse:
    return await _proxy_post(f"/api/bedread/jobs/{batch_id}/remove")


@router.get("/jobs/{batch_id}/download", dependencies=_AUTH)
async def download_chapter(batch_id: str, chapter: int = Query(...)) -> StreamingResponse:
    return await _proxy_stream(f"/api/bedread/jobs/{batch_id}/download?chapter={chapter}")


@router.get("/jobs/{batch_id}/zip", dependencies=_AUTH)
async def download_batch_zip(batch_id: str) -> StreamingResponse:
    return await _proxy_stream(f"/api/bedread/jobs/{batch_id}/zip")


@router.get("/config/external-api")
async def get_external_api_config(db=Depends(get_db)) -> JSONResponse:
    """Serve external API config to downstream services (e.g. BedReadVoices).
    The config is sourced from PostgreSQL app_settings saved by the FE.
    """
    try:
        config = load_external_api_config(db)
        return JSONResponse(content={
            "external_api_base_url": config["main_be_api_base_url"],
            "external_api_token": config["main_be_bearer_token"],
        })
    except Exception as exc:
        return JSONResponse(status_code=503, content={"detail": str(exc)})
