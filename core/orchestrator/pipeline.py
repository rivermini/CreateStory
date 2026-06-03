"""Story processing pipeline for the AutoAudio service."""

from __future__ import annotations

import tempfile
import time
from pathlib import Path
from typing import Optional

from core.config import _get_settings
from core.models import AutoAudioSession, StoryMissingAudio, StoryResult
from core.orchestrator.batch import BatchPoller
from core.orchestrator.session import SessionManager
from core.services.bedread_client import BedReadClient
from core.services.external_api import ExternalAPIClient
from core.services.upload import UploadManager


class StoryPipeline:
    """Orchestrates the TTS → download → upload pipeline per story."""

    def __init__(
        self,
        api_client: ExternalAPIClient,
        bedread_client: BedReadClient,
        batch_poller: BatchPoller,
        upload_manager: UploadManager,
        session_mgr: SessionManager,
    ) -> None:
        self._api = api_client
        self._br = bedread_client
        self._poller = batch_poller
        self._upload = upload_manager
        self._session_mgr = session_mgr

    def process_story(
        self,
        session: AutoAudioSession,
        story: StoryMissingAudio,
    ) -> StoryResult:
        result = StoryResult(
            story_id=story.story_id,
            story_title=story.story_title,
            chapters_generated=0,
            chapters_uploaded=0,
            upload_errors=[],
        )

        batch_id, voice, err = self._br.start_batch(story, session.voice)
        if not batch_id:
            result.error = err
            session.add_log(4, f"Failed to start batch job: {err}", level="error")
            return result

        session.set_step(5, f"Polling batch job for {story.story_title}", story=story.story_title)
        success, completed_files = self._poller.poll_until_done(session, batch_id)

        if session._stopping:
            result.chapters_generated = len(completed_files)
            session.add_log(
                4,
                f"Stopped mid-poll, {len(completed_files)} chapters already done",
                level="warning",
            )
            return result

        result.chapters_generated = len(completed_files)

        if not success and not completed_files:
            result.error = "Batch job failed or timed out"
            session.add_log(4, f"Batch job for '{story.story_title}' failed", level="error")
            return result

        self.upload_completed_batch(session, story, batch_id, voice, completed_files, result, [story])
        return result

    def upload_completed_batch(
        self,
        session: AutoAudioSession,
        story: StoryMissingAudio,
        batch_id: str,
        voice: Optional[str],
        completed_files: list[dict],
        result: StoryResult,
        all_stories: list[StoryMissingAudio],
    ) -> None:
        session.set_step(
            6,
            f"Downloading {len(completed_files)} audio files from BedReadVoices",
            story=story.story_title,
        )

        chapter_indices = [int(f.get("chapter_index", 0) or 0) for f in completed_files]
        chapter_id_by_index = self._api.build_chapter_id_map(story.story_id, chapter_indices)

        for i, file_info in enumerate(completed_files):
            if session._stopping:
                break

            chapter_index = int(file_info.get("chapter_index", 0) or 0)
            chapter_id = chapter_id_by_index.get(chapter_index, "")

            if not chapter_id:
                session.add_log(
                    6,
                    f"Chapter index {chapter_index}: no chapter ID found in server response — "
                    f"skipping upload",
                    level="error",
                )
                result.upload_errors.append(f"Chapter {chapter_index}: missing chapter ID")
                continue

            session.set_step(
                6,
                f"Downloading chapter {i + 1}/{len(completed_files)} for {story.story_title}",
                story=story.story_title,
            )
            session.add_log(
                6,
                f"Downloading chapter {chapter_index} from BedReadVoices (batch_id={batch_id})",
            )

            local_path = self._br.download_chapter(batch_id, chapter_index)

            if local_path is None or not local_path.exists():
                session.add_log(
                    6,
                    f"Failed to download chapter {chapter_index} from BedReadVoices",
                    level="error",
                )
                result.upload_errors.append(f"Chapter {chapter_index}: download failed")
                continue

            session.add_log(
                6,
                f"Downloaded chapter {chapter_index}: {local_path.stat().st_size} bytes",
            )
            ok = self._upload.upload_audio(
                session, story.story_id, chapter_id, local_path, voice,
            )
            if ok:
                result.chapters_uploaded += 1
                # Update chapter progress after each chapter so the UI reflects real-time progress
                self._update_chapter_progress(session, result, all_stories)
                self._upload.delete_local_audio_files(session, local_path)
            else:
                result.upload_errors.append(f"Chapter {chapter_index}: upload failed")

        session.set_step(
            6,
            f"Uploaded {result.chapters_uploaded}/{len(completed_files)} audio files "
            f"for {story.story_title}",
            story=story.story_title,
        )

        temp_batch_dir = Path(tempfile.gettempdir()) / f"autoaudio_{batch_id}"
        if temp_batch_dir.exists():
            self._upload.delete_batch_output_dir(session, batch_id, temp_batch_dir)

        self._br.delete_batch_output(batch_id)
        session.add_log(9, f"Deleted BedReadVoices batch {batch_id} output directory")

    def run(
        self,
        session: AutoAudioSession,
        stories: list[StoryMissingAudio],
        phase_name: str,
    ) -> None:
        """Process stories one at a time, honoring stop/pause before new batch work starts."""
        if not stories:
            return

        n = len(stories)

        i = 0
        while i < n:
            if not session.wait_while_paused():
                session.add_log(3, "Stop requested while paused, halting pipeline", level="warning")
                session.set_status("stopping")
                break

            if session._stopping:
                session.add_log(3, "Stop requested, halting pipeline", level="warning")
                session.set_status("stopping")
                break

            story = stories[i]
            session.add_log(3, f"[{i+1}/{n}] {story.story_title}")
            session.set_step(3, f"[{i+1}/{n}] {story.story_title}", story=story.story_title)
            session.update_progress(i + 1, n)

            batch_id, voice, err = self._br.start_batch(story, session.voice)
            if not batch_id:
                result = StoryResult(
                    story_id=story.story_id, story_title=story.story_title,
                    chapters_generated=0, chapters_uploaded=0, upload_errors=[], error=err,
                )
                session.add_log(4, f"Failed to start batch job: {err}", level="error")
                self._finalize_story(session, result, story, stories)
                i += 1
                continue

            session.set_step(
                5, f"Polling batch job for {story.story_title}", story=story.story_title,
            )
            success, completed_files = self._poller.poll_until_done(session, batch_id)
            chapters_gen = len(completed_files)

            if session._stopping:
                result = StoryResult(
                    story_id=story.story_id, story_title=story.story_title,
                    chapters_generated=chapters_gen, chapters_uploaded=0, upload_errors=[],
                )
                session.add_log(
                    4,
                    f"Stopped mid-poll, {chapters_gen} chapters already done",
                    level="warning",
                )
                self._finalize_story(session, result, story, stories)
                break

            if not success and not completed_files:
                result = StoryResult(
                    story_id=story.story_id, story_title=story.story_title,
                    chapters_generated=0, chapters_uploaded=0, upload_errors=[],
                    error="Batch job failed or timed out",
                )
                session.add_log(
                    4, f"Batch job for '{story.story_title}' failed", level="error",
                )
                self._finalize_story(session, result, story, stories)
                i += 1
                continue

            result = StoryResult(
                story_id=story.story_id, story_title=story.story_title,
                chapters_generated=chapters_gen, chapters_uploaded=0, upload_errors=[],
            )

            self.upload_completed_batch(session, story, batch_id, voice, completed_files, result, stories)
            self._finalize_story(session, result, story, stories)

            if session._stopping:
                break

            if i + 1 < n and not self._rest_between_stories(session):
                break

            i += 1

    def _rest_between_stories(self, session: AutoAudioSession) -> bool:
        rest_seconds = _get_settings().get("auto_audio_rest_seconds", 30)
        if rest_seconds <= 0:
            return session.wait_while_paused()

        session.set_step(10, f"Resting {rest_seconds}s before next story")
        session.add_log(10, f"Resting {rest_seconds}s before next story")
        remaining = rest_seconds
        while remaining > 0:
            if session._stopping:
                return False
            if session._paused:
                session.set_step(10, "Paused between stories")
                if not session.wait_while_paused():
                    return False
                session.set_step(10, f"Resting {remaining}s before next story")
            time.sleep(1)
            remaining -= 1

        return session.wait_while_paused()

    def _update_chapter_progress(
        self,
        session: AutoAudioSession,
        result: StoryResult,
        all_stories: list[StoryMissingAudio],
    ) -> None:
        total_ch = sum(len(s.missing_chapters) for s in all_stories) if all_stories else 0
        done_ch = sum(r.get("chapters_uploaded", 0) for r in session.story_results) + result.chapters_uploaded
        session.update_chapter_progress(done_ch, total_ch)

    def _finalize_story(
        self,
        session: AutoAudioSession,
        result: StoryResult,
        story: StoryMissingAudio,
        all_stories: list[StoryMissingAudio],
    ) -> None:
        session.add_story_result(result.to_dict())
        if result.chapters_uploaded > 0:
            session.record_completed_story(story.story_id)
            self._session_mgr.save_completed_stories(
                session.phase, session.completed_stories
            )
        session.set_step(7, f"Completed: {story.story_title}", story=story.story_title)
        session.add_log(
            7,
            f"Done: generated={result.chapters_generated}, "
            f"uploaded={result.chapters_uploaded}",
        )
