"""TTS routes — proxy to BedReadVoices."""

from __future__ import annotations

import os
from typing import Optional

from fastapi import APIRouter, Body, HTTPException, Query, Request
from fastapi.responses import JSONResponse, StreamingResponse

router = APIRouter(prefix="/api/tts", tags=["TTS"])


def _bv_url() -> str:
    return os.environ.get("SERVICE_URLS_BedReadVoices", "http://localhost:8001").rstrip("/")


async def _proxy_get(path: str, params: dict | None = None, timeout: float = 120.0) -> JSONResponse:
    import httpx
    url = f"{_bv_url()}{path}"
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.get(url, params=params or {})
        resp.raise_for_status()
        return JSONResponse(content=resp.json())


async def _proxy_post(path: str, json_body: dict | None = None) -> JSONResponse:
    import httpx
    url = f"{_bv_url()}{path}"
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(url, json=json_body or {})
        resp.raise_for_status()
        return JSONResponse(content=resp.json())


async def _proxy_delete(path: str) -> JSONResponse:
    import httpx
    url = f"{_bv_url()}{path}"
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.delete(url)
        resp.raise_for_status()
        return JSONResponse(content=resp.json())


async def _proxy_stream(path: str, timeout: float = 300.0, method: str = "GET") -> StreamingResponse:
    import httpx
    url = f"{_bv_url()}{path}"
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        if method == "HEAD":
            resp = await client.head(url)
            resp.raise_for_status()
            headers = {k: v for k, v in resp.headers.items() if k.lower() not in ("host", "connection")}
            return StreamingResponse(iter([]), headers=headers)
        resp = await client.get(url)
        resp.raise_for_status()
        content_type = resp.headers.get("content-type", "application/octet-stream")
        headers = {k: v for k, v in resp.headers.items() if k.lower() not in ("host", "connection")}
        return StreamingResponse(resp.aiter_bytes(), media_type=content_type, headers=headers)


@router.get("/voices")
async def list_voices() -> JSONResponse:
    return await _proxy_get("/api/tts/voices")


@router.get("/languages")
async def list_languages() -> JSONResponse:
    return await _proxy_get("/api/tts/languages")


@router.post("/speak")
async def start_speak(request: dict = Body(...)) -> JSONResponse:
    return await _proxy_post("/api/tts/speak", json_body=request)


@router.get("/jobs")
async def list_all_jobs() -> JSONResponse:
    return await _proxy_get("/api/tts/jobs")


@router.get("/queue")
async def get_queue() -> JSONResponse:
    return await _proxy_get("/api/tts/queue", timeout=300.0)


@router.post("/release-idle-models")
async def release_idle_models() -> JSONResponse:
    return await _proxy_post("/api/tts/release-idle-models")


@router.get("/jobs/{job_id}")
async def get_job_status(job_id: str) -> JSONResponse:
    return await _proxy_get(f"/api/tts/jobs/{job_id}")


@router.delete("/jobs/{job_id}")
async def cancel_job(job_id: str) -> JSONResponse:
    import httpx
    url = f"{_bv_url()}/api/tts/jobs/{job_id}"
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            status_resp = await client.get(url)
            if status_resp.status_code == 200:
                job = status_resp.json()
                if job.get("status") in ("completed", "failed", "cancelled"):
                    return JSONResponse(content={"job_id": job_id, "status": job["status"], "cancelled": False})
        except httpx.HTTPError:
            pass
        resp = await client.delete(url)
        resp.raise_for_status()
        return JSONResponse(content=resp.json())


@router.api_route("/jobs/{job_id}/audio", methods=["GET", "HEAD"])
async def stream_audio(job_id: str, request: Request) -> StreamingResponse:
    method = request.method
    return await _proxy_stream(f"/api/tts/jobs/{job_id}/audio", method=method)


@router.post("/preview")
async def preview_voice(request: dict = Body(...)) -> StreamingResponse:
    return await _proxy_stream("/api/tts/preview", timeout=300.0)
