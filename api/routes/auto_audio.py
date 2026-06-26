"""Auto Audio routes — session orchestration for auto-generating TTS across all published stories."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import Field

from api.auth import require_active_user, require_job_creation_rate, require_operator
from api.models.auto_audio import (
    AutoAudioHistoryEntry,
    AutoAudioPauseResponse,
    AutoAudioSessionResponse,
    DeleteSessionsBatchRequest,
    DeleteSessionsBatchResponse,
    StartSessionRequest,
    StartSessionResponse,
)
from services.orchestrator.auto_audio_service import get_auto_audio_service

router = APIRouter(prefix="/api/auto-audio", tags=["Auto Audio"], dependencies=[Depends(require_active_user)])


@router.post("/start", response_model=StartSessionResponse, dependencies=[Depends(require_job_creation_rate)])
async def start_session(request: StartSessionRequest) -> StartSessionResponse:
    """Start a new auto audio session. Only one session can run at a time."""
    service = get_auto_audio_service()
    try:
        session_id = await service.start_session(
            phase=request.phase,
            test_mode=request.test_mode,
            voice=request.voice,
            limit=request.limit,
        )
        return StartSessionResponse(session_id=session_id)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@router.get("/status", response_model=AutoAudioSessionResponse | None)
async def get_status(
    log_limit: int | None = Query(default=None, ge=0, le=500),
    result_limit: int | None = Query(default=None, ge=0, le=500),
    compact: bool = Query(default=False),
) -> AutoAudioSessionResponse | None:
    """Return the current active session state, or the most recent completed session if none is running."""
    service = get_auto_audio_service()
    data = await service.get_status(
        log_limit=log_limit,
        result_limit=result_limit,
        compact=compact,
    )
    if data is None:
        return None
    return AutoAudioSessionResponse(**data)


@router.post("/stop", dependencies=[Depends(require_operator)])
async def stop_session() -> dict:
    """Signal the active session to stop gracefully."""
    service = get_auto_audio_service()
    try:
        await service.stop_session()
    except Exception:
        raise HTTPException(status_code=404, detail="No active session to stop.")
    return {"message": "Stop signal sent."}


@router.post("/pause", response_model=AutoAudioPauseResponse, dependencies=[Depends(require_operator)])
async def pause_session() -> AutoAudioPauseResponse:
    """Pause the active auto-audio session."""
    service = get_auto_audio_service()
    try:
        data = await service.pause_session()
    except Exception as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return AutoAudioPauseResponse(**data)


@router.post("/resume", response_model=AutoAudioPauseResponse, dependencies=[Depends(require_operator)])
async def resume_session() -> AutoAudioPauseResponse:
    """Resume a paused auto-audio session."""
    service = get_auto_audio_service()
    try:
        data = await service.resume_session()
    except Exception as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return AutoAudioPauseResponse(**data)


@router.get("/history", response_model=list[AutoAudioHistoryEntry])
async def get_history() -> list[AutoAudioHistoryEntry]:
    """Return all past auto audio sessions."""
    service = get_auto_audio_service()
    sessions = await service.get_history()
    return [
        AutoAudioHistoryEntry(
            session_id=s.get("session_id", ""),
            created_by_user_id=s.get("created_by_user_id"),
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
        )
        for s in sessions
    ]


@router.get("/history/{session_id}", response_model=AutoAudioSessionResponse)
async def get_session(session_id: str) -> AutoAudioSessionResponse:
    """Return full detail of a specific session."""
    service = get_auto_audio_service()
    session_data = await service.get_session(session_id)
    if session_data is None:
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found.")
    return AutoAudioSessionResponse(**session_data)


@router.post("/history/batch-delete", response_model=DeleteSessionsBatchResponse, dependencies=[Depends(require_operator)])
async def delete_sessions_batch(request: DeleteSessionsBatchRequest) -> DeleteSessionsBatchResponse:
    """Delete multiple sessions from history in a single operation."""
    service = get_auto_audio_service()
    deleted = await service.delete_sessions_batch(request.session_ids)
    return DeleteSessionsBatchResponse(deleted=deleted, requested=len(request.session_ids))


@router.delete("/history/{session_id}", dependencies=[Depends(require_operator)])
async def delete_session(session_id: str) -> dict:
    """Delete a session from history."""
    service = get_auto_audio_service()
    deleted = await service.delete_session(session_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found.")
    return {"deleted": True, "session_id": session_id}
