"""Story processing pipeline for the AutoAudio service."""

from __future__ import annotations

from concurrent.futures import Future, ThreadPoolExecutor, as_completed
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
    """Orchestrates the TTS, download, compression, and upload pipeline."""

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

        batch_info = self._start_story_batch(story, session.voice)
        batch_id = batch_info.get("batch_id")
        voice = batch_info.get("voice")
        err = batch_info.get("error", "")
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
        chapter_id_by_index = {
            int(ch.chapter_index): ch.chapter_id
            for ch in story.missing_chapters
            if ch.chapter_id
        }
        missing_indices = [
            idx for idx in chapter_indices
            if idx and not chapter_id_by_index.get(idx)
        ]
        if missing_indices:
            chapter_id_by_index.update(
                self._api.build_chapter_id_map(story.story_id, missing_indices)
            )

        upload_workers = self._upload_worker_count(len(completed_files))
        if upload_workers <= 1 or len(completed_files) <= 1:
            for i, file_info in enumerate(completed_files):
                if session._stopping:
                    break
                ok, message = self._download_and_upload_chapter(
                    session,
                    story,
                    batch_id,
                    voice,
                    file_info,
                    chapter_id_by_index,
                    i,
                    len(completed_files),
                )
                if ok:
                    result.chapters_uploaded += 1
                    self._update_chapter_progress(session, result, all_stories)
                else:
                    result.upload_errors.append(message)
        else:
            session.add_log(6, f"Uploading with {upload_workers} parallel chapter worker(s)")
            with ThreadPoolExecutor(max_workers=upload_workers) as executor:
                futures = [
                    executor.submit(
                        self._download_and_upload_chapter,
                        session,
                        story,
                        batch_id,
                        voice,
                        file_info,
                        chapter_id_by_index,
                        i,
                        len(completed_files),
                    )
                    for i, file_info in enumerate(completed_files)
                ]
                for future in as_completed(futures):
                    if session._stopping:
                        for pending in futures:
                            pending.cancel()
                        break
                    try:
                        ok, message = future.result()
                    except Exception as exc:
                        ok, message = False, f"Upload worker error: {exc}"
                    if ok:
                        result.chapters_uploaded += 1
                        self._update_chapter_progress(session, result, all_stories)
                    else:
                        result.upload_errors.append(message)

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
        """Process stories with one-story lookahead."""
        if not stories:
            return

        n = len(stories)
        pending_next: Future[dict] | None = None
        pending_story_index: int | None = None

        starter = ThreadPoolExecutor(max_workers=1)
        try:
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
                session.add_log(3, f"[{i + 1}/{n}] {story.story_title}")
                session.set_step(3, f"[{i + 1}/{n}] {story.story_title}", story=story.story_title)
                session.update_progress(i + 1, n)

                if pending_next is not None and pending_story_index == i:
                    try:
                        batch_info = pending_next.result()
                    except Exception as exc:
                        batch_info = {
                            "story": story,
                            "batch_id": None,
                            "voice": None,
                            "error": str(exc),
                        }
                    pending_next = None
                    pending_story_index = None
                    if batch_info.get("batch_id"):
                        session.add_log(
                            3,
                            f"[{i + 1}/{n}] {story.story_title} batch was already started",
                        )
                else:
                    batch_info = self._start_story_batch(story, session.voice)

                batch_id = batch_info.get("batch_id")
                voice = batch_info.get("voice")
                err = batch_info.get("error", "")
                if not batch_id:
                    result = StoryResult(
                        story_id=story.story_id,
                        story_title=story.story_title,
                        chapters_generated=0,
                        chapters_uploaded=0,
                        upload_errors=[],
                        error=err,
                    )
                    session.add_log(4, f"Failed to start batch job: {err}", level="error")
                    self._finalize_story(session, result, story, stories)
                    if i + 1 < n and not self._rest_between_stories(session, result):
                        break
                    i += 1
                    continue

                session.set_step(
                    5, f"Polling batch job for {story.story_title}", story=story.story_title,
                )
                success, completed_files = self._poller.poll_until_done(session, batch_id)
                chapters_gen = len(completed_files)

                if session._stopping:
                    result = StoryResult(
                        story_id=story.story_id,
                        story_title=story.story_title,
                        chapters_generated=chapters_gen,
                        chapters_uploaded=0,
                        upload_errors=[],
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
                        story_id=story.story_id,
                        story_title=story.story_title,
                        chapters_generated=0,
                        chapters_uploaded=0,
                        upload_errors=[],
                        error="Batch job failed or timed out",
                    )
                    session.add_log(
                        4, f"Batch job for '{story.story_title}' failed", level="error",
                    )
                    self._finalize_story(session, result, story, stories)
                    if i + 1 < n and not self._rest_between_stories(session, result):
                        break
                    i += 1
                    continue

                result = StoryResult(
                    story_id=story.story_id,
                    story_title=story.story_title,
                    chapters_generated=chapters_gen,
                    chapters_uploaded=0,
                    upload_errors=[],
                )

                if (
                    i + 1 < n
                    and pending_next is None
                    and not session._stopping
                    and not session._paused
                ):
                    next_story = stories[i + 1]
                    pending_story_index = i + 1
                    pending_next = starter.submit(
                        self._start_story_batch,
                        next_story,
                        session.voice,
                    )
                    session.add_log(
                        3,
                        f"Started next story batch in background: {next_story.story_title}",
                    )

                self.upload_completed_batch(
                    session, story, batch_id, voice, completed_files, result, stories,
                )
                self._finalize_story(session, result, story, stories)

                if session._stopping:
                    if pending_next is not None:
                        self._cancel_pending_batch(pending_next)
                    break

                if result.error or result.upload_errors:
                    if i + 1 < n and not self._rest_between_stories(session, result):
                        break

                i += 1

            if session._stopping and pending_next is not None:
                self._cancel_pending_batch(pending_next)
        finally:
            starter.shutdown(wait=not session._stopping, cancel_futures=session._stopping)

    def _download_and_upload_chapter(
        self,
        session: AutoAudioSession,
        story: StoryMissingAudio,
        batch_id: str,
        voice: Optional[str],
        file_info: dict,
        chapter_id_by_index: dict[int, str],
        position: int,
        total: int,
    ) -> tuple[bool, str]:
        if session._stopping:
            return False, "Stop requested"

        chapter_index = int(file_info.get("chapter_index", 0) or 0)
        chapter_id = (
            str(file_info.get("chapter_id") or "")
            or chapter_id_by_index.get(chapter_index, "")
        )

        if not chapter_id:
            session.add_log(
                6,
                f"Chapter index {chapter_index}: no chapter ID found in server response, skipping upload",
                level="error",
            )
            return False, f"Chapter {chapter_index}: missing chapter ID"

        session.set_step(
            6,
            f"Downloading chapter {position + 1}/{total} for {story.story_title}",
            story=story.story_title,
        )
        session.add_log(
            6,
            f"Downloading chapter {chapter_index} from BedReadVoices (batch_id={batch_id})",
        )

        local_path = self._br.download_chapter(
            batch_id,
            chapter_index,
            file_info.get("filename") or None,
        )

        if local_path is None or not local_path.exists():
            session.add_log(
                6,
                f"Failed to download chapter {chapter_index} from BedReadVoices",
                level="error",
            )
            return False, f"Chapter {chapter_index}: download failed"

        session.add_log(
            6,
            f"Downloaded chapter {chapter_index}: {local_path.stat().st_size} bytes",
        )
        ok = self._upload.upload_audio(
            session, story.story_id, chapter_id, local_path, voice,
        )
        if ok:
            self._upload.delete_local_audio_files(session, local_path)
            return True, ""
        return False, f"Chapter {chapter_index}: upload failed"

    def _start_story_batch(
        self,
        story: StoryMissingAudio,
        voice: Optional[str],
    ) -> dict:
        batch_id, chosen_voice, err = self._br.start_batch(story, voice)
        return {
            "story": story,
            "batch_id": batch_id,
            "voice": chosen_voice,
            "error": err,
        }

    def _cancel_pending_batch(self, pending_next: Future[dict]) -> None:
        try:
            if pending_next.cancel():
                return
            batch_info = pending_next.result(timeout=0)
            batch_id = batch_info.get("batch_id")
            if batch_id:
                self._br.delete_batch_job(batch_id)
        except Exception:
            pass

    def _upload_worker_count(self, file_count: int) -> int:
        if file_count <= 1:
            return 1
        raw = _get_settings().get("auto_audio_upload_workers", 3)
        try:
            workers = int(raw)
        except Exception:
            workers = 3
        return max(1, min(4, workers, file_count))

    def _rest_between_stories(
        self,
        session: AutoAudioSession,
        result: Optional[StoryResult] = None,
    ) -> bool:
        rest_seconds = _get_settings().get("auto_audio_rest_seconds", 0)
        if rest_seconds <= 0:
            return session.wait_while_paused()

        if result and not result.error and not result.upload_errors:
            return session.wait_while_paused()

        session.set_step(10, f"Backing off {rest_seconds}s before next story")
        session.add_log(10, f"Backing off {rest_seconds}s before next story")
        remaining = rest_seconds
        while remaining > 0:
            if not session.wait_while_paused():
                return False
            if session._stopping:
                return False
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
        expected_uploads = len(story.missing_chapters)
        story_complete = (
            expected_uploads > 0
            and result.chapters_uploaded >= expected_uploads
            and not result.upload_errors
            and not result.error
        )
        if story_complete:
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
