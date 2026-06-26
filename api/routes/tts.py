"""TTS routes — proxy to BedReadVoices."""

from __future__ import annotations

import os
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse, StreamingResponse

from api.auth import require_active_user, require_admin, require_job_creation_rate, require_operator
from api.middleware import get_shared_http_client
from api.proxy import json_proxy, streaming_proxy

router = APIRouter(prefix="/api/tts", tags=["TTS"], dependencies=[Depends(require_active_user)])


def _bv_url() -> str:
    return os.environ.get("SERVICE_URLS_BedReadVoices", "http://localhost:8001").rstrip("/")


async def _proxy_get(path: str, params: dict | None = None, timeout: float = 120.0) -> JSONResponse:
    return await json_proxy("GET", f"{_bv_url()}{path}", params=params, timeout=timeout)


async def _proxy_post(path: str, json_body: dict | None = None) -> JSONResponse:
    return await json_proxy("POST", f"{_bv_url()}{path}", json_body=json_body or {}, timeout=120.0)


async def _proxy_delete(path: str) -> JSONResponse:
    return await json_proxy("DELETE", f"{_bv_url()}{path}", timeout=30.0)


async def _proxy_stream(
    path: str,
    timeout: float = 300.0,
    method: str = "GET",
) -> StreamingResponse | JSONResponse:
    return await streaming_proxy(method, f"{_bv_url()}{path}", timeout=timeout)


@router.get("/voices")
async def list_voices() -> JSONResponse:
    return await _proxy_get("/api/tts/voices")


@router.get("/languages")
async def list_languages() -> JSONResponse:
    return await _proxy_get("/api/tts/languages")


@router.post("/speak", dependencies=[Depends(require_job_creation_rate)])
async def start_speak(request: dict = Body(...)) -> JSONResponse:
    return await _proxy_post("/api/tts/speak", json_body=request)


@router.get("/jobs")
async def list_all_jobs() -> JSONResponse:
    return await _proxy_get("/api/tts/jobs")


@router.get("/queue")
async def get_queue() -> JSONResponse:
    return await _proxy_get("/api/tts/queue", timeout=300.0)


@router.post("/release-idle-models", dependencies=[Depends(require_admin)])
async def release_idle_models() -> JSONResponse:
    return await _proxy_post("/api/tts/release-idle-models")


@router.get("/jobs/{job_id}")
async def get_job_status(job_id: str) -> JSONResponse:
    return await _proxy_get(f"/api/tts/jobs/{job_id}")


@router.delete("/jobs/{job_id}", dependencies=[Depends(require_operator)])
async def cancel_job(job_id: str) -> JSONResponse:
    import httpx
    url = f"{_bv_url()}/api/tts/jobs/{job_id}"
    client = get_shared_http_client()
    try:
        status_resp = await client.get(url, timeout=30.0)
        if status_resp.status_code == 200:
            job = status_resp.json()
            if job.get("status") in ("completed", "failed", "cancelled"):
                return JSONResponse(content={"job_id": job_id, "status": job["status"], "cancelled": False})
    except httpx.HTTPError:
        pass
    return await _proxy_delete(f"/api/tts/jobs/{job_id}")


@router.api_route("/jobs/{job_id}/audio", methods=["GET", "HEAD"])
async def stream_audio(job_id: str, request: Request) -> StreamingResponse:
    method = request.method
    return await _proxy_stream(f"/api/tts/jobs/{job_id}/audio", method=method)


@router.post("/preview", dependencies=[Depends(require_job_creation_rate)])
async def preview_voice(request: dict = Body(...)) -> JSONResponse:
    return await _proxy_post("/api/tts/preview", json_body=request)
