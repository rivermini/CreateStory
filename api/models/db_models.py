"""SQLAlchemy models for BedReadVoices runtime metadata."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import BigInteger, Boolean, DateTime, Float, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from api.db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class BedReadAudioJobRecord(Base):
    __tablename__ = "bedread_audio_jobs"

    batch_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    story_id: Mapped[str] = mapped_column(String(128), nullable=False, default="", index=True)
    story_title: Mapped[str] = mapped_column(Text, nullable=False, default="")
    voice: Mapped[str] = mapped_column(String(128), nullable=False, default="af_sarah")
    lang: Mapped[str] = mapped_column(String(32), nullable=False, default="en-us")
    speed: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    format: Mapped[str] = mapped_column(String(16), nullable=False, default="wav")
    status: Mapped[str] = mapped_column(String(64), nullable=False, default="pending", index=True)
    progress_pct: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    output_dir: Mapped[str] = mapped_column(Text, nullable=False, default="")
    started_at: Mapped[str | None] = mapped_column(String(64), nullable=True)
    processing_started_at: Mapped[str | None] = mapped_column(String(64), nullable=True)
    finished_at: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error: Mapped[str] = mapped_column(Text, nullable=False, default="")
    queue_position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    zip_path: Mapped[str] = mapped_column(Text, nullable=False, default="")
    from_auto_mode: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    chapters: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    raw: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)


class GeneratedAudioFileRecord(Base):
    __tablename__ = "generated_audio_files"

    job_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    status: Mapped[str] = mapped_column(String(64), nullable=False, default="queued", index=True)
    voice: Mapped[str] = mapped_column(String(128), nullable=False, default="af_sarah")
    lang: Mapped[str] = mapped_column(String(32), nullable=False, default="en-us")
    speed: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    format: Mapped[str] = mapped_column(String(16), nullable=False, default="wav")
    output_dir: Mapped[str] = mapped_column(Text, nullable=False, default="")
    output_filename: Mapped[str] = mapped_column(Text, nullable=False, default="")
    output_path: Mapped[str] = mapped_column(Text, nullable=False, default="")
    file_size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    chunks_total: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    chunks_done: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    progress_pct: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    started_at: Mapped[str | None] = mapped_column(String(64), nullable=True)
    finished_at: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error: Mapped[str] = mapped_column(Text, nullable=False, default="")
    text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    raw: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)
