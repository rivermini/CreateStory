"""TTS routes — speech synthesis via Kokoro ONNX."""

from __future__ import annotations

import logging
from typing import Optional
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from api.services.tts_service import (
    get_tts_service,
    MAX_KOKORO_CONCURRENCY,
    MIN_KOKORO_CONCURRENCY,
    SAMPLE_RATE,
    TTSCapacityError,
)
from api.service_auth import current_owner, require_admin_identity, require_owner

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/tts", tags=["TTS"])


def _content_disposition(filename: str) -> str:
    ascii_name = "".join(c if ord(c) < 128 else "_" for c in filename)
    encoded = quote(filename, safe="")
    return f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{encoded}"


class SpeakRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=100000, description="Text to synthesize.")
    voice: str = Field(default="af_heart", description="Voice ID (e.g. af_sarah, am_adam).")
    lang: str = Field(default="en-us", description="Language code.")
    speed: float = Field(default=0.69, ge=0.5, le=2.0, description="Speech speed (0.5-2.0).")
    format: str = Field(default="wav", pattern="^(wav|mp3)$", description="Output format.")


class SpeakResponse(BaseModel):
    job_id: str
    status: str


class VoiceResponse(BaseModel):
    id: str
    label: str
    lang: str


class LanguageResponse(BaseModel):
    code: str
    label: str


class ConcurrencyRequest(BaseModel):
    concurrency: int | None = Field(
        default=None,
        ge=MIN_KOKORO_CONCURRENCY,
        le=MAX_KOKORO_CONCURRENCY,
        description="Number of concurrent Kokoro workers (1-2).",
    )


@router.post("/concurrency")
def update_concurrency(request: ConcurrencyRequest, http_request: Request) -> dict:
    require_admin_identity(http_request)
    service = get_tts_service()
    if request.concurrency is None:
        service.set_auto_concurrency()
        return {"concurrency": service.get_concurrency(), "mode": "auto"}

    service.set_concurrency(request.concurrency)
    return {"concurrency": service.get_concurrency(), "mode": "manual"}


@router.get("/voices", response_model=list[VoiceResponse])
def list_voices() -> list[VoiceResponse]:
    service = get_tts_service()
    voices = service.get_voices()
    return [VoiceResponse(**v) for v in voices]


@router.get("/languages", response_model=list[LanguageResponse])
def list_languages() -> list[LanguageResponse]:
    service = get_tts_service()
    langs = service.get_languages()
    return [LanguageResponse(**l) for l in langs]


@router.post("/speak", response_model=SpeakResponse)
def start_speak(request: SpeakRequest, http_request: Request) -> SpeakResponse:
    service = get_tts_service()

    supported_langs = {l["code"] for l in service.get_languages()}
    if request.lang not in supported_langs:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported language '{request.lang}'. Supported: {sorted(supported_langs)}",
        )

    if request.format not in ("wav", "mp3"):
        raise HTTPException(status_code=400, detail="Format must be 'wav' or 'mp3'.")

    try:
        job_id = service.start_job(
            text=request.text,
            voice=request.voice,
            lang=request.lang,
            speed=request.speed,
            format=request.format,
            created_by_user_id=current_owner(http_request),
        )
    except TTSCapacityError as exc:
        raise HTTPException(
            status_code=429,
            detail=str(exc),
            headers={"Retry-After": "60"},
        ) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    return SpeakResponse(job_id=job_id, status="queued")


@router.get("/jobs")
def list_all_jobs(request: Request) -> list[dict]:
    service = get_tts_service()
    jobs = service.list_jobs()
    role = getattr(request.state, "create_story_role", None)
    owner_id = current_owner(request)
    if role == "admin" or (role is None and owner_id is None):
        return jobs
    return [job for job in jobs if job.get("created_by_user_id") == owner_id]


@router.get("/queue")
def get_queue(request: Request) -> dict:
    service = get_tts_service()
    jobs = service.list_jobs()
    jobs = [
        job
        for job in jobs
        if getattr(request.state, "create_story_role", None) == "admin"
        or job.get("created_by_user_id") == current_owner(request)
    ]

    processing = [j for j in jobs if j["status"] == "processing"]
    queued = [j for j in jobs if j["status"] == "queued"]

    return {
        "concurrency": service.get_concurrency(),
        "active_workers": len(processing),
        "queue_size": len(queued),
        "currently_processing": processing,
        "queued": queued,
    }


@router.post("/release-idle-models")
def release_idle_models(request: Request) -> dict:
    require_admin_identity(request)
    service = get_tts_service()
    released = service.release_idle_models()
    return {"released": released, "concurrency": service.get_concurrency()}


