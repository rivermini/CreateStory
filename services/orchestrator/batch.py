"""Batch job polling for the auto-audio service."""

from __future__ import annotations

import time
from typing import Optional

import httpx

from .bedread import BedReadClient
from .models import AutoAudioSession


class BatchPoller:
    """Polls BedRead batch jobs until completion."""

    def __init__(self, bedread_client: BedReadClient) -> None:
        self._br = bedread_client

    def poll_until_done(
        self,
        session: AutoAudioSession,
        batch_id: str,
        timeout_seconds: int = 3600,
    ) -> tuple[bool, list[dict]]:
        start = time.time()
        completed_files: list[dict] = []

        while time.time() - start < timeout_seconds:
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
            for attempt in range(3):
                try:
                    job = self._br.get_batch_job(batch_id)
                    break
                except httpx.ReadTimeout:
                    if attempt < 2:
                        session.add_log(
                            4,
                            f"Read timeout polling batch {batch_id} (attempt {attempt + 1}/3), "
                            f"retrying...",
                            level="warning",
                        )
                        time.sleep(2 ** attempt)
                    else:
                        session.add_log(
                            4,
                            f"Read timeout polling batch {batch_id} (attempt {attempt + 1}/3), "
                            f"continuing...",
                            level="warning",
                        )
                except httpx.HTTPStatusError as exc:
                    if exc.response.status_code == 503 and attempt < 2:
                        session.add_log(
                            4,
                            f"503 polling batch {batch_id} (attempt {attempt + 1}/3), retrying...",
                            level="warning",
                        )
                        time.sleep(2 ** attempt)
                    else:
                        session.add_log(
                            4,
                            f"HTTP error polling batch {batch_id}: {exc.response.status_code}",
                            level="error",
                        )
                        job = None
                        break

            if job is None:
                session.add_log(4, f"Batch job {batch_id} not found", level="error")
                return False, completed_files

            statuses = [c.get("status") for c in job.get("chapters", [])]
            done = sum(1 for s in statuses if s == "completed")
            total = len(statuses)

            if all(s in ("completed", "failed") for s in statuses):
                for ch in job.get("chapters", []):
                    if ch.get("status") == "completed" and ch.get("output_filename"):
                        completed_files.append({
                            "chapter_id": ch.get("chapter_id", ""),
                            "chapter_index": ch.get("chapter_number"),
                            "filename": ch.get("output_filename"),
                        })
                return True, completed_files

            session.set_step(5, f"Generating audio ({done}/{total})", story=session.current_story)
            time.sleep(5)

        session.add_log(
            4,
            f"Batch job {batch_id} timed out after {timeout_seconds}s",
            level="error",
        )
        return False, completed_files
