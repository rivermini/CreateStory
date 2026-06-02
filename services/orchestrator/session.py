"""Session lifecycle and persistence for the auto-audio service."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Optional

from .config import _AUTO_AUDIO_LOGS_DIR_NAME, _OUTPUT_BASE_NAME
from .models import AutoAudioSession

logger = logging.getLogger(__name__)


class SessionManager:
    """Manages session persistence and history."""

    def __init__(self, logs_dir: Path) -> None:
        self._logs_dir = logs_dir
        self._history_file = logs_dir / "sessions.json"

    def get_completed_stories_path(self, phase: str) -> Path:
        return self._logs_dir / f"completed_stories_{phase}.json"

    def load_completed_stories(self, phase: str) -> set[str]:
        path = self.get_completed_stories_path(phase)
        if not path.exists():
            return set()
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            return set(data.get("story_ids", []))
        except Exception:
            return set()

    def save_completed_stories(self, phase: str, completed: set[str]) -> None:
        path = self.get_completed_stories_path(phase)
        try:
            path.write_text(
                json.dumps({"story_ids": sorted(completed)}, indent=2),
                encoding="utf-8",
            )
        except Exception as exc:
            logger.warning("Failed to save completed stories for phase %s: %s", phase, exc)

    def skip_completed_stories(
        self,
        session: AutoAudioSession,
        stories: list,
    ) -> list:
        if session.phase not in ("phase1", "phase2", "phase3"):
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
            log_path = self._logs_dir / f"session_{session.session_id}.json"
            with open(log_path, "w", encoding="utf-8") as fh:
                json.dump(session.to_dict(), fh, indent=2)
        except Exception as exc:
            logger.warning("Failed to save session log: %s", exc)

    def load_history(self) -> list[dict]:
        if not self._history_file.exists():
            return []
        try:
            with open(self._history_file, "r", encoding="utf-8") as fh:
                return json.load(fh)
        except Exception:
            return []

    def persist_history(self, session: AutoAudioSession) -> None:
        try:
            history = self.load_history()
            history.insert(0, session.to_dict())
            self._persist_sessions(history[:100])
        except Exception as exc:
            logger.warning("Failed to persist auto audio session history: %s", exc)

    def delete_session(self, session_id: str) -> bool:
        """Remove a session from history. Returns True if deleted, False if not found."""
        history = self.load_history()
        original_len = len(history)
        history = [s for s in history if s.get("session_id") != session_id]
        if len(history) == original_len:
            return False
        self._persist_sessions(history)
        log_path = self._logs_dir / f"session_{session_id}.json"
        if log_path.exists():
            try:
                log_path.unlink()
            except Exception:
                pass
        return True

    def _persist_sessions(self, sessions: list[dict]) -> None:
        try:
            with open(self._history_file, "w", encoding="utf-8") as fh:
                json.dump(sessions, fh, indent=2)
        except Exception as exc:
            logger.warning("Failed to persist auto audio sessions: %s", exc)
