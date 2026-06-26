"""BedRead routes — proxy to BedReadVoices."""

from __future__ import annotations

import os
from typing import Optional

from fastapi import APIRouter, Body, Depends, Header, Query, Response
from fastapi.responses import JSONResponse, StreamingResponse

from api.auth import require_active_user, require_job_creation_rate, require_operator
from api.proxy import json_proxy, streaming_proxy

router = APIRouter(prefix="/api/bedread", tags=["BedRead"])
_AUTH = [Depends(require_active_user)]


def _bv_url() -> str:
    return os.environ.get("SERVICE_URLS_BedReadVoices", "http://localhost:8001").rstrip("/")


async def _proxy_get(path: str, params: dict | None = None, headers: dict | None = None) -> JSONResponse:
    return await json_proxy("GET", f"{_bv_url()}{path}", params=params, headers=headers, timeout=60.0)


async def _proxy_post(path: str, json_body: dict | None = None, headers: dict | None = None) -> JSONResponse:
    return await json_proxy(
        "POST",
        f"{_bv_url()}{path}",
        json_body=json_body or {},
        headers=headers,
        timeout=300.0,
    )


async def _proxy_delete(path: str) -> JSONResponse:
    return await json_proxy("DELETE", f"{_bv_url()}{path}", timeout=30.0)


async def _proxy_stream(path: str, timeout: float = 300.0) -> StreamingResponse | JSONResponse:
    return await streaming_proxy("GET", f"{_bv_url()}{path}", timeout=timeout)


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


@router.post("/generate", dependencies=[*_AUTH, Depends(require_job_creation_rate)])
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


@router.delete("/jobs/{batch_id}", dependencies=[*_AUTH, Depends(require_operator)])
async def cancel_batch(batch_id: str) -> JSONResponse:
    return await _proxy_delete(f"/api/bedread/jobs/{batch_id}")


@router.post("/jobs/{batch_id}/remove", dependencies=[*_AUTH, Depends(require_operator)])
async def remove_batch(batch_id: str) -> JSONResponse:
    return await _proxy_post(f"/api/bedread/jobs/{batch_id}/remove")


@router.get("/jobs/{batch_id}/download", dependencies=_AUTH)
async def download_chapter(batch_id: str, chapter: int = Query(...)) -> StreamingResponse:
    return await _proxy_stream(f"/api/bedread/jobs/{batch_id}/download?chapter={chapter}")


@router.get("/jobs/{batch_id}/zip", dependencies=_AUTH)
async def download_batch_zip(batch_id: str) -> StreamingResponse:
    return await _proxy_stream(f"/api/bedread/jobs/{batch_id}/zip")
