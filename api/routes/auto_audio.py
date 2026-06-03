"""Auto Audio routes — session orchestration for auto-generating TTS across all published stories."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import Field

from api.models.auto_audio import (
    AutoAudioHistoryEntry,
    AutoAudioPauseResponse,
    AutoAudioSessionResponse,
    StartSessionRequest,
    StartSessionResponse,
)
from services.orchestrator.auto_audio_service import get_auto_audio_service

router = APIRouter(prefix="/api/auto-audio", tags=["Auto Audio"])


@router.post("/start", response_model=StartSessionResponse)
def start_session(request: StartSessionRequest) -> StartSessionResponse:
    """Start a new auto audio session. Only one session can run at a time."""
    service = get_auto_audio_service()
    try:
        session_id = service.start_session(
            phase=request.phase,
            test_mode=request.test_mode,
            voice=request.voice,
            limit=request.limit,
        )
        return StartSessionResponse(session_id=session_id)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@router.get("/status", response_model=AutoAudioSessionResponse | None)
def get_status() -> AutoAudioSessionResponse | None:
    """Return the current active session state, or the most recent completed session if none is running."""
    service = get_auto_audio_service()
    data = service.get_status()
    if data is None:
        return None
    return AutoAudioSessionResponse(**data)


@router.post("/stop")
def stop_session() -> dict:
    """Signal the active session to stop gracefully."""
    service = get_auto_audio_service()
    try:
        service.stop_session()
    except Exception as exc:
        raise HTTPException(status_code=404, detail="No active session to stop.")
    return {"message": "Stop signal sent."}


@router.post("/pause", response_model=AutoAudioPauseResponse)
def pause_session() -> AutoAudioPauseResponse:
    """Pause the active auto-audio session."""
    service = get_auto_audio_service()
    try:
        data = service.pause_session()
    except Exception as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return AutoAudioPauseResponse(**data)


@router.post("/resume", response_model=AutoAudioPauseResponse)
def resume_session() -> AutoAudioPauseResponse:
    """Resume a paused auto-audio session."""
    service = get_auto_audio_service()
    try:
        data = service.resume_session()
    except Exception as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return AutoAudioPauseResponse(**data)


@router.get("/history", response_model=list[AutoAudioHistoryEntry])
def get_history() -> list[AutoAudioHistoryEntry]:
    """Return all past auto audio sessions."""
    import time, logging
    _t0 = time.monotonic()
    _logger = logging.getLogger(__name__)
    service = get_auto_audio_service()
    sessions = service.get_history()
    _logger.info("FastAPIServer get_history: service.get_history took %.1fms", (time.monotonic() - _t0) * 1000)
    entries = []
    for s in sessions:
        # Pass through the pre-computed totals from BedReadVoices.
        # story_results is not included in the history list response, so we
        # rely on the values that BedReadVoices already computed.
        entries.append(AutoAudioHistoryEntry(
            session_id=s.get("session_id", ""),
            phase=s.get("phase", "phase1"),
            test_mode=s.get("test_mode", False),
            voice=s.get("voice") or "",
            status=s.get("status", ""),
            current_step=s.get("current_step", 0),
            current_step_desc=s.get("current_step_desc", ""),
            started_at=s.get("started_at"),
            finished_at=s.get("finished_at"),
            error=s.get("error", ""),
            total_stories=s.get("total_stories", 0),
            total_chapters=s.get("total_chapters", 0),
        ))
    _logger.info("FastAPIServer get_history: total took %.1fms for %d sessions", (time.monotonic() - _t0) * 1000, len(entries))
    return entries


@router.get("/history/{session_id}", response_model=AutoAudioSessionResponse)
def get_session(session_id: str) -> AutoAudioSessionResponse:
    """Return full detail of a specific session."""
    service = get_auto_audio_service()
    session_data = service.get_session(session_id)
    if session_data is None:
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found.")
    return AutoAudioSessionResponse(**session_data)


@router.post("/history/batch-delete")
def delete_sessions_batch(request: dict) -> dict:
    """Delete multiple sessions from history in a single operation."""
    service = get_auto_audio_service()
    session_ids = request.get("session_ids", [])
    deleted = service.delete_sessions_batch(session_ids)
    return {"deleted": deleted, "requested": len(session_ids)}


@router.delete("/history/{session_id}")
def delete_session(session_id: str) -> dict:
    """Delete a session from history."""
    service = get_auto_audio_service()
    deleted = service.delete_session(session_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found.")
    return {"deleted": True, "session_id": session_id}
