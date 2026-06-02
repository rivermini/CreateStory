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


class AutoAudioSessionResponse(BaseModel):
    session_id: str
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


class AutoAudioHistoryEntry(BaseModel):
    session_id: str
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
