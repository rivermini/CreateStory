"""Pydantic models for auto-audio sessions (API layer)."""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


class StartSessionRequest(BaseModel):
    phase: str = Field(
        default="phase1",
        description="Which phase to run: 'phase1' (needing-update stories), 'phase2' (N most recently updated), or 'phase3' (test story IDs).",
    )
    test_mode: bool = Field(default=False, description="Use test mode with hardcoded story IDs.")
    voice: Optional[str] | None = Field(
        default=None,
        description="Voice ID for TTS generation. If omitted, randomly picks between af_heart and af_bella per story.",
    )
    limit: int = Field(default=20, description="For phase2: number of most recently updated stories to process.")


class StartSessionResponse(BaseModel):
    session_id: str


class AutoAudioPauseResponse(BaseModel):
    is_paused: bool
    status: str


class AutoAudioSessionResponse(BaseModel):
    session_id: str
    created_by_user_id: str | None = None
    phase: str
    test_mode: bool
    voice: Optional[str]
    status: str
    current_step: int
    current_step_desc: str
    current_story: str
    progress: dict
    chapter_progress: dict
    stories_missing_audio: list[dict]
    logs: list[dict]
    started_at: str | None
    finished_at: str | None
    error: str
    story_results: list[dict] = Field(default_factory=list)
    is_paused: bool = False


class AutoAudioHistoryEntry(BaseModel):
    session_id: str
    created_by_user_id: str | None = None
    phase: str
    test_mode: bool
    voice: Optional[str]
    status: str
    current_step: int
    current_step_desc: str
    started_at: str | None
    finished_at: str | None
    error: str
    total_stories: int = 0
    total_chapters: int = 0


class BatchDeleteRequest(BaseModel):
    session_ids: list[str]


class AutoScanStateResponse(BaseModel):
    enabled: bool
    interval_hours: float
    chapter_threshold: int
    last_run_at: str | None = None
    next_run_at: str | None = None
    last_session_id: str | None = None
    is_running: bool = False


class UpdateAutoScanRequest(BaseModel):
    enabled: Optional[bool] = Field(default=None, description="Master ON/OFF for the auto-scan schedule.")
    interval_hours: Optional[float] = Field(default=None, gt=0, description="Hours between scheduled scans.")
    chapter_threshold: Optional[int] = Field(default=None, ge=0, description="Generate only if total missing chapters exceed this.")
