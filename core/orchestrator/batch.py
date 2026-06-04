"""Batch job polling for the AutoAudio service."""

from __future__ import annotations

import time
from typing import Callable, Optional

import httpx

from core.models import AutoAudioSession
from core.services.bedread_client import BedReadClient


class BatchPoller:
    """Polls BedRead batch jobs until completion."""

    def __init__(self, bedread_client: BedReadClient) -> None:
        self._br = bedread_client

    def poll_until_done(
        self,
        session: AutoAudioSession,
        batch_id: str,
        timeout_seconds: int = 3600,
        idle_timeout_seconds: int = 7200,
        on_completed_files: Optional[Callable[[list[dict]], None]] = None,
        on_poll_tick: Optional[Callable[[], None]] = None,
    ) -> tuple[bool, list[dict]]:
        start = time.time()
        last_progress = start
        last_signature = ""
        completed_files: list[dict] = []
        completed_indices: set[int] = set()

        while True:
            now = time.time()
            if now - last_progress >= idle_timeout_seconds:
                session.add_log(
                    4,
                    f"Batch job {batch_id} timed out after "
                    f"{idle_timeout_seconds}s without progress",
                    level="error",
                )
                return False, completed_files

            if session._stopping:
                session.add_log(
                    4,
                    "Batch polling interrupted — stop requested, cancelling batch job",
                    level="warning",
                )
                try:
                    self._br.delete_batch_job(batch_id)
                except Exception:
                    pass
                return False, completed_files

            job = None
            poll_error = False
            for attempt in range(3):
                try:
                    job = self._br.get_batch_job(batch_id)
                    break
                except (httpx.ConnectError, httpx.ConnectTimeout, httpx.ReadTimeout, httpx.RemoteProtocolError) as exc:
                    poll_error = True
                    if attempt < 2:
                        session.add_log(
                            4,
                            f"BedRead polling error for batch {batch_id} (attempt {attempt + 1}/3): "
                            f"{type(exc).__name__}; retrying...",
                            level="warning",
                        )
                        time.sleep(2 ** attempt)
                    else:
                        session.add_log(
                            4,
                            f"BedRead polling error for batch {batch_id} (attempt {attempt + 1}/3): "
                            f"{type(exc).__name__}; continuing...",
                            level="warning",
                        )
                except httpx.HTTPStatusError as exc:
                    retryable_status = exc.response.status_code in (429, 500, 502, 503, 504)
                    poll_error = retryable_status
                    if retryable_status and attempt < 2:
                        session.add_log(
                            4,
                            f"HTTP {exc.response.status_code} polling batch {batch_id} "
                            f"(attempt {attempt + 1}/3), retrying...",
                            level="warning",
                        )
                        time.sleep(2 ** attempt)
                    elif exc.response.status_code in (429, 500, 502, 503, 504):
                        session.add_log(
                            4,
                            f"HTTP {exc.response.status_code} polling batch {batch_id} "
                            f"(attempt {attempt + 1}/3), continuing...",
                            level="warning",
                        )
                    else:
                        session.add_log(
                            4,
                            f"HTTP error polling batch {batch_id}: {exc.response.status_code}",
                            level="error",
                        )
                        job = None
                        break

            if job is None:
                if poll_error:
                    time.sleep(5)
                    continue
                session.add_log(4, f"Batch job {batch_id} not found", level="error")
                return False, completed_files

            if job.get("status") == "queued":
                last_progress = time.time()
                queue_position = job.get("queue_position", 0)
                queue_desc = f"position {queue_position}" if queue_position else "waiting"
                session.set_step(
                    5,
                    f"Waiting for BedRead batch queue ({queue_desc})",
                    story=session.current_story,
                )
                if on_poll_tick:
                    try:
                        on_poll_tick()
                    except Exception as exc:
                        session.add_log(
                            6,
                            f"Failed to process completed chapter upload: {exc}",
                            level="error",
                        )
                        return False, completed_files
                time.sleep(5)
                continue

            statuses = [c.get("status") for c in job.get("chapters", [])]
            done = sum(1 for s in statuses if s == "completed")
            total = len(statuses)
            signature = "|".join(
                f"{c.get('chapter_number')}:{c.get('status')}:{c.get('progress_pct', 0)}:{c.get('output_filename', '')}"
                for c in job.get("chapters", [])
            )
            if signature != last_signature:
                last_signature = signature
                last_progress = time.time()

            new_completed_files: list[dict] = []
            for ch in job.get("chapters", []):
                chapter_index = int(ch.get("chapter_number", 0) or 0)
                if (
                    ch.get("status") == "completed"
                    and ch.get("output_filename")
                    and chapter_index
                    and chapter_index not in completed_indices
                ):
                    file_info = {
                        "chapter_id": ch.get("chapter_id", ""),
                        "chapter_index": chapter_index,
                        "filename": ch.get("output_filename"),
                    }
                    completed_indices.add(chapter_index)
                    completed_files.append(file_info)
                    new_completed_files.append(file_info)

            if new_completed_files and on_completed_files:
                try:
                    on_completed_files(new_completed_files)
                except Exception as exc:
                    session.add_log(
                        6,
                        f"Failed to queue completed chapter upload: {exc}",
                        level="error",
                    )
                    return False, completed_files

            if on_poll_tick:
                try:
                    on_poll_tick()
                except Exception as exc:
                    session.add_log(
                        6,
                        f"Failed to process completed chapter upload: {exc}",
                        level="error",
                    )
                    return False, completed_files

            if all(s in ("completed", "failed") for s in statuses):
                return True, completed_files

            session.set_step(5, f"Generating audio ({done}/{total})", story=session.current_story)
            time.sleep(5)
