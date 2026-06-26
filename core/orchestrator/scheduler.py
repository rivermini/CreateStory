"""Always-on scheduler for the AutoAudio full-library auto-scan mode.

Owns a single daemon thread that, while ``auto_scan_state.enabled`` is true,
fires a full-library scan cycle every ``interval_hours``. The thread is long-lived:
it idles (cheaply) while disabled and reacts when the master toggle is flipped, so
the schedule survives service restarts as long as the persisted state says enabled.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from threading import Event, Thread
from typing import TYPE_CHECKING, Optional

if TYPE_CHECKING:
    from core.service import AutoAudioService

logger = logging.getLogger(__name__)


def _parse_iso(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def _interval_hours(state: dict) -> float:
    try:
        return max(1.0 / 60.0, float(state.get("interval_hours") or 2))
    except (TypeError, ValueError):
        return 2.0


class AutoScanScheduler:
    """Background timer that triggers auto-scan cycles on an interval."""

    def __init__(self, service: "AutoAudioService", tick_seconds: float = 5.0) -> None:
        self._service = service
        self._tick = tick_seconds
        self._thread: Optional[Thread] = None
        self._stopping = False
        self._wakeup = Event()

    def start(self) -> None:
        """Start the scheduler thread if it is not already running."""
        if self._thread is not None and self._thread.is_alive():
            return
        self._stopping = False
        self._thread = Thread(
            target=self._loop, name="auto-scan-scheduler", daemon=True
        )
        self._thread.start()

    def stop(self) -> None:
        """Signal the thread to exit and wait briefly for it (called on shutdown)."""
        self._stopping = True
        self._wakeup.set()
        thread = self._thread
        if thread is not None:
            thread.join(timeout=10)

    def wake(self) -> None:
        """Nudge the loop to re-evaluate immediately (e.g. right after enable)."""
        self._wakeup.set()

    def _sleep(self) -> None:
        self._wakeup.wait(timeout=self._tick)
        self._wakeup.clear()

    def _loop(self) -> None:
        while not self._stopping:
            try:
                self._tick_once()
            except Exception:
                logger.exception("Auto-scan scheduler tick failed")
            if not self._stopping:
                self._sleep()

    def _tick_once(self) -> None:
        state = self._service.get_auto_scan_state()
        if not state.get("enabled"):
            return

        now = datetime.now(timezone.utc)
        next_run_at = _parse_iso(state.get("next_run_at"))
        due = next_run_at is None or next_run_at <= now
        if not due:
            return

        if self._service.is_session_active():
            # A scan (manual or scheduled) is already running — skip this tick and
            # push the next scheduled run out by one full interval.
            interval = _interval_hours(state)
            self._service._patch_auto_scan_state(
                next_run_at=(now + timedelta(hours=interval)).isoformat()
            )
            return

        logger.info("Auto-scan scheduler: starting scheduled cycle")
        self._service._run_auto_scan_cycle()

        # Re-schedule from the completion time so cycles don't overlap.
        state = self._service.get_auto_scan_state()
        interval = _interval_hours(state)
        finished = datetime.now(timezone.utc)
        self._service._patch_auto_scan_state(
            last_run_at=finished.isoformat(),
            next_run_at=(finished + timedelta(hours=interval)).isoformat(),
        )
