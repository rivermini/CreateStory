"""Persistent, bounded DriveSync job dispatcher."""

from __future__ import annotations

import logging
import os
import threading
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Callable

if TYPE_CHECKING:
    from api.models.drive_sync import SyncJob

logger = logging.getLogger(__name__)

_MAX_ATTEMPTS = 3
# Every currently registered handler is retry-safe: story uploads first resolve
# by title and the remaining handlers use deterministic update operations. Keep
# this as an explicit allow-list so a future side-effecting handler is not
# retried automatically merely because it was added to the registry.
RETRYABLE_JOB_KINDS = frozenset({
    "upload_single",
    "update_single",
    "chapter_content_update",
    "metadata_update",
    "cover_update",
    "banner_update",
    "intro_update",
    "title_update",
    "watermark_picture_fix",
})
_RECOVERABLE_ERROR_MARKERS = (
    "timeout",
    "timed out",
    "connection",
    "temporar",
    "rate limit",
    "429",
    "502",
    "503",
    "504",
    "ssl",
    "reset by peer",
)


def _worker_count() -> int:
    try:
        return max(1, min(16, int(os.getenv("DRIVE_SYNC_JOB_WORKERS", "2"))))
    except (TypeError, ValueError):
        return 2


class JobDispatcherMixin:
    """Claims persisted jobs and runs them with a fixed-size worker pool."""

    def start_job_dispatcher(self) -> int:
        threads = getattr(self, "_job_dispatcher_threads", None)
        if threads and any(thread.is_alive() for thread in threads):
            return len(threads)
        self._job_dispatcher_stop = threading.Event()
        self._job_dispatcher_wake = threading.Event()
        self._job_dispatcher_threads: list[threading.Thread] = []
        for index in range(_worker_count()):
            thread = threading.Thread(
                target=self._job_worker_loop,
                name=f"drive-sync-job-{index + 1}",
                daemon=True,
            )
            thread.start()
            self._job_dispatcher_threads.append(thread)
        self._job_dispatcher_wake.set()
        return len(self._job_dispatcher_threads)

    def stop_job_dispatcher(self, timeout: float = 5.0) -> None:
        stop = getattr(self, "_job_dispatcher_stop", None)
        wake = getattr(self, "_job_dispatcher_wake", None)
        if stop is None:
            return
        stop.set()
        if wake is not None:
            wake.set()
        for thread in getattr(self, "_job_dispatcher_threads", []):
            thread.join(timeout=timeout)

    def notify_job_dispatcher(self) -> None:
        wake = getattr(self, "_job_dispatcher_wake", None)
        if wake is not None:
            wake.set()

    def _job_worker_loop(self) -> None:
        while not self._job_dispatcher_stop.is_set():
            try:
                job = self._repo.claim_next_job()
            except Exception:
                logger.exception("Failed to claim DriveSync job")
                self._job_dispatcher_wake.wait(1.0)
                self._job_dispatcher_wake.clear()
                continue
            if job is None:
                self._job_dispatcher_wake.wait(0.75)
                self._job_dispatcher_wake.clear()
                continue
            self._execute_claimed_job(job)

    def _execute_claimed_job(self, job: "SyncJob") -> None:
        try:
            handler = self._job_handler_registry().get(job.kind)
            if handler is None:
                raise RuntimeError(f"No handler registered for DriveSync job kind '{job.kind}'.")
            handler(job)
            current = self.get_job(job.id)
            if current is None:
                return
            if current.status == "running":
                raise RuntimeError("Job handler returned without setting a terminal status.")
            if (
                current.status == "error"
                and current.attempt_count < _MAX_ATTEMPTS
                and current.kind in RETRYABLE_JOB_KINDS
                and self._is_recoverable_error(current.error or current.last_error or "")
            ):
                if self._repo.requeue_job(current.id, current.error or "Transient job failure", _MAX_ATTEMPTS):
                    self.append_job_log(current.id, "warning", "Transient failure; queued for retry.")
                    self.notify_job_dispatcher()
        except Exception as exc:
            error = f"Job dispatcher failure: {exc}"
            logger.exception("DriveSync job %s failed", job.id)
            if (
                job.kind in RETRYABLE_JOB_KINDS
                and job.attempt_count < _MAX_ATTEMPTS
                and self._repo.requeue_job(job.id, error, _MAX_ATTEMPTS)
            ):
                self.append_job_log(job.id, "warning", f"{error}; queued for retry.")
                self.notify_job_dispatcher()
                return
            now = datetime.now(timezone.utc).isoformat()
            self.append_job_log(job.id, "error", error)
            self.update_job(job.id, status="error", finished_at=now, error=error)

    @staticmethod
    def _is_recoverable_error(error: str) -> bool:
        lowered = error.lower()
        return any(marker in lowered for marker in _RECOVERABLE_ERROR_MARKERS)

    def _job_handler_registry(self) -> dict[str, Callable[["SyncJob"], object]]:
        return {
            "upload_single": lambda job: self.sync_folder_as_job(job.id),
            "update_single": lambda job: self.sync_update_as_job(job.id),
            "chapter_content_update": lambda job: self.sync_content_update_as_job(
                job.id,
                str(job.payload.get("story_id") or ""),
                job.payload.get("chapter_number"),
            ),
            "metadata_update": lambda job: self.sync_metadata_update_as_job(
                job.id,
                str(job.payload.get("story_id") or ""),
                list(job.payload.get("differences") or []),
            ),
            "cover_update": lambda job: self.sync_cover_update_as_job(
                job.id,
                str(job.payload.get("story_id") or ""),
                str(job.payload.get("filename") or "cover1.jpg"),
            ),
            "banner_update": lambda job: self.sync_banner_update_as_job(
                job.id,
                str(job.payload.get("story_id") or ""),
                str(job.payload.get("filename") or "banner1.jpg"),
            ),
            "intro_update": lambda job: self.sync_intro_update_as_job(
                job.id,
                str(job.payload.get("story_id") or ""),
                str(job.payload.get("filename") or "intro1.jpg"),
            ),
            "title_update": lambda job: self.sync_title_folder_update_as_job(
                job.id,
                str(job.payload.get("story_id") or ""),
                job.payload.get("chapter_number"),
            ),
            "watermark_picture_fix": lambda job: self.sync_watermark_picture_fix_as_job(
                job.id,
                str(job.payload.get("story_id") or ""),
            ),
        }