@router.get("/jobs/{job_id}")
def get_job_status(job_id: str, request: Request) -> dict:
    service = get_tts_service()
    job = service.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found.")
    require_owner(request, job.get("created_by_user_id"))
    return job


@router.delete("/jobs/{job_id}")
def cancel_job(job_id: str, request: Request) -> dict:
    service = get_tts_service()
    existing = service.get_job(job_id)
    if existing is None:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found.")
    require_owner(request, existing.get("created_by_user_id"))
    cancelled = service.cancel_job(job_id)
    if not cancelled:
        job = service.get_job(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found.")
        raise HTTPException(
            status_code=409,
            detail=f"Job '{job_id}' cannot be cancelled (status={job['status']}).",
        )
    return {"job_id": job_id, "status": "cancelled"}


@router.api_route("/jobs/{job_id}/audio", methods=["GET", "HEAD"])
def stream_audio(job_id: str, request: Request) -> StreamingResponse:
    service = get_tts_service()
    job = service.get_job(job_id)

    if job is None:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found.")
    require_owner(request, job.get("created_by_user_id"))

    output_dir = service.get_output_dir(job_id)

    if job["status"] in ("cancelled", "failed") and not output_dir:
        raise HTTPException(status_code=404, detail=f"No audio available for job '{job_id}'.")

    if job["status"] in ("queued", "processing") and output_dir:
        chunks: list[dict] = []
        for f in sorted(output_dir.iterdir()):
            if f.name.startswith("chunk_"):
                chunks.append({
                    "filename": f.name,
                    "size_bytes": f.stat().st_size,
                })

        if chunks:
            return JSONResponse(
                content={
                    "status": job["status"],
                    "chunks_done": job["chunks_done"],
                    "chunks_total": job["chunks_total"],
                    "progress_pct": job["progress_pct"],
                    "chunks": chunks,
                },
                headers={
                    "Cache-Control": "no-cache, no-transform",
                    "X-Accel-Buffering": "no",
                },
            )

        return JSONResponse(
            content={
                "status": job["status"],
                "chunks_done": job["chunks_done"],
                "chunks_total": job["chunks_total"],
                "progress_pct": job["progress_pct"],
                "chunks": [],
            },
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
            },
        )

    if job["status"] == "failed":
        raise HTTPException(
            status_code=422,
            detail=f"TTS job failed: {job.get('error', 'Unknown error')}",
        )

    if job["status"] == "cancelled":
        raise HTTPException(status_code=410, detail="Job was cancelled.")

    output_path = service.get_output_path(job_id)
    if output_path is None or not output_path.exists():
        raise HTTPException(status_code=404, detail="Audio file not found on disk.")

    fmt = job.get("format", "wav")
    mime_type = "audio/wav" if fmt == "wav" else "audio/mpeg"

    return FileResponse(
        output_path,
        media_type=mime_type,
        filename=output_path.name,
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
        },
    )


_PREVIEW_TEXT = (
    "Hello! This is a voice preview from Kokoro Text to Speech. "
    "You can change the voice and speed to suit your preferences."
)


class PreviewRequest(BaseModel):
    voice: str = Field(default="af_heart")
    lang: str = Field(default="en-us")
    speed: float = Field(default=0.69, ge=0.5, le=2.0)


class PreviewAcceptedResponse(BaseModel):
    job_id: str
    status: str
    status_url: str
    audio_url: Optional[str] = None
    message: str = "Preview job queued. Poll status_url for progress."


@router.post("/preview", response_model=PreviewAcceptedResponse, status_code=202)
def preview_voice(request: PreviewRequest, http_request: Request) -> PreviewAcceptedResponse:
    """Queue a preview TTS job and return immediately with a status URL.

    The client should poll `status_url` until `status == "completed"`, then
    fetch `audio_url` (the same path as `GET /api/tts/jobs/{id}/audio`) to
    download the WAV. This is non-blocking: the worker thread is released
    as soon as the job is queued, so multiple concurrent preview requests
    do not serialize on a single async sleep loop.
    """
    service = get_tts_service()

    supported_langs = {l["code"] for l in service.get_languages()}
    if request.lang not in supported_langs:
        raise HTTPException(status_code=400, detail=f"Unsupported language: {request.lang}")

    try:
        job_id = service.start_job(
            text=_PREVIEW_TEXT,
            voice=request.voice,
            lang=request.lang,
            speed=request.speed,
            format="wav",
            created_by_user_id=current_owner(http_request),
        )
    except TTSCapacityError as exc:
        raise HTTPException(
            status_code=429,
            detail=str(exc),
            headers={"Retry-After": "60"},
        ) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    return PreviewAcceptedResponse(
        job_id=job_id,
        status="queued",
        status_url=f"/api/tts/jobs/{job_id}",
        audio_url=f"/api/tts/jobs/{job_id}/audio",
    )
