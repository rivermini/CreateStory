"""TTS routes — speech synthesis via Kokoro ONNX."""

from __future__ import annotations

import logging
from io import BytesIO
from urllib.parse import quote

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from api.services.tts_service import get_tts_service, SAMPLE_RATE

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/tts", tags=["TTS"])


def _content_disposition(filename: str) -> str:
    ascii_name = "".join(c if ord(c) < 128 else "_" for c in filename)
    encoded = quote(filename, safe="")
    return f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{encoded}"


class SpeakRequest(BaseModel):
    text: str = Field(..., min_length=1, description="Text to synthesize.")
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
    concurrency: int | None = Field(default=None, ge=1, le=8, description="Number of concurrent TTS workers (1-8), or null for auto.")


@router.post("/concurrency")
def update_concurrency(request: ConcurrencyRequest) -> dict:
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
def start_speak(request: SpeakRequest) -> SpeakResponse:
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
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    return SpeakResponse(job_id=job_id, status="queued")


@router.get("/jobs")
def list_all_jobs() -> list[dict]:
    service = get_tts_service()
    return service.list_jobs()


@router.get("/queue")
def get_queue() -> dict:
    service = get_tts_service()
    jobs = service.list_jobs()

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
def release_idle_models() -> dict:
    service = get_tts_service()
    released = service.release_idle_models()
    return {"released": released, "concurrency": service.get_concurrency()}


@router.get("/jobs/{job_id}")
def get_job_status(job_id: str) -> dict:
    service = get_tts_service()
    job = service.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found.")
    return job


@router.delete("/jobs/{job_id}")
def cancel_job(job_id: str) -> dict:
    service = get_tts_service()
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
def stream_audio(job_id: str) -> StreamingResponse:
    service = get_tts_service()
    job = service.get_job(job_id)

    if job is None:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found.")

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

    buf = BytesIO(output_path.read_bytes())
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type=mime_type,
        headers={
            "Content-Disposition": _content_disposition(output_path.name),
            "Content-Length": str(output_path.stat().st_size),
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


@router.post("/preview")
def preview_voice(request: PreviewRequest) -> StreamingResponse:
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
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    import time
    for _ in range(120):
        time.sleep(1)
        job = service.get_job(job_id)
        if job is None:
            raise HTTPException(status_code=500, detail="Job disappeared.")
        if job["status"] == "completed":
            output_path = service.get_output_path(job_id)
            if output_path and output_path.exists():
                buf = BytesIO(output_path.read_bytes())
                return StreamingResponse(
                    iter([buf.getvalue()]),
                    media_type="audio/wav",
                    headers={
                        "Content-Disposition": 'attachment; filename="preview.wav"',
                        "Content-Length": str(output_path.stat().st_size),
                    },
                )
            raise HTTPException(status_code=500, detail="Audio file not found after completion.")
        if job["status"] in ("failed", "cancelled"):
            raise HTTPException(
                status_code=422,
                detail=f"Preview generation failed: {job.get('error', 'Unknown')}",
            )

    raise HTTPException(status_code=504, detail="Preview generation timed out.")
