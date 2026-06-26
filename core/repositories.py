"""PostgreSQL repository for AutoAudio sessions and skip lists."""

from __future__ import annotations

import json
from pathlib import Path

from sqlalchemy import delete, func, select

from core.db import SessionLocal
from core.db_models import AutoAudioCompletedStoriesRecord, AutoAudioSessionRecord


class AutoAudioRepository:
    def __init__(self, session_factory=SessionLocal) -> None:
        self.session_factory = session_factory

    def import_existing_logs(self, logs_dir: Path) -> None:
        logs_dir.mkdir(parents=True, exist_ok=True)
        if not self.has_sessions():
            sessions = self._load_history_file(logs_dir / "sessions.json")
            for session_file in logs_dir.glob("session_*.json"):
                try:
                    full = json.loads(session_file.read_text(encoding="utf-8"))
                except Exception:
                    continue
                if isinstance(full, dict) and full.get("session_id"):
                    sessions[full["session_id"]] = full
            self.save_sessions(list(sessions.values()))

        for completed_file in logs_dir.glob("completed_stories_*.json"):
            phase = completed_file.stem.removeprefix("completed_stories_")
            if self.load_completed_stories(phase):
                continue
            try:
                data = json.loads(completed_file.read_text(encoding="utf-8"))
            except Exception:
                continue
            story_ids = data.get("story_ids", []) if isinstance(data, dict) else []
            if story_ids:
                self.save_completed_stories(phase, set(story_ids))

    def has_sessions(self) -> bool:
        with self.session_factory() as db:
            return bool(db.scalar(select(func.count()).select_from(AutoAudioSessionRecord)))

    def load_history(self) -> list[dict]:
        with self.session_factory() as db:
            rows = db.scalars(select(AutoAudioSessionRecord).order_by(AutoAudioSessionRecord.started_at.desc().nullslast())).all()
            return [self._row_to_summary(row) for row in rows]

    def get_session(self, session_id: str) -> dict | None:
        with self.session_factory() as db:
            row = db.get(AutoAudioSessionRecord, session_id)
            if row is None:
                return None
            return self._row_to_full(row)

    def save_session(self, data: dict) -> None:
        if not data.get("session_id"):
            return
        with self.session_factory() as db:
            db.merge(self._dict_to_row(data))
            db.commit()

    def save_sessions(self, sessions: list[dict]) -> None:
        with self.session_factory() as db:
            for data in sessions:
                if data.get("session_id"):
                    db.merge(self._dict_to_row(data))
            db.commit()

    def delete_session(self, session_id: str) -> bool:
        with self.session_factory() as db:
            row = db.get(AutoAudioSessionRecord, session_id)
            if row is None:
                return False
            db.delete(row)
            db.commit()
            return True

    def delete_sessions_batch(self, session_ids: list[str]) -> int:
        if not session_ids:
            return 0
        with self.session_factory() as db:
            result = db.execute(delete(AutoAudioSessionRecord).where(AutoAudioSessionRecord.session_id.in_(session_ids)))
            db.commit()
            return int(result.rowcount or 0)

    def load_completed_stories(self, phase: str) -> set[str]:
        with self.session_factory() as db:
            row = db.get(AutoAudioCompletedStoriesRecord, phase)
            if row is None:
                return set()
            return set(row.story_ids or [])

    def save_completed_stories(self, phase: str, completed: set[str]) -> None:
        with self.session_factory() as db:
            db.merge(AutoAudioCompletedStoriesRecord(
                phase=phase,
                story_ids=sorted(completed),
            ))
            db.commit()

    @staticmethod
    def _load_history_file(path: Path) -> dict[str, dict]:
        if not path.exists():
            return {}
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return {}
        if not isinstance(data, list):
            return {}
        return {
            entry["session_id"]: entry
            for entry in data
            if isinstance(entry, dict) and entry.get("session_id")
        }

    @staticmethod
    def _dict_to_row(data: dict) -> AutoAudioSessionRecord:
        story_results = data.get("story_results", [])
        logs = data.get("logs", [])
        total_stories = data.get("total_stories")
        if total_stories is None:
            total_stories = len(story_results) if isinstance(story_results, list) else 0
        total_chapters = data.get("total_chapters")
        if total_chapters is None:
            if isinstance(story_results, list):
                total_chapters = sum(result.get("chapters_uploaded", 0) for result in story_results if isinstance(result, dict))
            else:
                total_chapters = 0

        return AutoAudioSessionRecord(
            session_id=data.get("session_id", ""),
            created_by_user_id=data.get("created_by_user_id"),
            phase=data.get("phase", ""),
            test_mode=data.get("test_mode", False),
            voice=data.get("voice"),
            status=data.get("status", "idle"),
            current_step=data.get("current_step", 0),
            current_step_desc=data.get("current_step_desc", ""),
            current_story=data.get("current_story", ""),
            started_at=data.get("started_at"),
            finished_at=data.get("finished_at"),
            error=data.get("error", ""),
            total_stories=total_stories or 0,
            total_chapters=total_chapters or 0,
            progress=data.get("progress", {}),
            chapter_progress=data.get("chapter_progress", {}),
            stories_missing_audio=data.get("stories_missing_audio", []),
            story_results=story_results if isinstance(story_results, list) else [],
            logs=logs if isinstance(logs, list) else [],
            full_data=data,
        )

    @staticmethod
    def _row_to_summary(row: AutoAudioSessionRecord) -> dict:
        return {
            "session_id": row.session_id,
            "created_by_user_id": row.created_by_user_id,
            "phase": row.phase,
            "test_mode": row.test_mode,
            "voice": row.voice,
            "status": row.status,
            "current_step": row.current_step,
            "current_step_desc": row.current_step_desc,
            "started_at": row.started_at,
            "finished_at": row.finished_at,
            "error": row.error,
            "total_stories": row.total_stories,
            "total_chapters": row.total_chapters,
        }

    @staticmethod
    def _row_to_full(row: AutoAudioSessionRecord) -> dict:
        data = dict(row.full_data or {})
        data.update({
            "session_id": row.session_id,
            "created_by_user_id": row.created_by_user_id,
            "phase": row.phase,
            "test_mode": row.test_mode,
            "voice": row.voice,
            "status": row.status,
            "current_step": row.current_step,
            "current_step_desc": row.current_step_desc,
            "current_story": row.current_story,
            "progress": row.progress or {},
            "chapter_progress": row.chapter_progress or {},
            "stories_missing_audio": row.stories_missing_audio or [],
            "logs": row.logs or [],
            "started_at": row.started_at,
            "finished_at": row.finished_at,
            "error": row.error,
            "story_results": row.story_results or [],
            "is_paused": data.get("is_paused", False),
        })
        return data
