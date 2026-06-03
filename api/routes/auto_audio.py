"""Auto Audio routes — session orchestration for auto-generating TTS across all published stories."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from api.models.auto_audio import (
    AutoAudioHistoryEntry,
    AutoAudioPauseResponse,
    AutoAudioSessionResponse,
    BatchDeleteRequest,
    StartSessionRequest,
    StartSessionResponse,
)
from core.service import get_auto_audio_service

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
    if not service.stop_session():
        raise HTTPException(status_code=404, detail="No active session to stop.")
    return {"message": "Stop signal sent."}


@router.post("/pause", response_model=AutoAudioPauseResponse)
def pause_session() -> AutoAudioPauseResponse:
    """Pause the active session before it starts more batch work."""
    service = get_auto_audio_service()
    try:
        data = service.pause_session()
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return AutoAudioPauseResponse(**data)


@router.post("/resume", response_model=AutoAudioPauseResponse)
def resume_session() -> AutoAudioPauseResponse:
    """Resume a paused auto audio session."""
    service = get_auto_audio_service()
    try:
        data = service.resume_session()
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return AutoAudioPauseResponse(**data)


@router.get("/history", response_model=list[AutoAudioHistoryEntry])
def get_history() -> list[AutoAudioHistoryEntry]:
    """Return all past auto audio sessions."""
    service = get_auto_audio_service()
    sessions = service.get_history()
    entries = []
    for s in sessions:
        story_results = s.get("story_results", [])
        total_chapters = sum(r.get("chapters_uploaded", 0) for r in story_results)
        entries.append(AutoAudioHistoryEntry(
            session_id=s.get("session_id", ""),
            phase=s.get("phase", "phase1"),
            test_mode=s.get("test_mode", False),
            voice=s.get("voice", ""),
            status=s.get("status", ""),
            current_step=s.get("current_step", 0),
            current_step_desc=s.get("current_step_desc", ""),
            started_at=s.get("started_at"),
            finished_at=s.get("finished_at"),
            error=s.get("error", ""),
            total_stories=len(story_results),
            total_chapters=total_chapters,
        ))
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
def delete_sessions_batch(request: BatchDeleteRequest) -> dict:
    """Delete multiple sessions from history in a single operation."""
    service = get_auto_audio_service()
    deleted = service.delete_sessions_batch(request.session_ids)
    return {"deleted": deleted, "requested": len(request.session_ids)}


@router.delete("/history/{session_id}")
def delete_session(session_id: str) -> dict:
    """Delete a session from history."""
    service = get_auto_audio_service()
    deleted = service.delete_session(session_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found.")
    return {"deleted": True, "session_id": session_id}
