"""Auto Audio routes — session orchestration for auto-generating TTS across all published stories."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, Request

from api.models.auto_audio import (
    AutoAudioHistoryEntry,
    AutoAudioPauseResponse,
    AutoAudioSessionResponse,
    AutoAudioSettings,
    AutoAudioSettingsUpdate,
    AutoScanStateResponse,
    BatchDeleteRequest,
    StartSessionRequest,
    StartSessionResponse,
    UpdateAutoScanRequest,
)
from core.config import get_owned_settings, update_owned_settings
from core.service import get_auto_audio_service
from api.service_auth import current_owner, require_owner

router = APIRouter(prefix="/api/auto-audio", tags=["Auto Audio"])


@router.get("/settings", response_model=AutoAudioSettings)
def get_settings() -> AutoAudioSettings:
    """Return settings owned and persisted by AutoAudio."""
    return AutoAudioSettings(**get_owned_settings())


@router.put("/settings", response_model=AutoAudioSettings)
def update_settings(body: AutoAudioSettingsUpdate) -> AutoAudioSettings:
    """Persist a partial AutoAudio settings update."""
    updated = update_owned_settings(body.model_dump(exclude_none=True))
    return AutoAudioSettings(**updated)


@router.post("/start", response_model=StartSessionResponse)
def start_session(request: StartSessionRequest, http_request: Request) -> StartSessionResponse:
    """Start a new auto audio session. Only one session can run at a time."""
    service = get_auto_audio_service()
    try:
        session_id = service.start_session(
            phase=request.phase,
            test_mode=request.test_mode,
            voice=request.voice,
            limit=request.limit,
            created_by_user_id=current_owner(http_request),
        )
        return StartSessionResponse(session_id=session_id)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@router.get("/auto-scan", response_model=AutoScanStateResponse)
def get_auto_scan() -> AutoScanStateResponse:
    """Return the persisted auto-scan schedule state plus whether a scan is running."""
    service = get_auto_audio_service()
    state = service.get_auto_scan_state()
    return AutoScanStateResponse(**state, is_running=service.is_session_active())


@router.put("/auto-scan", response_model=AutoScanStateResponse)
def update_auto_scan(req: UpdateAutoScanRequest) -> AutoScanStateResponse:
    """Toggle the schedule and/or update the interval and chapter threshold."""
    service = get_auto_audio_service()
    state = service.update_auto_scan_state(
        enabled=req.enabled,
        interval_hours=req.interval_hours,
        chapter_threshold=req.chapter_threshold,
    )
    return AutoScanStateResponse(**state, is_running=service.is_session_active())


@router.post("/auto-scan/run-now", response_model=StartSessionResponse)
def run_auto_scan_now() -> StartSessionResponse:
    """Trigger a one-off full-library scan immediately, regardless of the toggle."""
    service = get_auto_audio_service()
    try:
        session_id = service.run_auto_scan_now()
        return StartSessionResponse(session_id=session_id)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@router.get("/status", response_model=AutoAudioSessionResponse | None)
def get_status(
    request: Request,
    log_limit: int | None = Query(default=None, ge=0, le=500),
    result_limit: int | None = Query(default=None, ge=0, le=500),
    compact: bool = Query(default=False),
) -> AutoAudioSessionResponse | None:
    """Return the current active session state, or the most recent completed session if none is running."""
    service = get_auto_audio_service()
    data = service.get_status(
        log_limit=log_limit,
        result_limit=result_limit,
        compact=compact,
    )
    if data is None:
        return None
    try:
        require_owner(request, data.get("created_by_user_id"))
    except HTTPException:
        return None
    return AutoAudioSessionResponse(**data)


@router.post("/stop")
def stop_session(request: Request) -> dict:
    """Signal the active session to stop gracefully."""
    service = get_auto_audio_service()
    active = service.get_status(compact=True)
    if active is None:
        raise HTTPException(status_code=404, detail="No active session to stop.")
    require_owner(request, active.get("created_by_user_id"))
    if not service.stop_session():
        raise HTTPException(status_code=404, detail="No active session to stop.")
    return {"message": "Stop signal sent."}


@router.post("/pause", response_model=AutoAudioPauseResponse)
def pause_session(request: Request) -> AutoAudioPauseResponse:
    """Pause the active session before it starts more batch work."""
    service = get_auto_audio_service()
    active = service.get_status(compact=True)
    if active is None:
        raise HTTPException(status_code=404, detail="No active session to pause.")
    require_owner(request, active.get("created_by_user_id"))
    try:
        data = service.pause_session()
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return AutoAudioPauseResponse(**data)


@router.post("/resume", response_model=AutoAudioPauseResponse)
def resume_session(request: Request) -> AutoAudioPauseResponse:
    """Resume a paused auto audio session."""
    service = get_auto_audio_service()
    active = service.get_status(compact=True)
    if active is None:
        raise HTTPException(status_code=404, detail="No active session to resume.")
    require_owner(request, active.get("created_by_user_id"))
    try:
        data = service.resume_session()
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return AutoAudioPauseResponse(**data)


@router.get("/history", response_model=list[AutoAudioHistoryEntry])
def get_history(request: Request) -> list[AutoAudioHistoryEntry]:
    """Return all past auto audio sessions."""
    service = get_auto_audio_service()
    sessions = service.get_history()
    role = getattr(request.state, "create_story_role", None)
    owner_id = current_owner(request)
    if role not in ("admin", "operator"):
        sessions = [s for s in sessions if s.get("created_by_user_id") == owner_id]
    entries = []
    for s in sessions:
        entries.append(AutoAudioHistoryEntry(
            session_id=s.get("session_id", ""),
            created_by_user_id=s.get("created_by_user_id"),
            phase=s.get("phase", "phase1"),
            test_mode=s.get("test_mode", False),
            voice=s.get("voice", ""),
            status=s.get("status", ""),
            current_step=s.get("current_step", 0),
            current_step_desc=s.get("current_step_desc", ""),
            started_at=s.get("started_at"),
            finished_at=s.get("finished_at"),
            error=s.get("error", ""),
            total_stories=s.get("total_stories", 0),
            total_chapters=s.get("total_chapters", 0),
        ))
    return entries


@router.get("/history/{session_id}", response_model=AutoAudioSessionResponse)
def get_session(session_id: str, request: Request) -> AutoAudioSessionResponse:
    """Return full detail of a specific session."""
    service = get_auto_audio_service()
    session_data = service.get_session(session_id)
    if session_data is None:
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found.")
    require_owner(request, session_data.get("created_by_user_id"))
    return AutoAudioSessionResponse(**session_data)


@router.post("/history/batch-delete")
def delete_sessions_batch(request: BatchDeleteRequest, http_request: Request) -> dict:
    """Delete multiple sessions from history in a single operation."""
    service = get_auto_audio_service()
    for session_id in request.session_ids:
        session = service.get_session(session_id)
        if session is None:
            raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found.")
        require_owner(http_request, session.get("created_by_user_id"))
    deleted = service.delete_sessions_batch(request.session_ids)
    return {"deleted": deleted, "requested": len(request.session_ids)}


@router.delete("/history/{session_id}")
def delete_session(session_id: str, request: Request) -> dict:
    """Delete a session from history."""
    service = get_auto_audio_service()
    session = service.get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found.")
    require_owner(request, session.get("created_by_user_id"))
    deleted = service.delete_session(session_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found.")
    return {"deleted": True, "session_id": session_id}
