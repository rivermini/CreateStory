"""Session lifecycle and persistence for the AutoAudio service."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Optional

from core.config import _AUTO_AUDIO_LOGS_DIR_NAME, _OUTPUT_BASE_NAME
from core.models import AutoAudioSession

logger = logging.getLogger(__name__)


class SessionManager:
    """Manages session persistence and history."""

    def __init__(self, logs_dir: Path) -> None:
        self._logs_dir = logs_dir
        self._history_file = logs_dir / "sessions.json"
        self._by_id: dict[str, dict] = {}
        self._history_cache_time: float = 0.0

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
                history = json.load(fh)
            self._by_id = {s.get("session_id", ""): s for s in history}
            self._history_cache_time = Path(__file__).stat().st_mtime
            return history
        except Exception:
            return []

    def get_session(self, session_id: str) -> Optional[dict]:
        if session_id in self._by_id:
            return self._by_id[session_id]
        # Fallback: try loading from the individual session log file (for running sessions not yet persisted)
        log_path = self._logs_dir / f"session_{session_id}.json"
        if log_path.exists():
            try:
                with open(log_path, "r", encoding="utf-8") as fh:
                    return json.load(fh)
            except Exception:
                pass
        # Last resort: scan the full history file
        for session_data in self.load_history():
            if session_data.get("session_id") == session_id:
                return session_data
        return None

    def persist_history(self, session: AutoAudioSession) -> None:
        try:
            history = self.load_history()
            history.insert(0, session.to_dict())
            self._persist_sessions(history[:100])
            self._by_id[session.session_id] = session.to_dict()
        except Exception as exc:
            logger.warning("Failed to persist auto audio session history: %s", exc)

    def delete_session(self, session_id: str) -> bool:
        history = self.load_history()
        original_len = len(history)
        history = [s for s in history if s.get("session_id") != session_id]
        if len(history) == original_len:
            return False
        self._persist_sessions(history)
        self._by_id.pop(session_id, None)
        log_path = self._logs_dir / f"session_{session_id}.json"
        if log_path.exists():
            try:
                log_path.unlink()
            except Exception:
                pass
        return True

    def delete_sessions_batch(self, session_ids: list[str]) -> int:
        if not session_ids:
            return 0
        history = self.load_history()
        id_set = set(session_ids)
        before = len(history)
        history = [s for s in history if s.get("session_id") not in id_set]
        deleted = before - len(history)
        if deleted > 0:
            self._persist_sessions(history)
            for sid in session_ids:
                self._by_id.pop(sid, None)
                log_path = self._logs_dir / f"session_{sid}.json"
                if log_path.exists():
                    try:
                        log_path.unlink()
                    except Exception:
                        pass
        return deleted

    def _persist_sessions(self, sessions: list[dict]) -> None:
        try:
            with open(self._history_file, "w", encoding="utf-8") as fh:
                json.dump(sessions, fh, indent=2)
        except Exception as exc:
            logger.warning("Failed to persist auto audio sessions: %s", exc)
