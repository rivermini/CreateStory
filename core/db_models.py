"""SQLAlchemy models for AutoAudio runtime metadata."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from core.db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class AutoAudioSessionRecord(Base):
    __tablename__ = "auto_audio_sessions"

    session_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    phase: Mapped[str] = mapped_column(String(32), nullable=False, default="", index=True)
    test_mode: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    voice: Mapped[str | None] = mapped_column(String(128), nullable=True)
    status: Mapped[str] = mapped_column(String(64), nullable=False, default="idle", index=True)
    current_step: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    current_step_desc: Mapped[str] = mapped_column(Text, nullable=False, default="")
    current_story: Mapped[str] = mapped_column(Text, nullable=False, default="")
    started_at: Mapped[str | None] = mapped_column(String(64), nullable=True)
    finished_at: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error: Mapped[str] = mapped_column(Text, nullable=False, default="")
    total_stories: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_chapters: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    progress: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    chapter_progress: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    stories_missing_audio: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    story_results: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    logs: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    full_data: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)


class AutoAudioCompletedStoriesRecord(Base):
    __tablename__ = "auto_audio_completed_stories"

    phase: Mapped[str] = mapped_column(String(32), primary_key=True)
    story_ids: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)


class AppSetting(Base):
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(128), primary_key=True)
    value: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)
