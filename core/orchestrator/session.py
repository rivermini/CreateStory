"""Session lifecycle and persistence for the AutoAudio service."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Optional

from core.db import init_db
from core.models import AutoAudioSession
from core.repositories import AutoAudioRepository

logger = logging.getLogger(__name__)


class SessionManager:
    """Manages session persistence and history."""

    def __init__(self, logs_dir: Path) -> None:
        self._logs_dir = logs_dir
        self._logs_dir.mkdir(parents=True, exist_ok=True)
        self._history_file = logs_dir / "sessions.json"
        self._by_id: dict[str, dict] = {}
        self._history_cache_time: float = 0.0
        init_db()
        self._repo = AutoAudioRepository()
        self._repo.import_existing_logs(logs_dir)

    def get_completed_stories_path(self, phase: str) -> Path:
        return self._logs_dir / f"completed_stories_{phase}.json"

    def load_completed_stories(self, phase: str) -> set[str]:
        try:
            return self._repo.load_completed_stories(phase)
        except Exception as exc:
            logger.warning("Failed to load completed stories for phase %s: %s", phase, exc)
            return set()

    def save_completed_stories(self, phase: str, completed: set[str]) -> None:
        try:
            self._repo.save_completed_stories(phase, completed)
        except Exception as exc:
            logger.warning("Failed to save completed stories for phase %s: %s", phase, exc)

    def skip_completed_stories(
        self,
        session: AutoAudioSession,
        stories: list,
    ) -> list:
        if session.phase not in ("phase1", "phase2"):
            return stories
        completed = self.load_completed_stories(session.phase)
        if not completed:
            return stories

        skipped = [s for s in stories if s.story_id in completed]
        remaining = [s for s in stories if s.story_id not in completed]
        if skipped:
            session.add_log(
                3,
                f"Skipping {len(skipped)} already-processed story(ies) "
                f"(found {len(remaining)} remaining)",
            )
        return remaining

    def save_session_log(self, session: AutoAudioSession) -> None:
        try:
            self._by_id[session.session_id] = session.to_summary_dict()
            self._repo.save_session(session.to_dict())
        except Exception as exc:
            logger.warning("Failed to save session log: %s", exc)

    def load_history(self) -> list[dict]:
        try:
            history = self._repo.load_history()
            self._by_id = {s.get("session_id", ""): s for s in history}
            self._history_cache_time = Path(__file__).stat().st_mtime
            return history
        except Exception as exc:
            logger.warning("Failed to load auto audio session history: %s", exc)
            return []

    def get_session(self, session_id: str) -> Optional[dict]:
        try:
            data = self._repo.get_session(session_id)
            if data is not None:
                return data
        except Exception as exc:
            logger.warning("Failed to load auto audio session %s: %s", session_id, exc)

        if session_id in self._by_id:
            return self._by_id[session_id]
        for session_data in self.load_history():
            if session_data.get("session_id") == session_id:
                return session_data
        return None

    def get_latest_session(self) -> Optional[dict]:
        """Return the most recent completed session, or None if history is empty."""
        history = self.load_history()
        if history:
            return history[0]
        return None

    def persist_history(self, session: AutoAudioSession) -> None:
        try:
            self._by_id[session.session_id] = session.to_summary_dict()
            if len(self._by_id) > 100:
                ordered_ids = list(self._by_id.keys())
                for old_id in ordered_ids[:-100]:
                    self._by_id.pop(old_id, None)
                    self._repo.delete_session(old_id)
            self._repo.save_session(session.to_dict())
        except Exception as exc:
            logger.warning("Failed to persist auto audio session history: %s", exc)

    def delete_session(self, session_id: str) -> bool:
        self._by_id.pop(session_id, None)
        return self._repo.delete_session(session_id)

    def delete_sessions_batch(self, session_ids: list[str]) -> int:
        if not session_ids:
            return 0
        for sid in session_ids:
            self._by_id.pop(sid, None)
        return self._repo.delete_sessions_batch(session_ids)

    def _persist_sessions(self, sessions: list[dict]) -> None:
        try:
            self._repo.save_sessions(sessions)
        except Exception as exc:
            logger.warning("Failed to persist auto audio sessions: %s", exc)
