"""AutoAudio orchestration service — wires all modular components together."""

from __future__ import annotations

import logging
import uuid
from pathlib import Path
from threading import Thread
from typing import Optional

from core.config import (
    _AUTO_AUDIO_LOGS_DIR_NAME,
    _OUTPUT_BASE_NAME,
    _get_external_api_config,
    _get_settings,
)
from core.models import AutoAudioSession, StoryMissingAudio
from core.orchestrator.batch import BatchPoller
from core.orchestrator.pipeline import StoryPipeline
from core.orchestrator.session import SessionManager
from core.services.bedread_client import BedReadClient
from core.services.discovery import StoryDiscovery
from core.services.external_api import ExternalAPIClient
from core.services.upload import UploadManager

logger = logging.getLogger(__name__)


def _init_logs_dir() -> Path:
    _project_root = Path(__file__).parent.parent.resolve()
    output_base = _project_root / _OUTPUT_BASE_NAME
    logs_dir = output_base / _AUTO_AUDIO_LOGS_DIR_NAME
    logs_dir.mkdir(parents=True, exist_ok=True)
    return logs_dir


class AutoAudioService:
    """Orchestrates auto audio generation across all published stories via downstream microservices."""

    def __init__(self) -> None:
        self._active_session: Optional[AutoAudioSession] = None
        self._logs_dir = _init_logs_dir()

        self._api = ExternalAPIClient()
        self._br = BedReadClient()
        self._poller = BatchPoller(self._br)
        self._uploader = UploadManager(self._api)
        self._discovery = StoryDiscovery(self._api)
        self._session_mgr = SessionManager(self._logs_dir)
        self._pipeline = StoryPipeline(
            self._api, self._br, self._poller, self._uploader, self._session_mgr
        )

    def _run_session(self, session: AutoAudioSession) -> None:
        from datetime import datetime
        session.started_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        session.set_status("running")

        try:
            session.set_step(1, "Validating configuration")
            _get_external_api_config()

            def _update_chapter_progress(missing_list: list[StoryMissingAudio]) -> None:
                total = sum(len(s.missing_chapters) for s in missing_list)
                done = sum(r.get("chapters_uploaded", 0) for r in session.story_results)
                session.update_chapter_progress(done, total)

            test_story_ids: list[str] = []
            if session.test_mode:
                test_story_ids = _get_settings().get("auto_audio_test_story_ids", [])
                if not test_story_ids:
                    from core.config import AutoAudioConfigError
                    raise AutoAudioConfigError(
                        "Test Story IDs are not configured. "
                        "Please set them in Settings > Auto Audio Settings."
                    )
                session.add_log(0, f"Test mode: using {len(test_story_ids)} test story IDs")

            needing_update_ids: set[str] = set()
            needing_update_meta: dict[str, dict] = {}

            if session.phase == "phase1":
                if session.test_mode:
                    needing_update_ids = set(test_story_ids)
                    session.add_log(
                        1, f"Test mode: checking {len(needing_update_ids)} test story IDs"
                    )
                    for sid in test_story_ids:
                        meta = self._api.fetch_story_metadata(sid)
                        if meta:
                            needing_update_meta[sid] = meta
                else:
                    session.set_step(1, "Fetching stories needing update")
                    session.add_log(1, "Phase 1: Fetching stories needing update...")
                    needing_update_raw = self._api.fetch_stories_needing_update()
                    needing_update_ids = {
                        str(s.get("storyId") or s.get("story_id") or s.get("id"))
                        for s in needing_update_raw
                        if s.get("storyId") or s.get("story_id") or s.get("id")
                    }
                    needing_update_meta = {
                        str(s.get("storyId") or s.get("story_id") or s.get("id")): s
                        for s in needing_update_raw
                    }
                session.add_log(1, f"Found {len(needing_update_ids)} stories needing update")

                if not needing_update_ids:
                    session.add_log(1, "No stories needing update found", level="info")
                    session.set_status("completed")
                    session.add_log(11, "Auto audio session completed (no stories to process)")
                    session.set_step(11, "Auto audio session completed successfully")
                    session.current_story = ""
                    self._session_mgr.save_session_log(session)
                    self._session_mgr.persist_history(session)
                    return

                session.set_step(1, "Discovering missing audio in stories needing update")
                phase1_missing = self._discovery.discover(
                    session, list(needing_update_ids), needing_update_meta
                )
                session.add_log(
                    1, f"Phase 1: {len(phase1_missing)} stories with missing audio"
                )

                if not phase1_missing:
                    session.add_log(1, "No stories with missing audio found", level="info")
                    session.set_status("completed")
                    session.add_log(11, "Auto audio session completed successfully")
                    session.set_step(11, "Auto audio session completed successfully")
                    session.current_story = ""
                    self._session_mgr.save_session_log(session)
                    self._session_mgr.persist_history(session)
                    return

                session.set_stories_preview([
                    {"storyId": s.story_id, "title": s.story_title,
                     "missingCount": len(s.missing_chapters),
                     "existingVoice": s.existing_voice}
                    for s in phase1_missing
                ])
                _update_chapter_progress(phase1_missing)

                phase1_missing = self._session_mgr.skip_completed_stories(session, phase1_missing)
                if not phase1_missing:
                    session.add_log(3, "All phase 1 stories already processed — nothing to do")
                    session.set_status("completed")
                    session.add_log(11, "Auto audio session completed successfully")
                    session.set_step(11, "Auto audio session completed successfully")
                    session.current_story = ""
                    self._session_mgr.save_session_log(session)
                    self._session_mgr.persist_history(session)
                    return

                session.set_step(3, "Processing stories needing update")
                session.update_progress(0, len(phase1_missing))
                self._run_story_pipeline(session, phase1_missing)

            elif session.phase == "phase2":
                phase_limit = session.limit
                session.set_step(1, f"Fetching {phase_limit} most recently updated stories")
                session.add_log(
                    1,
                    f"Phase 2: Fetching {phase_limit} most recently updated stories...",
                )
                recent_stories = self._api.fetch_recent_stories(limit=phase_limit)
                recent_story_ids = [
                    str(s.get("storyId") or s.get("story_id") or s.get("id"))
                    for s in recent_stories
                    if (s.get("storyId") or s.get("story_id") or s.get("id"))
                ]
                session.add_log(1, f"Found {len(recent_story_ids)} recently updated stories")

                if not recent_story_ids:
                    session.add_log(1, "No recently updated stories found", level="info")
                    session.set_status("completed")
                    session.add_log(11, "Auto audio session completed (no stories to process)")
                    session.set_step(11, "Auto audio session completed successfully")
                    session.current_story = ""
                    self._session_mgr.save_session_log(session)
                    self._session_mgr.persist_history(session)
                    return

                phase2_meta = {
                    str(s.get("storyId") or s.get("story_id") or s.get("id")): s
                    for s in recent_stories
                }
                session.set_step(1, "Discovering stories with missing audio")
                phase2_missing = self._discovery.discover(
                    session, recent_story_ids, phase2_meta
                )
                session.add_log(
                    1, f"Phase 2: {len(phase2_missing)} stories with missing audio"
                )

                if not phase2_missing:
                    session.add_log(1, "No stories with missing audio found", level="info")
                    session.set_status("completed")
                    session.add_log(11, "Auto audio session completed successfully")
                    session.set_step(11, "Auto audio session completed successfully")
                    session.current_story = ""
                    self._session_mgr.save_session_log(session)
                    self._session_mgr.persist_history(session)
                    return

                session.set_stories_preview([
                    {"storyId": s.story_id, "title": s.story_title,
                     "missingCount": len(s.missing_chapters),
                     "existingVoice": s.existing_voice}
                    for s in phase2_missing
                ])
                _update_chapter_progress(phase2_missing)

                phase2_missing = self._session_mgr.skip_completed_stories(session, phase2_missing)
                if not phase2_missing:
                    session.add_log(3, "All phase 2 stories already processed — nothing to do")
                    session.set_status("completed")
                    session.add_log(11, "Auto audio session completed successfully")
                    session.set_step(11, "Auto audio session completed successfully")
                    session.current_story = ""
                    self._session_mgr.save_session_log(session)
                    self._session_mgr.persist_history(session)
                    return

                session.set_step(3, "Processing recently updated stories with missing audio")
                session.update_progress(0, len(phase2_missing))
                self._run_story_pipeline(session, phase2_missing)

            elif session.phase == "phase3":
                if not test_story_ids:
                    from core.config import AutoAudioConfigError
                    raise AutoAudioConfigError(
                        "Test Story IDs are not configured. "
                        "Please set them in Settings > Auto Audio Settings."
                    )
                session.add_log(0, f"Phase 3: using {len(test_story_ids)} test story IDs")
                session.set_step(1, "Fetching test story metadata")
                phase3_meta: dict[str, dict] = {}
                for sid in test_story_ids:
                    meta = self._api.fetch_story_metadata(sid)
                    if meta:
                        phase3_meta[sid] = meta
                phase3_ids = list(test_story_ids)
                session.add_log(1, f"Found {len(phase3_ids)} test story IDs")

                if not phase3_ids:
                    session.add_log(1, "No test stories found", level="info")
                    session.set_status("completed")
                    session.add_log(11, "Auto audio session completed (no stories to process)")
                    session.set_step(11, "Auto audio session completed successfully")
                    session.current_story = ""
                    self._session_mgr.save_session_log(session)
                    self._session_mgr.persist_history(session)
                    return

                session.set_step(1, "Discovering test stories with missing audio")
                phase3_missing = self._discovery.discover(
                    session, phase3_ids, phase3_meta
                )
                session.add_log(
                    1, f"Phase 3: {len(phase3_missing)} test stories with missing audio"
                )

                if not phase3_missing:
                    session.add_log(1, "No test stories with missing audio found", level="info")
                    session.set_status("completed")
                    session.add_log(11, "Auto audio session completed successfully")
                    session.set_step(11, "Auto audio session completed successfully")
                    session.current_story = ""
                    self._session_mgr.save_session_log(session)
                    self._session_mgr.persist_history(session)
                    return

                session.set_stories_preview([
                    {"storyId": s.story_id, "title": s.story_title,
                     "missingCount": len(s.missing_chapters),
                     "existingVoice": s.existing_voice}
                    for s in phase3_missing
                ])
                _update_chapter_progress(phase3_missing)

                phase3_missing = self._session_mgr.skip_completed_stories(session, phase3_missing)
                if not phase3_missing:
                    session.add_log(3, "All phase 3 test stories already processed — nothing to do")
                    session.set_status("completed")
                    session.add_log(11, "Auto audio session completed successfully")
                    session.set_step(11, "Auto audio session completed successfully")
                    session.current_story = ""
                    self._session_mgr.save_session_log(session)
                    self._session_mgr.persist_history(session)
                    return

                session.set_step(3, "Processing test stories with missing audio")
                session.update_progress(0, len(phase3_missing))
                self._run_story_pipeline(session, phase3_missing)

            if session._stopping:
                session.set_status("stopped")
                session.add_log(11, "Auto audio session stopped by user")
                session.set_step(11, "Auto audio session stopped")
            else:
                session.set_status("completed")
                session.add_log(11, "Auto audio session completed successfully")
                session.set_step(11, "Auto audio session completed successfully")

            session.current_story = ""
            self._session_mgr.save_session_log(session)
            self._session_mgr.persist_history(session)

            self._active_session = None

        except Exception as exc:
            logger.exception("Auto audio session error")
            session.set_status("error", error=str(exc))
            session.add_log(0, f"Fatal error: {exc}", level="error")
            session.current_story = ""
            self._session_mgr.save_session_log(session)
            self._session_mgr.persist_history(session)
            self._active_session = None

    def _run_story_pipeline(
        self,
        session: AutoAudioSession,
        stories: list[StoryMissingAudio],
    ) -> None:
        self._pipeline.run(session, stories, session.phase)

    def start_session(
        self,
        phase: str,
        test_mode: bool,
        voice: Optional[str],
        limit: int = 20,
    ) -> str:
        if self._active_session is not None:
            existing = self._active_session
            if existing.status in ("running", "paused", "stopping"):
                raise RuntimeError("A session is already running. Stop it first.")

        session_id = str(uuid.uuid4())[:8]
        session = AutoAudioSession(
            session_id=session_id,
            phase=phase,
            test_mode=test_mode,
            voice=voice,
            status="idle",
            current_step=0,
            current_step_desc="Initializing",
            current_story="",
            progress={"done": 0, "total": 0},
            chapter_progress={"done": 0, "total": 0},
            stories_missing_audio=[],
            logs=[],
            started_at=None,
            finished_at=None,
            error="",
            limit=limit,
        )

        self._active_session = session
        thread = Thread(target=self._run_session, args=(session,), daemon=True)
        thread.start()

        session.add_log(
            0,
            f"Session {session_id} started "
            f"(phase={phase}, test_mode={test_mode}, "
            f"voice={'random' if voice is None else voice})",
        )
        session.set_status("running")
        return session_id

    def get_status(self) -> Optional[dict]:
        if self._active_session is not None:
            return self._active_session.to_dict()
        # No active session — return the most recent completed session from history
        latest = self._session_mgr.get_latest_session()
        return latest

    def stop_session(self) -> bool:
        if self._active_session is None:
            return False
        session = self._active_session
        if session.status in ("completed", "error", "stopped"):
            return False
        session.add_log(0, "Stop requested")
        session.request_stop()
        return True

    def pause_session(self) -> dict:
        if self._active_session is None:
            raise RuntimeError("No active session to pause.")
        session = self._active_session
        if session.status in ("completed", "error", "stopped", "stopping"):
            raise RuntimeError(f"Cannot pause session with status '{session.status}'.")

        was_paused = session.pause()
        if was_paused:
            session.add_log(0, "Pause requested")
        return {"is_paused": True, "status": session.status}

    def resume_session(self) -> dict:
        if self._active_session is None:
            raise RuntimeError("No active session to resume.")
        session = self._active_session
        if session.status != "paused":
            raise RuntimeError(f"Cannot resume session with status '{session.status}'.")

        resumed = session.resume()
        if resumed:
            session.add_log(0, "Resume requested")
        return {"is_paused": False, "status": session.status}

    def get_history(self) -> list[dict]:
        return self._session_mgr.load_history()

    def get_session(self, session_id: str) -> Optional[dict]:
        # Check in-memory active session first (avoids file I/O)
        active = self._active_session
        if active and active.session_id == session_id:
            return active.to_dict()
        return self._session_mgr.get_session(session_id)

    def delete_session(self, session_id: str) -> bool:
        return self._session_mgr.delete_session(session_id)

    def delete_sessions_batch(self, session_ids: list[str]) -> int:
        return self._session_mgr.delete_sessions_batch(session_ids)


_auto_audio_service: Optional[AutoAudioService] = None


def get_auto_audio_service() -> AutoAudioService:
    global _auto_audio_service
    if _auto_audio_service is None:
        _auto_audio_service = AutoAudioService()
    return _auto_audio_service
