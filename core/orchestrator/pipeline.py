"""Story processing pipeline for the AutoAudio service."""

from __future__ import annotations

from concurrent.futures import Future, ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
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


@dataclass
class BatchState:
    index: int
    story: StoryMissingAudio
    batch_id: str
    voice: Optional[str]
    result: StoryResult
    chapter_id_by_index: dict[int, str]
    upload_futures: list[Future[tuple[bool, str]]] = field(default_factory=list)
    completed_files: list[dict] = field(default_factory=list)
    queued_upload_indices: set[int] = field(default_factory=set)


class StoryPipeline:
    """Orchestrates story batch generation and incremental chapter uploads."""

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
        batch_info = self._start_story_batch(story, session.voice)
        batch_id = batch_info.get("batch_id")
        voice = batch_info.get("voice")
        err = batch_info.get("error", "")
        result = StoryResult(
            story_id=story.story_id,
            story_title=story.story_title,
            chapters_expected=len(story.missing_chapters),
            chapters_generated=0,
            chapters_uploaded=0,
            upload_errors=[],
            error=err if not batch_id else "",
        )
        if not batch_id:
            session.add_log(4, f"Failed to start batch job: {err}", level="error")
            return result

        upload_workers = self._upload_worker_count(len(story.missing_chapters))
        with ThreadPoolExecutor(max_workers=upload_workers) as upload_pool:
            state = self._make_batch_state(0, story, batch_id, voice)
            self._poll_and_upload_story(session, state, [story], upload_pool)
        return state.result

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
        upload_workers = self._upload_worker_count(len(completed_files))
        state = BatchState(
            index=0,
            story=story,
            batch_id=batch_id,
            voice=voice,
            result=result,
            chapter_id_by_index=self._chapter_id_map_for_story(story),
            completed_files=list(completed_files),
        )
        with ThreadPoolExecutor(max_workers=upload_workers) as upload_pool:
            self._queue_completed_uploads(session, state, completed_files, all_stories, upload_pool)
            self._drain_uploads(session, state, all_stories)
        self._finish_batch_upload(session, state)

    def run(
        self,
        session: AutoAudioSession,
        stories: list[StoryMissingAudio],
        phase_name: str,
    ) -> None:
        """Process stories with a small in-flight batch window."""
        if not stories:
            return

        n = len(stories)
        upload_workers = self._upload_worker_count(
            max((len(s.missing_chapters) for s in stories), default=1)
        )
        batch_window = self._batch_window_size()
        in_flight: dict[int, BatchState] = {}
        next_to_start = 0
        next_to_poll = 0

        with ThreadPoolExecutor(max_workers=upload_workers) as upload_pool:
            while next_to_poll < n:
                if not self._ensure_not_stopped_or_paused(session):
                    break

                while (
                    len(in_flight) < batch_window
                    and next_to_start < n
                    and not session._stopping
                    and not session._paused
                ):
                    state = self._start_state_for_story(
                        session,
                        stories[next_to_start],
                        next_to_start,
                        n,
                    )
                    if state is not None:
                        in_flight[next_to_start] = state
                    next_to_start += 1

                state = in_flight.pop(next_to_poll, None)
                if state is None:
                    next_to_poll += 1
                    continue

                session.update_progress(state.index + 1, n)
                if state.index > 0:
                    session.set_step(
                        3,
                        f"[{state.index + 1}/{n}] {state.story.story_title}",
                        story=state.story.story_title,
                    )
                    session.add_log(
                        3,
                        f"[{state.index + 1}/{n}] {state.story.story_title} batch was already started",
                    )

                if state.batch_id:
                    self._poll_and_upload_story(session, state, stories, upload_pool)
                self._finalize_story(session, state.result, state.story, stories)

                if session._stopping:
                    self._cancel_in_flight_batches(in_flight.values())
                    break

                if state.result.error or state.result.upload_errors:
                    if state.index + 1 < n and not self._rest_between_stories(session, state.result):
                        self._cancel_in_flight_batches(in_flight.values())
                        break

                next_to_poll += 1

    def _start_state_for_story(
        self,
        session: AutoAudioSession,
        story: StoryMissingAudio,
        index: int,
        total: int,
    ) -> Optional[BatchState]:
        if index == 0:
            session.set_step(3, f"[{index + 1}/{total}] {story.story_title}", story=story.story_title)
            session.add_log(3, f"[{index + 1}/{total}] {story.story_title}")
        else:
            session.add_log(
                3,
                f"Started next story batch in background ({index + 1}/{total}): {story.story_title}",
            )

        batch_info = self._start_story_batch(story, session.voice)
        batch_id = batch_info.get("batch_id")
        voice = batch_info.get("voice")
        err = batch_info.get("error", "")
        if not batch_id:
            result = StoryResult(
                story_id=story.story_id,
                story_title=story.story_title,
                chapters_expected=len(story.missing_chapters),
                chapters_generated=0,
                chapters_uploaded=0,
                upload_errors=[],
                error=err,
            )
            session.add_log(4, f"Failed to start batch job: {err}", level="error")
            return BatchState(
                index=index,
                story=story,
                batch_id="",
                voice=voice,
                result=result,
                chapter_id_by_index=self._chapter_id_map_for_story(story),
            )

        return self._make_batch_state(index, story, batch_id, voice)

    def _make_batch_state(
        self,
        index: int,
        story: StoryMissingAudio,
        batch_id: str,
        voice: Optional[str],
    ) -> BatchState:
        return BatchState(
            index=index,
            story=story,
            batch_id=batch_id,
            voice=voice,
            result=StoryResult(
                story_id=story.story_id,
                story_title=story.story_title,
                chapters_expected=len(story.missing_chapters),
                chapters_generated=0,
                chapters_uploaded=0,
                upload_errors=[],
            ),
            chapter_id_by_index=self._chapter_id_map_for_story(story),
        )

    def _poll_and_upload_story(
        self,
        session: AutoAudioSession,
        state: BatchState,
        all_stories: list[StoryMissingAudio],
        upload_pool: ThreadPoolExecutor,
    ) -> None:
        session.set_step(
            5,
            f"Polling batch job for {state.story.story_title}",
            story=state.story.story_title,
        )

        def _on_completed(files: list[dict]) -> None:
            self._queue_completed_uploads(session, state, files, all_stories, upload_pool)

        def _on_poll_tick() -> None:
            self._drain_finished_uploads(session, state, all_stories)

        success, completed_files = self._poller.poll_until_done(
            session,
            state.batch_id,
            on_completed_files=_on_completed,
            on_poll_tick=_on_poll_tick,
        )
        state.completed_files = completed_files
        state.result.chapters_generated = len(completed_files)

        self._drain_uploads(session, state, all_stories)

        if session._stopping:
            session.add_log(
                4,
                f"Stopped mid-poll, {len(completed_files)} chapters already done",
                level="warning",
            )
            return

        if not success:
            state.result.error = "Batch job failed or timed out"
            session.add_log(
                4,
                f"Batch job for '{state.story.story_title}' failed or timed out "
                f"({state.result.chapters_uploaded}/{len(state.story.missing_chapters)} uploaded)",
                level="error",
            )

        self._finish_batch_upload(session, state)

    def _queue_completed_uploads(
        self,
        session: AutoAudioSession,
        state: BatchState,
        completed_files: list[dict],
        all_stories: list[StoryMissingAudio],
        upload_pool: ThreadPoolExecutor,
    ) -> None:
        if not completed_files:
            return

        missing_indices = [
            int(f.get("chapter_index", 0) or 0)
            for f in completed_files
            if int(f.get("chapter_index", 0) or 0)
            and not (
                str(f.get("chapter_id") or "")
                or state.chapter_id_by_index.get(int(f.get("chapter_index", 0) or 0), "")
            )
        ]
        if missing_indices:
            state.chapter_id_by_index.update(
                self._api.build_chapter_id_map(state.story.story_id, missing_indices)
            )

        for file_info in completed_files:
            chapter_index = int(file_info.get("chapter_index", 0) or 0)
            if not chapter_index or chapter_index in state.queued_upload_indices:
                continue
            state.queued_upload_indices.add(chapter_index)
            position = len(state.queued_upload_indices) - 1
            future = upload_pool.submit(
                self._download_and_upload_chapter,
                session,
                state.story,
                state.batch_id,
                state.voice,
                file_info,
                state.chapter_id_by_index,
                position,
                len(state.story.missing_chapters),
            )
            state.upload_futures.append(future)

    def _drain_uploads(
        self,
        session: AutoAudioSession,
        state: BatchState,
        all_stories: list[StoryMissingAudio],
    ) -> None:
        if not state.upload_futures:
            return

        for future in as_completed(state.upload_futures):
            if session._stopping:
                for pending in state.upload_futures:
                    pending.cancel()
                break
            try:
                ok, message = future.result()
            except Exception as exc:
                ok, message = False, f"Upload worker error: {exc}"
            if ok:
                state.result.chapters_uploaded += 1
                self._update_chapter_progress(session, state.result, all_stories)
            else:
                state.result.upload_errors.append(message)
        state.upload_futures.clear()

    def _drain_finished_uploads(
        self,
        session: AutoAudioSession,
        state: BatchState,
        all_stories: list[StoryMissingAudio],
    ) -> None:
        if not state.upload_futures:
            return

        pending: list[Future[tuple[bool, str]]] = []
        for future in state.upload_futures:
            if not future.done():
                pending.append(future)
                continue
            try:
                ok, message = future.result()
            except Exception as exc:
                ok, message = False, f"Upload worker error: {exc}"
            if ok:
                state.result.chapters_uploaded += 1
                self._update_chapter_progress(session, state.result, all_stories)
            else:
                state.result.upload_errors.append(message)
        state.upload_futures = pending

    def _finish_batch_upload(self, session: AutoAudioSession, state: BatchState) -> None:
        session.set_step(
            6,
            f"Uploaded {state.result.chapters_uploaded}/{len(state.story.missing_chapters)} audio files "
            f"for {state.story.story_title}",
            story=state.story.story_title,
        )

        temp_batch_dir = Path(tempfile.gettempdir()) / f"autoaudio_{state.batch_id}"
        if temp_batch_dir.exists():
            self._upload.delete_batch_output_dir(session, state.batch_id, temp_batch_dir)

        expected_uploads = len(state.story.missing_chapters)
        fully_uploaded = (
            expected_uploads > 0
            and state.result.chapters_uploaded >= expected_uploads
            and not state.result.error
            and not state.result.upload_errors
        )
        if fully_uploaded:
            self._br.delete_batch_output(state.batch_id)
            session.add_log(9, f"Deleted BedReadVoices batch {state.batch_id} output directory")
        else:
            session.add_log(
                9,
                f"Kept BedReadVoices batch {state.batch_id} output directory for retry/recovery",
                level="warning",
            )

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
            f"Uploading completed chapter {position + 1}/{total} for {story.story_title}",
            story=story.story_title,
        )
        session.add_log(
            6,
            f"Downloading completed chapter {chapter_index} from BedReadVoices (batch_id={batch_id})",
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
        try:
            ok = self._upload.upload_audio(
                session, story.story_id, chapter_id, local_path, voice,
            )
        finally:
            # Always clean up the per-chapter downloaded audio file, even when
            # upload_audio raises. The temp dir cleanup happens in
            # _finish_batch_upload once the whole batch is done.
            self._upload.delete_local_audio_files(session, local_path)
        if ok:
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

    def _chapter_id_map_for_story(self, story: StoryMissingAudio) -> dict[int, str]:
        return {
            int(ch.chapter_index): ch.chapter_id
            for ch in story.missing_chapters
            if ch.chapter_id
        }

    def _cancel_in_flight_batches(self, states) -> None:
        for state in states:
            try:
                self._br.delete_batch_job(state.batch_id)
                self._br.delete_batch_output(state.batch_id)
            except Exception:
                pass

    def _ensure_not_stopped_or_paused(self, session: AutoAudioSession) -> bool:
        if not session.wait_while_paused():
            session.add_log(3, "Stop requested while paused, halting pipeline", level="warning")
            session.set_status("stopping")
            return False
        if session._stopping:
            session.add_log(3, "Stop requested, halting pipeline", level="warning")
            session.set_status("stopping")
            return False
        return True

    def _upload_worker_count(self, file_count: int) -> int:
        if file_count <= 1:
            return 1
        raw = _get_settings().get("auto_audio_upload_workers", 3)
        try:
            workers = int(raw)
        except Exception:
            workers = 3
        return max(1, min(4, workers, file_count))

    def _batch_window_size(self) -> int:
        raw = _get_settings().get("auto_audio_batch_window", 2)
        try:
            window = int(raw)
        except Exception:
            window = 2
        return max(1, min(2, window))

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
            f"uploaded={result.chapters_uploaded}/{expected_uploads}",
        )
