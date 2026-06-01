"""Data models for the auto-audio service."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from threading import Lock
from typing import Optional


_AVAILABLE_VOICES = ["af_heart", "af_bella"]


@dataclass
class LogEntry:
    timestamp: str
    step: int
    message: str
    level: str = "info"

    def to_dict(self) -> dict:
        return {
            "timestamp": self.timestamp,
            "step": self.step,
            "message": self.message,
            "level": self.level,
        }


@dataclass
class MissingChapterInfo:
    chapter_id: str
    chapter_index: int
    title: str


@dataclass
class StoryMissingAudio:
    story_id: str
    story_title: str
    missing_chapters: list[MissingChapterInfo]
    existing_voice: Optional[str] = None


@dataclass
class StoryResult:
    story_id: str
    story_title: str
    chapters_generated: int
    chapters_uploaded: int
    upload_errors: list[str]
    error: str = ""

    def to_dict(self) -> dict:
        return {
            "story_id": self.story_id,
            "story_title": self.story_title,
            "chapters_generated": self.chapters_generated,
            "chapters_uploaded": self.chapters_uploaded,
            "upload_errors": self.upload_errors,
            "error": self.error,
        }


@dataclass
class AutoAudioSession:
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
    started_at: Optional[str]
    finished_at: Optional[str]
    error: str
    story_results: list[dict] = field(default_factory=list)
    completed_stories: set[str] = field(default_factory=set)
    _stopping: bool = field(default=False)
    _lock: Lock = field(default_factory=Lock)
    limit: int = 20

    def to_dict(self) -> dict:
        with self._lock:
            return {
                "session_id": self.session_id,
                "phase": self.phase,
                "test_mode": self.test_mode,
                "voice": self.voice,
                "status": self.status,
                "current_step": self.current_step,
                "current_step_desc": self.current_step_desc,
                "current_story": self.current_story,
                "progress": self.progress,
                "chapter_progress": self.chapter_progress,
                "stories_missing_audio": self.stories_missing_audio,
                "logs": self.logs,
                "started_at": self.started_at,
                "finished_at": self.finished_at,
                "error": self.error,
                "story_results": self.story_results,
                "completed_stories": list(self.completed_stories),
            }

    def add_log(self, step: int, message: str, level: str = "info") -> None:
        with self._lock:
            self.logs.append(LogEntry(
                timestamp=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                step=step,
                message=message,
                level=level,
            ).to_dict())

    def set_step(self, step: int, desc: str, story: str = "") -> None:
        with self._lock:
            self.current_step = step
            self.current_step_desc = desc
            if story:
                self.current_story = story

    def set_status(self, status: str, error: str = "") -> None:
        with self._lock:
            self.status = status
            if error:
                self.error = error
            if status in ("completed", "error"):
                self.finished_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    def update_progress(self, done: int, total: int) -> None:
        with self._lock:
            self.progress = {"done": done, "total": total}

    def update_chapter_progress(self, done: int, total: int) -> None:
        with self._lock:
            self.chapter_progress = {"done": done, "total": total}

    def set_stories_preview(self, stories: list[dict]) -> None:
        with self._lock:
            self.stories_missing_audio = stories

    def add_story_result(self, result: dict) -> None:
        with self._lock:
            self.story_results.append(result)

    def record_completed_story(self, story_id: str) -> None:
        with self._lock:
            self.completed_stories.add(story_id)


@dataclass
class _CompressedAudio:
    data: bytes
    name: str
    original: int
    compressed: int
    size: int
