"""Persistent browser-assisted batch capture for Jobnib stories."""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import shutil
import threading
import time
import urllib.parse
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass, field, fields
from datetime import datetime
from pathlib import Path
from typing import Any, Literal, cast

import requests
from bs4 import BeautifulSoup
from fastapi import HTTPException

from api.services.archive_cache import get_or_build_cached_zip
from api.services.batch_runtime import (
    atomic_write_json,
    clamp,
    estimate_progress,
    filter_rows,
    parse_local_datetime,
    validate_batch_id,
)
from api.services.jobnib_cookie_service import (
    is_jobnib_challenge,
    jobnib_headers,
    load_jobnib_cookies,
    normalize_jobnib_url,
)
from spiders.jobnib import JobnibSpider, _JobnibBrowser
from utils.cleaner import clean_chapter_content
from utils.proxy import requests_proxies
from utils.sanitize import sanitize_filename

logger = logging.getLogger(__name__)

BatchPhase = Literal["discovering", "ready", "crawling", "waiting_for_session", "completed", "failed"]
RowStatus = Literal["discovered", "queued", "crawling", "completed", "skipped", "failed", "needs_session"]
CrawlMode = Literal["slow", "fast"]
DiscoveryScope = Literal["completed", "ongoing", "all"]

JOBNIB_HOMEPAGE_URL = "https://jobnib.com/"
# Jobnib's published archive pagination is deleted. Pretty pagination URLs also
# repeat the same first two stories, so batch discovery intentionally scans the
# current homepage exactly once. Legacy/unlisted URLs remain importable.
JOBNIB_MAX_ARCHIVE_PAGES = 1
JOBNIB_MAX_STORIES = max(1, int(os.getenv("JOBNIB_BATCH_MAX_STORIES", "10000")))
JOBNIB_DISCOVERY_INTERVAL = max(0.25, float(os.getenv("JOBNIB_DISCOVERY_INTERVAL_SECONDS", "1.5")))
JOBNIB_MIN_CHAPTER_WORDS = max(1, int(os.getenv("JOBNIB_MIN_CHAPTER_WORDS", "100")))
JOBNIB_ARCHIVE_DELAY = max(0.0, float(os.getenv("JOBNIB_ARCHIVE_PREPARE_DELAY_SECONDS", "120")))
JOBNIB_ARCHIVE_COMPRESSION = clamp(int(os.getenv("JOBNIB_ARCHIVE_COMPRESSION_LEVEL", "1")), 0, 9)
JOBNIB_MEMORY_LOG_LINES = max(180, int(os.getenv("JOBNIB_BATCH_MEMORY_LOG_LINES", "10000")))
JOBNIB_CHAPTER_SLUG_RE = re.compile(r"-chapter-\d+(?:-\d+)?$", re.IGNORECASE)

MODE_PRESETS: dict[CrawlMode, dict[str, float | int]] = {
    "slow": {
        "story_workers": clamp(int(os.getenv("JOBNIB_SLOW_STORY_WORKERS", "1")), 1, 2),
        "request_slots": clamp(int(os.getenv("JOBNIB_SLOW_REQUEST_SLOTS", "2")), 1, 4),
        "request_interval": max(0.5, float(os.getenv("JOBNIB_SLOW_REQUEST_INTERVAL_SECONDS", "1.5"))),
    },
    "fast": {
        "story_workers": clamp(int(os.getenv("JOBNIB_FAST_STORY_WORKERS", "2")), 1, 2),
        "request_slots": clamp(int(os.getenv("JOBNIB_FAST_REQUEST_SLOTS", "4")), 1, 4),
        "request_interval": max(0.25, float(os.getenv("JOBNIB_FAST_REQUEST_INTERVAL_SECONDS", "0.75"))),
    },
}


class JobnibSessionRequired(RuntimeError):
    pass


@dataclass
class JobnibBatchRow:
    index: int
    title: str
    url: str
    story_id: str
    status: RowStatus = "discovered"
    author: str = ""
    completion_status: str = "Unknown"
    total_chapters: int | None = None
    crawled_chapters: int = 0
    output_file: str = ""
    metadata_file: str = ""
    crawl_run_id: str = ""
    retry_priority: int = 0
    completed_at: str = ""
    error: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class JobnibBatchState:
    batch_id: str
    created_by_user_id: str | None
    rows: list[JobnibBatchRow] = field(default_factory=list)
    batch_name: str = "Jobnib stories"
    phase: BatchPhase = "discovering"
    mode: CrawlMode = "slow"
    story_status_scope: DiscoveryScope = "completed"
    max_archive_pages: int = JOBNIB_MAX_ARCHIVE_PAGES
    max_stories_per_run: int = 20
    output_dir: str = ""
    error_message: str = ""
    created_at: str = field(default_factory=lambda: now_string())
    started_at: str | None = None
    finished_at: str | None = None
    cancel_requested: bool = False
    crawl_runs: list[dict[str, Any]] = field(default_factory=list)
    log_lines: list[str] = field(default_factory=list)
    log_file: str = ""
    discovery_next_url: str = JOBNIB_HOMEPAGE_URL
    pending_metadata_refs: list[dict[str, str]] = field(default_factory=list)
    discovery_pages_checked: int = 0
    archive_found_count: int = 0
    completed_eligible_count: int = 0
    ongoing_eligible_count: int = 0
    excluded_count: int = 0
    duplicate_count: int = 0
    metadata_failed_count: int = 0
    challenged_count: int = 0
    session_required: bool = False
    consecutive_session_challenges: int = 0
    last_session_error: str = ""
    session_verified_at: str = ""
    request_total: int = 0
    completed_request_total: int = 0
    request_latency_total_seconds: float = 0.0
    rate_limit_events: int = 0
    cooldown_until: float = 0.0

    def add_log(self, message: str) -> None:
        line = f"{datetime.now().strftime('%H:%M:%S')} {message}"
        self.log_lines.append(line)
        if len(self.log_lines) > JOBNIB_MEMORY_LOG_LINES:
            self.log_lines = self.log_lines[-JOBNIB_MEMORY_LOG_LINES:]
        if self.log_file:
            try:
                path = Path(self.log_file)
                path.parent.mkdir(parents=True, exist_ok=True)
                with path.open("a", encoding="utf-8") as handle:
                    handle.write(line + "\n")
            except OSError as exc:
                logger.warning("Could not append Jobnib batch log: %s", exc)


class JobnibBatchService:
    def __init__(self, output_root: Path | None = None) -> None:
        self._lock = threading.RLock()
        self._request_start_lock = threading.Lock()
        self._browser_lock = threading.RLock()
        self._snapshot_archive_lock = threading.Lock()
        self._shared_browser: _JobnibBrowser | None = None
        self._last_request_at = 0.0
        self._session_verified_at = ""
        self._batches: dict[str, JobnibBatchState] = {}
        self._project_root = Path(__file__).resolve().parents[2]
        self._batch_root = ((output_root or (self._project_root / "output")) / "jobnib_batch").resolve()
        self._batch_root.mkdir(parents=True, exist_ok=True)
        self._index_file = self._batch_root / "batch_index.json"
        self._exported_index_file = self._batch_root / "exported_story_index.json"
        self._archive_timers: dict[str, threading.Timer] = {}
        resume_ids = self._load_index()
        for batch_id in resume_ids:
            threading.Thread(target=self._run_discovery, args=(batch_id,), daemon=True).start()

    def start(
        self,
        *,
        created_by_user_id: str | None,
        batch_name: str,
        max_archive_pages: int,
        mode: CrawlMode = "slow",
        story_status: DiscoveryScope = "completed",
    ) -> JobnibBatchState:
        self.require_verified_session()
        mode = normalize_mode(mode)
        story_status = normalize_discovery_scope(story_status)
        batch_id = uuid.uuid4().hex[:8]
        output_dir = self._prepare_output_dir(batch_id)
        state = JobnibBatchState(
            batch_id=batch_id,
            created_by_user_id=created_by_user_id,
            batch_name=(batch_name or "Jobnib stories").strip(),
            mode=mode,
            story_status_scope=story_status,
            max_archive_pages=clamp(max_archive_pages, 1, JOBNIB_MAX_ARCHIVE_PAGES),
            output_dir=str(output_dir),
            started_at=now_string(),
            log_file=str(output_dir / "jobnib_batch.log"),
        )
        scope_label = "completed and ongoing" if story_status == "all" else story_status
        state.add_log(f"Started Jobnib homepage discovery. Target: {scope_label} stories.")
        with self._lock:
            self._batches[batch_id] = state
            self._persist_locked()
        threading.Thread(target=self._run_discovery, args=(batch_id,), daemon=True).start()
        return state

    def start_crawl(self, batch_id: str, *, mode: CrawlMode, max_stories: int | None = None) -> JobnibBatchState:
        mode = normalize_mode(mode)
        with self._lock:
            state = self._get_state_locked(batch_id)
            if state.phase in {"discovering", "crawling"}:
                raise ValueError("This Jobnib batch is already active.")
            rows = [row for row in state.rows if row.status in {"discovered", "queued"}]
            rows.sort(key=lambda row: (0 if row.retry_priority else 1, -row.retry_priority, row.index))
            limit = max_stories if max_stories is not None else state.max_stories_per_run
            rows = rows[:clamp(limit, 1, JOBNIB_MAX_STORIES)]
            if not rows:
                if any(row.status == "needs_session" for row in state.rows):
                    raise ValueError("Refresh the Jobnib session and retry session rows first.")
                raise ValueError("This Jobnib batch has no queued stories to crawl.")
            run_id = uuid.uuid4().hex[:8]
            for row in rows:
                row.status = "queued"
                row.error = ""
                row.crawl_run_id = run_id
            state.mode = mode
            state.phase = "crawling"
            state.cancel_requested = False
            state.finished_at = None
            state.session_required = False
            state.crawl_runs.append({
                "run_id": run_id,
                "started_at": now_string(),
                "finished_at": None,
                "target_stories": len(rows),
                "status": "crawling",
                "initial_crawled_chapters": sum(int(row.crawled_chapters or 0) for row in rows),
            })
            state.add_log(f"Started {mode} crawl run {run_id} for {len(rows)} story/stories.")
            self._persist_locked()
        threading.Thread(target=self._run_crawl, args=(batch_id, run_id), daemon=True).start()
        return state

    def pause_crawl(self, batch_id: str) -> JobnibBatchState:
        with self._lock:
            state = self._get_state_locked(batch_id)
            if state.phase not in {"discovering", "crawling"}:
                raise ValueError("Only an active Jobnib batch can be paused.")
            state.cancel_requested = True
            state.add_log("Pause requested. In-flight work will checkpoint before stopping.")
            self._persist_locked()
            return state

    def retry_failed(self, batch_id: str, row_index: int | None = None) -> JobnibBatchState:
        return self._retry_rows(batch_id, "failed", row_index)

    def retry_session(self, batch_id: str, row_index: int | None = None) -> JobnibBatchState:
        with self._lock:
            state = self._retry_rows(batch_id, "needs_session", row_index)
            state.session_required = False
            state.consecutive_session_challenges = 0
            state.last_session_error = ""
            state.session_verified_at = now_string()
            self._persist_locked()
            return state

    def mark_session_verified(self) -> None:
        with self._lock:
            self._session_verified_at = now_string()
            for state in self._batches.values():
                state.session_verified_at = now_string()
                state.session_required = False
                state.consecutive_session_challenges = 0
                state.last_session_error = ""
            self._persist_locked()
        # A persistent browser keeps its original cookie jar and User-Agent.
        # Recreate it after an operator saves a refreshed Jobnib session.
        with self._browser_lock:
            if self._shared_browser is not None:
                self._shared_browser.close()
                self._shared_browser = None

    def mark_session_unverified(self) -> None:
        with self._lock:
            self._session_verified_at = ""
            for state in self._batches.values():
                state.session_verified_at = ""
            self._persist_locked()

    def require_verified_session(self) -> None:
        with self._lock:
            if self._session_verified_at:
                return
        raise ValueError("Test the Jobnib session successfully before discovering or adding stories.")

    def get_status(self, batch_id: str) -> dict[str, Any]:
        with self._lock:
            return self._summary_locked(self._get_state_locked(batch_id))

    def validate_browser_capture_scope(self, batch_id: str, row_index: int | None = None) -> None:
        """Validate that a browser-assisted capture can safely use this batch.

        Browser capture and the automated dispatcher must never write the same
        checkpoint concurrently.  Pairing is therefore limited to batches that
        are not actively discovering or crawling.
        """
        with self._lock:
            state = self._get_state_locked(batch_id)
            if state.phase in {"discovering", "crawling"}:
                raise ValueError("Pause the active Jobnib batch before starting browser-assisted capture.")
            if row_index is not None:
                if row_index < 1 or row_index > len(state.rows):
                    raise ValueError(f"Jobnib batch row {row_index} was not found.")
                row = state.rows[row_index - 1]
                if row.status in {"completed", "skipped"}:
                    raise ValueError(f"Jobnib batch row {row_index} no longer needs browser capture.")
                return
            if not any(row.status not in {"completed", "skipped"} for row in state.rows):
                raise ValueError("This Jobnib batch has no incomplete stories to capture.")

    def get_browser_capture_candidate(
        self,
        batch_id: str,
        row_index: int | None = None,
    ) -> dict[str, Any] | None:
        """Return the next uncheckpointed chapter without fetching that chapter.

        Only the public story page may be fetched here, and only when an older
        batch does not yet have a persisted chapter manifest.  The companion is
        responsible for opening the returned chapter URL in the user's normal
        browser and for capturing its already-unlocked DOM.
        """
        self.validate_browser_capture_scope(batch_id, row_index)
        with self._lock:
            state = self._get_state_locked(batch_id)
            rows = [
                row for row in state.rows
                if row.status not in {"completed", "skipped"}
                and (row_index is None or row.index == row_index)
            ]

        for row in sorted(rows, key=lambda item: item.index):
            manifest = self._ensure_chapter_manifest(batch_id, row)
            links = manifest.get("chapters") or []
            checkpoint = self._load_checkpoint(row, links)
            captured_urls = {str(item.get("url") or "") for item in checkpoint}
            with self._lock:
                stored = self._get_state_locked(batch_id).rows[row.index - 1]
                stored.total_chapters = len(links)
                stored.crawled_chapters = len(checkpoint)
                self._persist_locked()

            for ref in links:
                if str(ref.get("url") or "") in captured_urls:
                    continue
                sequence_index = int(ref.get("sequence_index") or ref.get("chapter_number") or 0)
                if sequence_index < 1:
                    raise RuntimeError("Jobnib chapter manifest contains an invalid sequence index.")
                return {
                    "row_index": row.index,
                    "story_id": row.story_id,
                    "story_title": row.title,
                    "sequence_index": sequence_index,
                    "displayed_chapter_number": ref.get("displayed_chapter_number"),
                    "volume_label": str(ref.get("volume_label") or ""),
                    "chapter_title": str(ref.get("title") or f"Chapter {sequence_index}"),
                    "url": str(ref["url"]),
                    # Jobnib's current reader splits every chapter into two
                    # protected content containers.  Hidden completed segments
                    # are valid; empty segments or visible locks are not.
                    "expected_segment_ids": ["1", "2"],
                    "completed_chapters": len(checkpoint),
                    "total_chapters": len(links),
                }

            if links and len(checkpoint) == len(links):
                self._finalize_browser_capture_row(batch_id, row, manifest, checkpoint)
        return None

    def save_browser_capture_chapter(
        self,
        batch_id: str,
        *,
        row_index: int,
        sequence_index: int,
        chapter_url: str,
        chapter_title: str,
        content: str,
        checksum: str,
    ) -> dict[str, Any]:
        """Checkpoint one server-validated browser capture and finalize if done."""
        self.validate_browser_capture_scope(batch_id, row_index)
        with self._lock:
            state = self._get_state_locked(batch_id)
            row = state.rows[row_index - 1]
        manifest = self._ensure_chapter_manifest(batch_id, row)
        links = list(manifest.get("chapters") or [])
        matching = [
            ref for ref in links
            if int(ref.get("sequence_index") or ref.get("chapter_number") or 0) == sequence_index
            and str(ref.get("url") or "") == chapter_url
        ]
        if len(matching) != 1:
            raise ValueError("The captured chapter does not match the persisted Jobnib chapter manifest.")

        with self._lock:
            state = self._get_state_locked(batch_id)
            row = state.rows[row_index - 1]
            checkpoint = self._load_checkpoint(row, links)
            existing = next((item for item in checkpoint if item.get("url") == chapter_url), None)
            if existing is None:
                ref = matching[0]
                checkpoint.append({
                    "sequence_index": sequence_index,
                    "displayed_chapter_number": ref.get("displayed_chapter_number"),
                    "volume_label": str(ref.get("volume_label") or ""),
                    "title": chapter_title or str(ref.get("title") or f"Chapter {sequence_index}"),
                    "content": content,
                    "url": chapter_url,
                    "checksum": checksum,
                    "capture_method": "browser_assisted",
                })
                checkpoint.sort(key=lambda item: int(item.get("sequence_index") or 0))
                self._save_checkpoint(row, checkpoint)
                state.add_log(
                    f"{row.title}: browser-assisted capture saved "
                    f"{len(checkpoint)}/{len(links)} full chapter(s)."
                )
            row.total_chapters = len(links)
            row.crawled_chapters = len(checkpoint)
            if len(checkpoint) < len(links):
                row.status = "needs_session"
                row.error = "Waiting for browser-assisted full-chapter capture."
                state.phase = "waiting_for_session"
                state.session_required = True
            self._persist_locked()

        story_completed = len(checkpoint) == len(links) and bool(links)
        if story_completed:
            self._finalize_browser_capture_row(batch_id, row, manifest, checkpoint)
            self._schedule_archive(batch_id)
        return {
            "row_index": row_index,
            "crawled_chapters": len(checkpoint),
            "total_chapters": len(links),
            "story_completed": story_completed,
            "already_checkpointed": existing is not None,
        }

    def list_batches(self, user_id: str | None, role: str | None) -> list[dict[str, Any]]:
        with self._lock:
            states = [
                state for state in self._batches.values()
                if role in {"admin", "operator"} or (state.created_by_user_id and state.created_by_user_id == user_id)
            ]
            values = [self._summary_locked(state) for state in states]
        return sorted(values, key=lambda item: item.get("created_at") or "", reverse=True)

    def list_rows(self, batch_id: str, offset: int, limit: int, status_filter: str = "all") -> dict[str, Any]:
        with self._lock:
            state = self._get_state_locked(batch_id)
            rows = filter_rows(deduplicate_story_rows(state.rows), status_filter)
            offset = max(0, offset)
            limit = clamp(limit, 1, 500)
            return {
                "batch": self._summary_locked(state),
                "items": [row.to_dict() for row in rows[offset:offset + limit]],
                "total": len(rows),
                "offset": offset,
                "limit": limit,
            }

    def get_full_logs(self, batch_id: str) -> dict[str, Any]:
        with self._lock:
            state = self._get_state_locked(batch_id)
            summary = self._summary_locked(state)
            log_file = state.log_file
            memory = list(state.log_lines)
        lines = memory
        if log_file and Path(log_file).exists():
            try:
                lines = Path(log_file).read_text(encoding="utf-8").splitlines()
            except OSError:
                pass
        return {"batch": summary, "log_lines": lines, "total": len(lines)}

    def export_catalog(self, batch_id: str | None = None) -> dict[str, Any]:
        with self._lock:
            states = [self._get_state_locked(batch_id)] if batch_id else list(self._batches.values())
            by_url: dict[str, dict[str, Any]] = {}
            for state in states:
                for row in state.rows:
                    by_url[row.url] = {
                        "title": row.title,
                        "url": row.url,
                        "story_id": row.story_id,
                        "completion_status": row.completion_status,
                        "total_chapters": row.total_chapters,
                    }
        return {
            "kind": "jobnib_batch_discovered_catalog" if batch_id else "jobnib_discovered_catalog",
            "version": 1,
            "exported_at": now_string(),
            "batch_id": batch_id,
            "story_count": len(by_url),
            "stories": sorted(by_url.values(), key=lambda item: (item.get("title") or "").lower()),
        }

    def import_catalog(self, payload: Any, created_by_user_id: str | None) -> dict[str, Any]:
        self.require_verified_session()
        refs = extract_import_refs(payload)
        if not refs:
            raise ValueError("No valid Jobnib story URLs were found in the import.")
        batch_id = uuid.uuid4().hex[:8]
        output_dir = self._prepare_output_dir(batch_id)
        state = JobnibBatchState(
            batch_id=batch_id,
            created_by_user_id=created_by_user_id,
            batch_name="Imported Jobnib catalog",
            phase="discovering",
            story_status_scope="all",
            output_dir=str(output_dir),
            started_at=now_string(),
            log_file=str(output_dir / "jobnib_batch.log"),
            discovery_next_url="",
        )
        state.add_log(f"Inspecting {len(refs)} imported Jobnib story URL(s).")
        with self._lock:
            self._batches[batch_id] = state
            self._persist_locked()
        threading.Thread(target=self._run_import_inspection, args=(batch_id, refs), daemon=True).start()
        return {"imported_count": len(refs), "batch": self.get_status(batch_id)}

    def add_story(self, batch_id: str, story_url: str) -> dict[str, Any]:
        """Inspect one explicit story URL and append it to an existing batch."""
        self.require_verified_session()
        url = normalize_story_url(story_url)
        story_id = urllib.parse.urlparse(url).path.rstrip("/").split("/")[-1]
        ref = {"url": url, "story_id": story_id, "title": ""}
        with self._lock:
            state = self._get_state_locked(batch_id)
            if state.phase in {"discovering", "crawling"}:
                raise ValueError("Pause the active Jobnib batch before adding a story.")
            if any(row.url == url for row in state.rows):
                raise ValueError("This Jobnib story is already in the batch.")
            state.archive_found_count += 1
            state.add_log(f"Inspecting manually added story: {url}")

        self._inspect_and_add_ref(batch_id, ref, respect_scope=False)

        with self._lock:
            state = self._get_state_locked(batch_id)
            row = next((item for item in reversed(state.rows) if item.url == url), None)
            if row is None:
                raise ValueError("The Jobnib story could not be added to this batch.")
            if row.status not in {"failed", "skipped"} and state.phase == "completed":
                state.phase = "ready"
                state.finished_at = None
            state.add_log(
                f"Added {row.title} to this batch ({row.total_chapters or 0} chapter links found)."
                if row.status != "failed"
                else f"Could not add {row.title}: {row.error}"
            )
            self._persist_locked()
            return {"added": row.status != "failed", "row": row.to_dict(), "batch": self._summary_locked(state)}

    def delete_batch(self, batch_id: str) -> None:
        with self._lock:
            state = self._get_state_locked(batch_id)
            if state.phase in {"discovering", "crawling"}:
                raise ValueError("Active Jobnib batches cannot be deleted.")
            output_dir = Path(state.output_dir).resolve()
            if output_dir.is_relative_to(self._batch_root):
                shutil.rmtree(output_dir, ignore_errors=True)
            self._batches.pop(batch_id, None)
            timer = self._archive_timers.pop(batch_id, None)
            if timer:
                timer.cancel()
            self._persist_locked()

    def require_owner(self, batch_id: str, user_id: str | None, role: str | None) -> None:
        with self._lock:
            state = self._get_state_locked(batch_id)
            if role in {"admin", "operator"}:
                return
            if state.created_by_user_id and state.created_by_user_id == user_id:
                return
        raise HTTPException(status_code=403, detail="Access denied for this Jobnib batch.")

    def get_download_files(
        self,
        batch_id: str,
        run_id: str | None = None,
        *,
        include_partial: bool = False,
    ) -> tuple[JobnibBatchState, list[tuple[Path, str]]]:
        with self._lock:
            state = self._get_state_locked(batch_id)
            output_dir = Path(state.output_dir).resolve()
            allowed_rows = [row for row in state.rows if row.status == "completed" and (not run_id or row.crawl_run_id == run_id)]
            paths = {row.output_file for row in allowed_rows} | {row.metadata_file for row in allowed_rows}
            partial_rows = [
                JobnibBatchRow(**row.to_dict())
                for row in state.rows
                if include_partial
                and row.status != "completed"
                and int(row.crawled_chapters or 0) > 0
                and (not run_id or row.crawl_run_id == run_id)
            ]
        files: list[tuple[Path, str]] = []
        for relative in sorted(path for path in paths if path):
            candidate = (output_dir / relative).resolve()
            if candidate.is_relative_to(output_dir) and candidate.is_file() and not candidate.is_symlink():
                files.append((candidate, relative.replace("\\", "/")))
        if include_partial:
            files.extend(self._prepare_partial_snapshot_files(output_dir, partial_rows))
        if not files:
            raise FileNotFoundError("No captured Jobnib chapters are available yet.")
        return state, files

    def prepare_archive(
        self,
        batch_id: str,
        run_id: str | None = None,
        *,
        include_partial: bool = False,
    ) -> Path:
        if include_partial:
            with self._snapshot_archive_lock:
                return self._prepare_archive(batch_id, run_id, include_partial=True)
        return self._prepare_archive(batch_id, run_id, include_partial=False)

    def _prepare_archive(self, batch_id: str, run_id: str | None, *, include_partial: bool) -> Path:
        state, files = self.get_download_files(batch_id, run_id, include_partial=include_partial)
        suffix = f"_{run_id}" if run_id else ""
        progress_suffix = "_progress" if include_partial else ""
        return get_or_build_cached_zip(
            files,
            Path(state.output_dir) / ".archives",
            f"jobnib_batch_{batch_id}{suffix}{progress_suffix}",
            compression_level=JOBNIB_ARCHIVE_COMPRESSION,
        )

    def _prepare_partial_snapshot_files(
        self,
        output_dir: Path,
        rows: list[JobnibBatchRow],
    ) -> list[tuple[Path, str]]:
        files: list[tuple[Path, str]] = []
        snapshot_root = output_dir / ".snapshots" / "progress"
        for row in rows:
            checkpoint_path = (
                output_dir
                / ".checkpoints"
                / f"{row.index:06d}_{sanitize_filename(row.story_id)}.json"
            )
            try:
                payload = json.loads(checkpoint_path.read_text(encoding="utf-8"))
            except (OSError, ValueError, TypeError):
                continue
            if payload.get("story_id") != row.story_id:
                continue
            chapters = [
                item
                for item in payload.get("chapters", [])
                if isinstance(item, dict) and item.get("content") and item.get("url")
            ]
            chapters.sort(key=lambda item: int(item.get("sequence_index") or 0))
            if not chapters:
                continue

            captured = len(chapters)
            total = max(captured, int(row.total_chapters or captured))
            safe_title = sanitize_filename(row.title or row.story_id)
            folder_name = f"PARTIAL_{row.index:04d}_{safe_title}_{captured}-of-{total}_jn"
            archive_folder = Path("In Progress") / folder_name
            snapshot_dir = snapshot_root / f"{row.index:06d}_{sanitize_filename(row.story_id)}"
            markdown_name = f"Jobnib_{safe_title}_Partial_{captured}-of-{total}_jn.md"
            markdown_path = snapshot_dir / markdown_name
            info_path = snapshot_dir / "info.json"
            _atomic_write_text(
                markdown_path,
                format_jobnib_markdown(
                    row.title,
                    row.url,
                    chapters,
                    status=f"Partial capture ({captured}/{total})",
                    total_chapters=total,
                ),
            )
            atomic_write_json(info_path, {
                "title": row.title,
                "author": row.author,
                "status": "Partial capture",
                "source_status": row.completion_status,
                "source_url": row.url,
                "story_id": row.story_id,
                "captured_chapters": captured,
                "total_chapters": total,
                "is_partial": True,
                "snapshot_at": now_string(),
                "source_suffix": "jn",
            })
            files.extend([
                (markdown_path, str(archive_folder / markdown_name).replace("\\", "/")),
                (info_path, str(archive_folder / "info.json").replace("\\", "/")),
            ])
        return files

    def _run_discovery(self, batch_id: str) -> None:
        try:
            while True:
                with self._lock:
                    state = self._get_state_locked(batch_id)
                    if state.cancel_requested:
                        state.phase = "ready" if state.rows else "failed"
                        state.add_log("Discovery paused.")
                        self._persist_locked()
                        return
                    if state.session_required:
                        state.phase = "waiting_for_session"
                        self._persist_locked()
                        return
                    pending_refs = list(state.pending_metadata_refs)
                    next_url = state.discovery_next_url
                if pending_refs:
                    for ref in pending_refs:
                        self._inspect_and_add_ref(batch_id, ref)
                        with self._lock:
                            state = self._get_state_locked(batch_id)
                            state.pending_metadata_refs = [item for item in state.pending_metadata_refs if item.get("url") != ref.get("url")]
                            self._persist_locked()
                            if state.session_required:
                                state.phase = "waiting_for_session"
                                return
                    continue
                with self._lock:
                    state = self._get_state_locked(batch_id)
                    if not next_url or state.discovery_pages_checked >= state.max_archive_pages:
                        break
                html = self._fetch_html(batch_id, next_url, JOBNIB_DISCOVERY_INTERVAL)
                soup = BeautifulSoup(html, "html.parser")
                refs = extract_homepage_story_refs(soup)
                # The homepage is the complete live discovery source. Never
                # follow Jobnib's deleted/broken archive pagination links.
                next_page = ""
                with self._lock:
                    state = self._get_state_locked(batch_id)
                    state.discovery_pages_checked += 1
                    state.discovery_next_url = next_page or ""
                    known_urls = {row.url for row in state.rows}
                    state.pending_metadata_refs = [ref for ref in refs if ref["url"] not in known_urls]
                    self._persist_locked()
                for ref in refs:
                    with self._lock:
                        state = self._get_state_locked(batch_id)
                        if ref["url"] in known_urls:
                            state.duplicate_count += 1
                            continue
                        state.archive_found_count += 1
                        known_urls.add(ref["url"])
                    self._inspect_and_add_ref(batch_id, ref)
                    with self._lock:
                        state = self._get_state_locked(batch_id)
                        state.pending_metadata_refs = [item for item in state.pending_metadata_refs if item.get("url") != ref.get("url")]
                        self._persist_locked()
                        if state.session_required:
                            state.phase = "waiting_for_session"
                            return
                with self._lock:
                    state = self._get_state_locked(batch_id)
                    state.add_log(
                        f"Homepage scan: found {state.archive_found_count}, "
                        f"eligible {state.completed_eligible_count + state.ongoing_eligible_count}."
                    )
                    self._persist_locked()
                if not next_page:
                    break
            self._finish_discovery(batch_id)
        except JobnibSessionRequired as exc:
            self._mark_batch_session_required(batch_id, str(exc), "Discovery needs a refreshed Jobnib session.")
        except Exception as exc:
            logger.exception("Jobnib discovery failed")
            with self._lock:
                state = self._batches.get(batch_id)
                if state:
                    state.phase = "failed"
                    state.error_message = str(exc)
                    state.finished_at = now_string()
                    state.add_log(f"Discovery failed: {exc}")
                    self._persist_locked()

    def _run_import_inspection(self, batch_id: str, refs: list[dict[str, str]]) -> None:
        try:
            for ref in refs:
                with self._lock:
                    state = self._get_state_locked(batch_id)
                    if state.cancel_requested:
                        break
                    state.archive_found_count += 1
                self._inspect_and_add_ref(batch_id, ref)
            self._finish_discovery(batch_id)
        except JobnibSessionRequired as exc:
            self._mark_batch_session_required(batch_id, str(exc), "Imported catalog inspection needs a refreshed session.")
        except Exception as exc:
            with self._lock:
                state = self._get_state_locked(batch_id)
                state.phase = "failed"
                state.error_message = str(exc)
                state.add_log(f"Import inspection failed: {exc}")
                self._persist_locked()

    def _inspect_and_add_ref(
        self,
        batch_id: str,
        ref: dict[str, str],
        *,
        respect_scope: bool = True,
    ) -> None:
        try:
            html = self._fetch_html(batch_id, ref["url"], JOBNIB_DISCOVERY_INTERVAL)
            soup = BeautifulSoup(html, "html.parser")
            spider = JobnibSpider(novel=ref["url"], limit=1)
            metadata = spider._extract_story_metadata(soup, ref["url"])
            status = extract_jobnib_status(soup)
            title = metadata.get("title") or ref.get("title") or ref["story_id"].replace("-", " ").title()
            status_kind = normalize_story_status(status)
            with self._lock:
                scope = self._get_state_locked(batch_id).story_status_scope
            if status_kind == "unknown" or (respect_scope and scope != "all" and status_kind != scope):
                with self._lock:
                    state = self._get_state_locked(batch_id)
                    state.excluded_count += 1
                return
            chapters = spider._collect_chapter_links(soup, ref["url"])
            row = JobnibBatchRow(
                index=0,
                title=title,
                url=ref["url"],
                story_id=ref["story_id"],
                completion_status=status,
                total_chapters=len(chapters) or None,
            )
            with self._lock:
                state = self._get_state_locked(batch_id)
                if any(existing.url == row.url for existing in state.rows):
                    state.duplicate_count += 1
                    return
                row.index = len(state.rows) + 1
                state.rows.append(row)
                try:
                    self._save_chapter_manifest(row, chapters, metadata=metadata, status=status)
                except Exception:
                    # Manifest validation is part of inserting a discovered
                    # story. Roll the row back so the error handler below does
                    # not leave both a ready row and a failed duplicate.
                    state.rows.pop()
                    raise
                if status_kind == "completed":
                    state.completed_eligible_count += 1
                else:
                    state.ongoing_eligible_count += 1
                state.consecutive_session_challenges = 0
                self._persist_locked()
        except JobnibSessionRequired:
            self._add_challenged_row(batch_id, ref, "Jobnib session challenge during metadata inspection.")
        except Exception as exc:
            with self._lock:
                state = self._get_state_locked(batch_id)
                state.metadata_failed_count += 1
                row = JobnibBatchRow(
                    index=len(state.rows) + 1,
                    title=ref.get("title") or ref["story_id"].replace("-", " ").title(),
                    url=ref["url"],
                    story_id=ref["story_id"],
                    status="failed",
                    error=f"Metadata inspection failed: {exc}",
                )
                state.rows.append(row)

    def _finish_discovery(self, batch_id: str) -> None:
        with self._lock:
            state = self._get_state_locked(batch_id)
            crawlable = any(row.status in {"discovered", "queued"} for row in state.rows)
            state.phase = "ready" if crawlable else ("waiting_for_session" if any(row.status == "needs_session" for row in state.rows) else "completed")
            state.finished_at = now_string() if not state.rows else None
            state.discovery_next_url = ""
            state.add_log(
                f"Discovery finished: {state.completed_eligible_count} completed, "
                f"{state.ongoing_eligible_count} ongoing, {state.excluded_count} excluded, "
                f"{state.metadata_failed_count} metadata failure(s)."
            )
            state.add_log("Ready for browser-assisted capture. Select a story before creating a pairing.")
            self._persist_locked()

    def _run_crawl(self, batch_id: str, run_id: str) -> None:
        with self._lock:
            state = self._get_state_locked(batch_id)
            pending = [row.index for row in state.rows if row.status == "queued" and row.crawl_run_id == run_id]
            workers = int(MODE_PRESETS[state.mode]["story_workers"])
        pending_lock = threading.Lock()

        def take_row() -> JobnibBatchRow | None:
            with self._lock:
                current = self._batches.get(batch_id)
                if not current or current.cancel_requested or current.session_required:
                    return None
            with pending_lock:
                if not pending:
                    return None
                index = pending.pop(0)
            with self._lock:
                current = self._get_state_locked(batch_id)
                return current.rows[index - 1]

        def worker() -> None:
            while True:
                row = take_row()
                if row is None:
                    return
                with self._lock:
                    row.status = "crawling"
                    row.error = ""
                    self._persist_locked()
                update = self._crawl_one(batch_id, row)
                with self._lock:
                    state = self._get_state_locked(batch_id)
                    stored = state.rows[row.index - 1]
                    for key, value in update.items():
                        setattr(stored, key, value)
                    if stored.status == "completed":
                        stored.completed_at = stored.completed_at or now_string()
                        stored.retry_priority = 0
                        state.consecutive_session_challenges = 0
                        self._record_exported_story(stored)
                    elif stored.status == "needs_session":
                        state.challenged_count += 1
                        state.consecutive_session_challenges += 1
                        state.last_session_error = stored.error
                        if state.consecutive_session_challenges >= 3:
                            state.session_required = True
                            state.add_log("Jobnib session circuit breaker opened after three consecutive challenges.")
                    self._persist_locked()

        try:
            with ThreadPoolExecutor(max_workers=min(workers, max(1, len(pending))), thread_name_prefix="jobnib-batch") as pool:
                futures = [pool.submit(worker) for _ in range(min(workers, max(1, len(pending))))]
                for future in as_completed(futures):
                    future.result()
        finally:
            with self._lock:
                state = self._get_state_locked(batch_id)
                for row in state.rows:
                    if row.status == "crawling" and row.crawl_run_id == run_id:
                        row.status = "queued"
                if state.cancel_requested:
                    state.phase = "ready"
                    run_status = "paused"
                elif state.session_required or any(row.status == "needs_session" for row in state.rows):
                    state.phase = "waiting_for_session"
                    run_status = "waiting_for_session"
                elif any(row.status in {"queued", "discovered"} for row in state.rows):
                    state.phase = "ready"
                    run_status = "completed"
                else:
                    state.phase = "completed"
                    state.finished_at = now_string()
                    run_status = "completed"
                state.cancel_requested = False
                self._finish_run_locked(state, run_id, run_status)
                state.add_log(f"Crawl run {run_id} finished with status {run_status}.")
                self._persist_locked()
            self._schedule_archive(batch_id)

    def _crawl_one(self, batch_id: str, row: JobnibBatchRow) -> dict[str, Any]:
        spider = JobnibSpider(novel=row.url, limit=100000)
        spider._browser_lock = self._browser_lock
        spider._get_browser = self._get_shared_browser  # type: ignore[method-assign]
        checkpoint: list[dict[str, Any]] = []
        try:
            self._pace(batch_id)
            story_html = spider._fetch_page_html(row.url)
            story_soup = BeautifulSoup(story_html, "html.parser")
            status = extract_jobnib_status(story_soup)
            if status.lower() != "completed":
                return {"status": "skipped", "completion_status": status or "Unknown", "error": "Story is not completed."}
            metadata = spider._extract_story_metadata(story_soup, row.url)
            chapter_links = spider._collect_chapter_links(story_soup, row.url)
            if not chapter_links:
                return {"status": "skipped", "total_chapters": 0, "crawled_chapters": 0, "error": "No Jobnib chapter list found."}
            self._save_chapter_manifest(row, chapter_links, metadata=metadata, status=status)
            checkpoint = self._load_checkpoint(row, chapter_links)
            by_url = {item["url"]: item for item in checkpoint}
            self._update_progress(batch_id, row.index, total_chapters=len(chapter_links), crawled_chapters=len(checkpoint))
            if checkpoint:
                self._log(batch_id, f"{row.title}: resumed at {len(checkpoint)}/{len(chapter_links)} full chapter(s).")
            for ref in chapter_links:
                if self._is_cancelled(batch_id):
                    return {"status": "queued", "total_chapters": len(chapter_links), "crawled_chapters": len(checkpoint), "error": ""}
                if ref["url"] in by_url:
                    continue
                self._pace(batch_id)
                chapter = spider._crawl_chapter(ref, include_metadata=False)
                if chapter is None:
                    raise RuntimeError(f"Jobnib returned no chapter for {ref['url']}")
                cleaned = clean_chapter_content(chapter.content, spider._promo_patterns).strip()
                if len(cleaned.split()) < JOBNIB_MIN_CHAPTER_WORDS or contains_locked_markers(cleaned):
                    raise JobnibSessionRequired(
                        f"Chapter {ref.get('displayed_chapter_number') or ref['sequence_index']} did not unlock completely."
                    )
                item = {
                    "sequence_index": int(ref["sequence_index"]),
                    "displayed_chapter_number": ref.get("displayed_chapter_number"),
                    "volume_label": ref.get("volume_label") or "",
                    "title": chapter.title or ref.get("title") or f"Chapter {ref['sequence_index']}",
                    "content": cleaned,
                    "url": ref["url"],
                    "checksum": hashlib.sha256(cleaned.encode("utf-8")).hexdigest(),
                }
                checkpoint.append(item)
                checkpoint.sort(key=lambda value: int(value["sequence_index"]))
                by_url[item["url"]] = item
                self._save_checkpoint(row, checkpoint)
                self._update_progress(batch_id, row.index, crawled_chapters=len(checkpoint))
                if len(checkpoint) == 1 or len(checkpoint) % 20 == 0 or len(checkpoint) == len(chapter_links):
                    self._log(batch_id, f"{row.title}: crawled {len(checkpoint)}/{len(chapter_links)} full chapter(s).")
            if len(checkpoint) != len(chapter_links):
                raise RuntimeError(f"Only {len(checkpoint)}/{len(chapter_links)} chapters passed full-content validation.")
            return self._write_story_output(row, metadata, status, checkpoint)
        except Exception as exc:
            return classify_jobnib_error(jobnib_exception_message(exc), len(checkpoint), row.total_chapters)

    def _write_story_output(
        self,
        row: JobnibBatchRow,
        metadata: dict[str, Any],
        status: str,
        chapters: list[dict[str, Any]],
    ) -> dict[str, Any]:
        title = str(metadata.get("title") or row.title)
        output_dir = Path(self._get_state(row).output_dir).resolve()
        source_status = "Ongoing" if normalize_story_status(status) == "ongoing" else "Completed"
        folder = Path(source_status) / f"DONE_{sanitize_filename(title)}_jn"
        story_dir = (output_dir / folder).resolve()
        if not story_dir.is_relative_to(output_dir):
            raise RuntimeError("Unsafe Jobnib output path.")
        story_dir.mkdir(parents=True, exist_ok=True)
        filename = f"Jobnib_{sanitize_filename(title)}_{source_status}_jn.md"
        markdown_path = story_dir / filename
        markdown_path.write_text(format_jobnib_markdown(title, row.url, chapters), encoding="utf-8")
        info = {
            "title": title,
            "author": row.author,
            "status": status,
            "source_url": row.url,
            "story_id": row.story_id,
            "chapters": len(chapters),
            "description": metadata.get("description"),
            "cover_url": metadata.get("cover_url"),
            "source_suffix": "jn",
        }
        info_path = story_dir / "info.json"
        info_path.write_text(json.dumps(info, ensure_ascii=False, indent=2), encoding="utf-8")
        self._checkpoint_path(row).unlink(missing_ok=True)
        return {
            "status": "completed",
            "title": title,
            "completion_status": status,
            "total_chapters": len(chapters),
            "crawled_chapters": len(chapters),
            "output_file": str(folder / filename).replace("\\", "/"),
            "metadata_file": str(folder / "info.json").replace("\\", "/"),
            "error": "",
        }

    def _fetch_html(self, batch_id: str, url: str, interval: float) -> str:
        last_error: Exception | None = None
        for attempt in range(3):
            try:
                self._pace(batch_id, interval)
                cookies, user_agent = load_jobnib_cookies()
                session = requests.Session()
                session.headers.update(jobnib_headers(user_agent))
                proxies = requests_proxies("jobnib")
                if proxies:
                    session.proxies.update(proxies)
                for cookie in cookies:
                    session.cookies.set(cookie["name"], cookie["value"], domain=cookie["domain"], path=cookie["path"])
                started = time.monotonic()
                response = session.get(url, timeout=45)
                elapsed = time.monotonic() - started
                with self._lock:
                    state = self._get_state_locked(batch_id)
                    state.request_total += 1
                    state.request_latency_total_seconds += elapsed
                if response.status_code in {403, 503} and is_jobnib_challenge(response.text):
                    rendered = self._fetch_with_shared_browser(url)
                    if is_jobnib_challenge(rendered):
                        raise JobnibSessionRequired("Jobnib returned a Cloudflare session challenge.")
                    with self._lock:
                        state = self._get_state_locked(batch_id)
                        state.completed_request_total += 1
                        state.consecutive_session_challenges = 0
                    return rendered
                if response.status_code in {429, 500, 502, 503, 504}:
                    raise RuntimeError(f"Jobnib returned HTTP {response.status_code}")
                response.raise_for_status()
                if is_jobnib_challenge(response.text):
                    rendered = self._fetch_with_shared_browser(url)
                    if is_jobnib_challenge(rendered):
                        raise JobnibSessionRequired("Jobnib returned a Cloudflare session challenge.")
                    with self._lock:
                        state = self._get_state_locked(batch_id)
                        state.completed_request_total += 1
                        state.consecutive_session_challenges = 0
                    return rendered
                with self._lock:
                    state = self._get_state_locked(batch_id)
                    state.completed_request_total += 1
                    state.consecutive_session_challenges = 0
                return response.text
            except JobnibSessionRequired:
                raise
            except Exception as exc:
                last_error = exc
                if attempt < 2:
                    cooldown = min(30.0, 5.0 * (2 ** attempt))
                    with self._lock:
                        state = self._get_state_locked(batch_id)
                        state.rate_limit_events += 1
                        state.cooldown_until = time.time() + cooldown
                    time.sleep(cooldown)
        raise RuntimeError(str(last_error or "Jobnib request failed"))

    def _pace(self, batch_id: str, interval: float | None = None) -> None:
        with self._lock:
            state = self._get_state_locked(batch_id)
            selected = float(MODE_PRESETS[state.mode]["request_interval"])
            cooldown = max(0.0, state.cooldown_until - time.time())
        wait_interval = selected if interval is None else max(selected, interval)
        if cooldown:
            time.sleep(cooldown)
        with self._request_start_lock:
            wait = wait_interval - (time.monotonic() - self._last_request_at)
            if wait > 0:
                time.sleep(wait)
            self._last_request_at = time.monotonic()

    def _get_shared_browser(self) -> _JobnibBrowser:
        with self._browser_lock:
            if self._shared_browser is None:
                self._shared_browser = _JobnibBrowser(logger=logger)
            return self._shared_browser

    def _fetch_with_shared_browser(self, url: str) -> str:
        """Serialize every rendered fallback through one persistent Chromium profile."""
        with self._browser_lock:
            return self._get_shared_browser().fetch_page(url, timeout=90)

    def _add_challenged_row(self, batch_id: str, ref: dict[str, str], message: str) -> None:
        with self._lock:
            self._session_verified_at = ""
            state = self._get_state_locked(batch_id)
            if any(row.url == ref["url"] for row in state.rows):
                return
            state.rows.append(JobnibBatchRow(
                index=len(state.rows) + 1,
                title=ref.get("title") or ref["story_id"].replace("-", " ").title(),
                url=ref["url"],
                story_id=ref["story_id"],
                status="needs_session",
                error=message,
            ))
            state.challenged_count += 1
            state.consecutive_session_challenges += 1
            state.last_session_error = message
            if state.consecutive_session_challenges >= 3:
                state.session_required = True
                state.add_log("Jobnib session circuit breaker opened after three consecutive challenges.")
            self._persist_locked()

    def _mark_batch_session_required(self, batch_id: str, error: str, log_message: str) -> None:
        with self._lock:
            self._session_verified_at = ""
            state = self._get_state_locked(batch_id)
            state.phase = "waiting_for_session"
            state.session_required = True
            state.last_session_error = error
            state.add_log(log_message)
            self._persist_locked()

    def _retry_rows(self, batch_id: str, status: RowStatus, row_index: int | None) -> JobnibBatchState:
        with self._lock:
            state = self._get_state_locked(batch_id)
            if state.phase in {"discovering", "crawling"}:
                raise ValueError("Pause the active Jobnib batch before retrying rows.")
            candidates = [row for row in state.rows if row.status == status and (row_index is None or row.index == row_index)]
            if not candidates:
                raise ValueError(f"This Jobnib batch has no {status.replace('_', ' ')} rows to retry.")
            priority = max((row.retry_priority for row in state.rows), default=0) + 1
            for offset, row in enumerate(candidates):
                row.status = "queued"
                row.retry_priority = priority + offset
                row.error = ""
                row.crawl_run_id = ""
            state.phase = "ready"
            state.finished_at = None
            state.add_log(f"Queued {len(candidates)} {status.replace('_', ' ')} row(s) for retry.")
            self._persist_locked()
            return state

    def _update_progress(self, batch_id: str, row_index: int, **updates: Any) -> None:
        with self._lock:
            state = self._get_state_locked(batch_id)
            row = state.rows[row_index - 1]
            for key, value in updates.items():
                setattr(row, key, value)
            self._persist_locked()

    def _log(self, batch_id: str, message: str) -> None:
        with self._lock:
            state = self._get_state_locked(batch_id)
            state.add_log(message)
            self._persist_locked()

    def _is_cancelled(self, batch_id: str) -> bool:
        with self._lock:
            state = self._batches.get(batch_id)
            return bool(state and (state.cancel_requested or state.session_required))

    def _checkpoint_path(self, row: JobnibBatchRow) -> Path:
        state = self._get_state(row)
        path = Path(state.output_dir) / ".checkpoints"
        path.mkdir(parents=True, exist_ok=True)
        return path / f"{row.index:06d}_{sanitize_filename(row.story_id)}.json"

    def _chapter_manifest_path(self, row: JobnibBatchRow) -> Path:
        state = self._get_state(row)
        path = Path(state.output_dir) / ".manifests"
        path.mkdir(parents=True, exist_ok=True)
        return path / f"{row.index:06d}_{sanitize_filename(row.story_id)}.json"

    def _save_chapter_manifest(
        self,
        row: JobnibBatchRow,
        chapters: list[dict[str, Any]],
        *,
        metadata: dict[str, Any] | None = None,
        status: str = "Completed",
    ) -> None:
        normalized: list[dict[str, Any]] = []
        for position, raw in enumerate(chapters, start=1):
            if not isinstance(raw, dict) or not raw.get("url"):
                continue
            item = dict(raw)
            item["sequence_index"] = int(item.get("sequence_index") or item.get("chapter_number") or position)
            item["url"] = normalize_capture_chapter_url(str(item["url"]))
            normalized.append(item)
        normalized.sort(key=lambda item: int(item["sequence_index"]))
        atomic_write_json(self._chapter_manifest_path(row), {
            "story_id": row.story_id,
            "source_url": row.url,
            "status": status or row.completion_status or "Completed",
            "metadata": metadata or {"title": row.title},
            "updated_at": now_string(),
            "chapters": normalized,
        })

    def _load_chapter_manifest(self, row: JobnibBatchRow) -> dict[str, Any] | None:
        path = self._chapter_manifest_path(row)
        if not path.exists():
            return None
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            chapters = payload.get("chapters") if isinstance(payload, dict) else None
            if not isinstance(chapters, list) or not chapters:
                return None
            normalized: list[dict[str, Any]] = []
            for position, raw in enumerate(chapters, start=1):
                if not isinstance(raw, dict) or not raw.get("url"):
                    return None
                item = dict(raw)
                item["sequence_index"] = int(item.get("sequence_index") or item.get("chapter_number") or position)
                item["url"] = normalize_capture_chapter_url(str(item["url"]))
                normalized.append(item)
            payload["chapters"] = sorted(normalized, key=lambda item: int(item["sequence_index"]))
            return payload
        except Exception as exc:
            logger.warning("Ignoring invalid Jobnib chapter manifest %s: %s", path, exc)
            return None

    def _ensure_chapter_manifest(self, batch_id: str, row: JobnibBatchRow) -> dict[str, Any]:
        manifest = self._load_chapter_manifest(row)
        if manifest is not None:
            return manifest

        html = self._fetch_html(batch_id, row.url, JOBNIB_DISCOVERY_INTERVAL)
        soup = BeautifulSoup(html, "html.parser")
        status = extract_jobnib_status(soup)
        if normalize_story_status(status) == "unknown":
            raise ValueError("The Jobnib story status is neither completed nor ongoing.")
        spider = JobnibSpider(novel=row.url, limit=1)
        metadata = spider._extract_story_metadata(soup, row.url)
        chapters = spider._collect_chapter_links(soup, row.url)
        if not chapters:
            raise ValueError("No Jobnib chapter list was found for browser-assisted capture.")
        self._save_chapter_manifest(row, chapters, metadata=metadata, status=status)
        with self._lock:
            stored = self._get_state_locked(batch_id).rows[row.index - 1]
            stored.total_chapters = len(chapters)
            self._persist_locked()
        return self._load_chapter_manifest(row) or {
            "status": status,
            "metadata": metadata,
            "chapters": chapters,
        }

    def _finalize_browser_capture_row(
        self,
        batch_id: str,
        row: JobnibBatchRow,
        manifest: dict[str, Any],
        checkpoint: list[dict[str, Any]],
    ) -> None:
        update = self._write_story_output(
            row,
            dict(manifest.get("metadata") or {"title": row.title}),
            str(manifest.get("status") or row.completion_status or "Completed"),
            checkpoint,
        )
        with self._lock:
            state = self._get_state_locked(batch_id)
            stored = state.rows[row.index - 1]
            for key, value in update.items():
                setattr(stored, key, value)
            stored.completed_at = stored.completed_at or now_string()
            stored.retry_priority = 0
            state.consecutive_session_challenges = 0
            state.last_session_error = ""
            self._record_exported_story(stored)
            if any(item.status == "needs_session" for item in state.rows):
                state.phase = "waiting_for_session"
                state.session_required = True
            elif any(item.status in {"queued", "discovered", "failed"} for item in state.rows):
                state.phase = "ready"
                state.session_required = False
            else:
                state.phase = "completed"
                state.session_required = False
                state.finished_at = now_string()
            state.add_log(f"{stored.title}: browser-assisted full-story capture completed.")
            self._persist_locked()

    def _get_state(self, row: JobnibBatchRow) -> JobnibBatchState:
        with self._lock:
            for state in self._batches.values():
                if 0 < row.index <= len(state.rows) and state.rows[row.index - 1] is row:
                    return state
        raise RuntimeError("Jobnib batch row is detached from its state.")

    def _load_checkpoint(self, row: JobnibBatchRow, links: list[dict[str, Any]]) -> list[dict[str, Any]]:
        path = self._checkpoint_path(row)
        if not path.exists():
            return []
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            allowed = {link["url"] for link in links}
            items = [
                item for item in data.get("chapters", [])
                if isinstance(item, dict) and item.get("url") in allowed and item.get("content")
            ]
            return sorted(items, key=lambda item: int(item.get("sequence_index") or 0))
        except Exception as exc:
            logger.warning("Ignoring invalid Jobnib checkpoint %s: %s", path, exc)
            return []

    def _save_checkpoint(self, row: JobnibBatchRow, chapters: list[dict[str, Any]]) -> None:
        atomic_write_json(self._checkpoint_path(row), {
            "story_id": row.story_id,
            "source_url": row.url,
            "updated_at": now_string(),
            "chapters": chapters,
        })

    def _summary_locked(self, state: JobnibBatchState) -> dict[str, Any]:
        rows = deduplicate_story_rows(state.rows)
        total = len(rows)
        completed = sum(row.status == "completed" for row in rows)
        skipped = sum(row.status == "skipped" for row in rows)
        failed = sum(row.status == "failed" for row in rows)
        needs_session = sum(row.status == "needs_session" for row in rows)
        processed = completed + skipped + failed
        total_chapters = sum(int(row.total_chapters or 0) for row in rows)
        crawled_chapters = sum(int(row.crawled_chapters or 0) for row in rows)
        started = parse_local_datetime(state.started_at)
        elapsed = max(0.0, (datetime.now() - started).total_seconds()) if started else 0.0
        preset = MODE_PRESETS[state.mode]
        average_latency = state.request_latency_total_seconds / state.completed_request_total if state.completed_request_total else None
        return {
            "batch_id": state.batch_id,
            "batch_name": state.batch_name,
            "phase": state.phase,
            "mode": state.mode,
            "story_status_scope": state.story_status_scope,
            "total_stories": total,
            "discovered_count": total,
            "completed_count": completed,
            "skipped_count": skipped,
            "failed_count": failed,
            "needs_session_count": needs_session,
            "processed_count": processed,
            "total_chapters": total_chapters,
            "crawled_chapters": crawled_chapters,
            "crawl_estimate": estimate_progress(
                total_stories=total,
                processed_stories=processed,
                known_total_chapters=total_chapters,
                crawled_chapters=crawled_chapters,
                elapsed_seconds=elapsed,
            ),
            "rate_limit": {
                "events": state.rate_limit_events,
                "total": state.rate_limit_events,
                "request_interval_seconds": preset["request_interval"],
                "cooldown_remaining_seconds": max(0, state.cooldown_until - time.time()),
                "in_flight_requests": 0,
                "max_in_flight_requests": preset["request_slots"],
                "configured_max_in_flight_requests": preset["request_slots"],
                "request_total": state.request_total,
                "completed_request_total": state.completed_request_total,
                "average_request_latency_seconds": average_latency,
            },
            "discovery": {
                "archive_pages_checked": state.discovery_pages_checked,
                "archive_found": state.archive_found_count,
                "completed_eligible": state.completed_eligible_count,
                "ongoing_eligible": state.ongoing_eligible_count,
                "eligible": state.completed_eligible_count + state.ongoing_eligible_count,
                "excluded": state.excluded_count,
                "duplicates": state.duplicate_count,
                "metadata_failed": state.metadata_failed_count,
                "challenged": state.challenged_count,
                "next_url": state.discovery_next_url,
            },
            "session": {
                "required": state.session_required,
                "consecutive_challenges": state.consecutive_session_challenges,
                "last_error": state.last_session_error,
                "verified_at": state.session_verified_at,
            },
            "download_ready": crawled_chapters > 0,
            "error_message": state.error_message,
            "created_at": state.created_at,
            "started_at": state.started_at,
            "finished_at": state.finished_at,
            "max_archive_pages": state.max_archive_pages,
            "max_stories_per_run": state.max_stories_per_run,
            "crawl_runs": self._run_summaries_locked(state),
            "cancel_requested": state.cancel_requested,
            "log_lines": state.log_lines[-180:],
        }

    def _run_summaries_locked(self, state: JobnibBatchState) -> list[dict[str, Any]]:
        values = []
        for stored in state.crawl_runs[-20:]:
            run = dict(stored)
            rows = [row for row in state.rows if row.crawl_run_id == run.get("run_id")]
            run.update({
                "completed_count": sum(row.status == "completed" for row in rows),
                "failed_count": sum(row.status == "failed" for row in rows),
                "skipped_count": sum(row.status == "skipped" for row in rows),
                "needs_session_count": sum(row.status == "needs_session" for row in rows),
                "processed_count": sum(row.status in {"completed", "failed", "skipped"} for row in rows),
                "crawled_chapters": sum(int(row.crawled_chapters or 0) for row in rows),
                "total_chapters": sum(int(row.total_chapters or 0) for row in rows),
            })
            values.append(run)
        return list(reversed(values))

    def _finish_run_locked(self, state: JobnibBatchState, run_id: str, status: str) -> None:
        for run in state.crawl_runs:
            if run.get("run_id") == run_id:
                run["status"] = status
                run["finished_at"] = now_string()
                break

    def _record_exported_story(self, row: JobnibBatchRow) -> None:
        data = self._load_exported_index()
        data[row.story_id] = {"story_id": row.story_id, "url": row.url, "title": row.title, "exported_at": now_string()}
        atomic_write_json(self._exported_index_file, data)

    def _load_exported_index(self) -> dict[str, Any]:
        try:
            data = json.loads(self._exported_index_file.read_text(encoding="utf-8"))
            return data if isinstance(data, dict) else {}
        except Exception:
            return {}

    def _schedule_archive(self, batch_id: str) -> None:
        if JOBNIB_ARCHIVE_DELAY <= 0:
            return
        with self._lock:
            old = self._archive_timers.pop(batch_id, None)
            if old:
                old.cancel()
            timer = threading.Timer(JOBNIB_ARCHIVE_DELAY, self._prepare_archive_safely, args=(batch_id,))
            timer.daemon = True
            self._archive_timers[batch_id] = timer
            timer.start()

    def _prepare_archive_safely(self, batch_id: str) -> None:
        try:
            self.prepare_archive(batch_id)
        except (FileNotFoundError, KeyError, ValueError):
            pass
        except Exception as exc:
            logger.warning("Jobnib archive preparation failed: %s", exc)

    def _prepare_output_dir(self, batch_id: str) -> Path:
        path = (self._batch_root / batch_id).resolve()
        if not path.is_relative_to(self._batch_root):
            raise ValueError("Unsafe Jobnib batch path.")
        path.mkdir(parents=True, exist_ok=True)
        return path

    def _get_state_locked(self, batch_id: str) -> JobnibBatchState:
        if not validate_batch_id(batch_id):
            raise KeyError("Invalid batch identifier.")
        state = self._batches.get(batch_id)
        if not state:
            raise KeyError(f"Jobnib batch '{batch_id}' was not found.")
        return state

    def _load_index(self) -> list[str]:
        try:
            payload = json.loads(self._index_file.read_text(encoding="utf-8"))
        except Exception:
            return []
        resume: list[str] = []
        for raw in payload.get("batches", []) if isinstance(payload, dict) else []:
            if not isinstance(raw, dict) or not validate_batch_id(str(raw.get("batch_id") or "")):
                continue
            rows = [construct_dataclass(JobnibBatchRow, item) for item in raw.get("rows", []) if isinstance(item, dict)]
            raw = dict(raw)
            raw["rows"] = rows
            state = construct_dataclass(JobnibBatchState, raw)
            for row in state.rows:
                if row.status == "crawling":
                    row.status = "queued"
            if state.phase == "crawling":
                state.phase = "waiting_for_session" if state.session_required else "ready"
            elif state.phase == "discovering" and (state.discovery_next_url or state.pending_metadata_refs):
                state.cancel_requested = False
                resume.append(state.batch_id)
            self._batches[state.batch_id] = state
        return resume

    def _persist_locked(self) -> None:
        atomic_write_json(self._index_file, {"batches": [asdict(state) for state in self._batches.values()]})


def construct_dataclass(cls, raw: dict[str, Any]):
    allowed = {item.name for item in fields(cls)}
    return cls(**{key: value for key, value in raw.items() if key in allowed})


def deduplicate_story_rows(rows: list[JobnibBatchRow]) -> list[JobnibBatchRow]:
    """Hide stale duplicate rows created by pre-fix manifest failures."""
    preferred: dict[str, JobnibBatchRow] = {}
    status_rank = {
        "completed": 6,
        "crawling": 5,
        "queued": 4,
        "discovered": 3,
        "needs_session": 2,
        "skipped": 1,
        "failed": 0,
    }
    for row in rows:
        key = row.url or f"index:{row.index}"
        existing = preferred.get(key)
        if existing is None or status_rank.get(row.status, 0) > status_rank.get(existing.status, 0):
            preferred[key] = row
    return sorted(preferred.values(), key=lambda row: row.index)


def normalize_mode(mode: str) -> CrawlMode:
    return "fast" if str(mode).lower() == "fast" else "slow"


def normalize_discovery_scope(value: str) -> DiscoveryScope:
    normalized = str(value or "completed").strip().lower()
    if normalized not in {"completed", "ongoing", "all"}:
        raise ValueError("Jobnib discovery status must be completed, ongoing, or all.")
    return cast(DiscoveryScope, normalized)


def normalize_story_status(value: str) -> Literal["completed", "ongoing", "unknown"]:
    normalized = clean_text(str(value or "")).lower()
    if normalized in {"completed", "complete", "finished"}:
        return "completed"
    if normalized in {"ongoing", "updating", "serializing", "in progress", "in-progress"}:
        return "ongoing"
    return "unknown"


def now_string() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def extract_jobnib_status(soup: BeautifulSoup) -> str:
    element = soup.select_one(".sertostat, .status")
    return clean_text(element.get_text(" ", strip=True)) if element else ""


def extract_homepage_story_refs(soup: BeautifulSoup) -> list[dict[str, str]]:
    """Return unique story cards from Jobnib's current homepage.

    The page renders each story several times (cover grid, ranked list and Read
    button). Ranked-list titles are preferred because cover links include the
    numeric rating in their accessible text.
    """
    values: dict[str, dict[str, str | int]] = {}
    for anchor in soup.select("a[href*='/book/']"):
        href = str(anchor.get("href") or "")
        try:
            url = normalize_story_url(href)
        except ValueError:
            continue
        path = urllib.parse.urlparse(url).path
        slug = path.rstrip("/").split("/")[-1]
        if slug == "list-mode" or JOBNIB_CHAPTER_SLUG_RE.search(slug):
            continue
        title = clean_text(anchor.get_text(" ", strip=True))
        if title.lower() in {"read", "text mode"}:
            title = ""
        preferred_title = anchor.find_parent(class_="jn-list-title") is not None
        priority = 2 if preferred_title else 1
        if "jn-cover-link" in (anchor.get("class") or []):
            title = re.sub(r"^\d+(?:\.\d+)?\s+", "", title)
        current = values.setdefault(url, {"url": url, "story_id": slug, "title": "", "priority": 0})
        if title and (priority > int(current["priority"]) or (priority == int(current["priority"]) and len(title) > len(str(current["title"])))):
            current["title"] = title
            current["priority"] = priority
    return [
        {"url": str(value["url"]), "story_id": str(value["story_id"]), "title": str(value["title"])}
        for value in values.values()
    ]


def normalize_story_url(value: str) -> str:
    url = normalize_jobnib_url(urllib.parse.urljoin("https://jobnib.com", value))
    parsed = urllib.parse.urlparse(url)
    if not re.fullmatch(r"/book/[^/?#]+/?", parsed.path, re.IGNORECASE):
        raise ValueError("Jobnib imports must be story URLs under /book/.")
    slug = parsed.path.rstrip("/").split("/")[-1]
    if JOBNIB_CHAPTER_SLUG_RE.search(slug):
        raise ValueError("Import the Jobnib story page, not an individual chapter.")
    return urllib.parse.urlunparse(("https", "jobnib.com", parsed.path.rstrip("/"), "", "", ""))


def normalize_capture_chapter_url(value: str) -> str:
    """Canonicalize a Jobnib chapter URL used by a capture assignment."""
    url = normalize_jobnib_url(value)
    parsed = urllib.parse.urlparse(url)
    host = (parsed.hostname or "").lower()
    path = parsed.path.rstrip("/")
    if host not in {"jobnib.com", "www.jobnib.com"} or not re.fullmatch(
        r"/book/[^/?#]+-chapter-\d+(?:-\d+)?",
        path,
        re.IGNORECASE,
    ):
        raise ValueError("Browser capture accepts only canonical Jobnib chapter URLs.")
    return urllib.parse.urlunparse(("https", "jobnib.com", path, "", "", ""))


def extract_import_refs(payload: Any) -> list[dict[str, str]]:
    candidates: list[Any] = []
    if isinstance(payload, str):
        candidates.extend(re.findall(r"https?://(?:www\.)?jobnib\.com/book/[^\s,;\"']+", payload, re.IGNORECASE))
    elif isinstance(payload, list):
        candidates.extend(payload)
    elif isinstance(payload, dict):
        candidates.extend(payload.get("stories") or [])
        candidates.extend(payload.get("urls") or [])
        text = payload.get("text")
        if isinstance(text, str):
            candidates.extend(re.findall(r"https?://(?:www\.)?jobnib\.com/book/[^\s,;\"']+", text, re.IGNORECASE))
    refs: dict[str, dict[str, str]] = {}
    for item in candidates:
        url_value = item.get("url") if isinstance(item, dict) else item
        if not isinstance(url_value, str):
            continue
        try:
            url = normalize_story_url(url_value)
        except ValueError:
            continue
        slug = urllib.parse.urlparse(url).path.rstrip("/").split("/")[-1]
        title = clean_text(str(item.get("title") or "")) if isinstance(item, dict) else ""
        refs[url] = {"url": url, "story_id": slug, "title": title}
    return list(refs.values())[:JOBNIB_MAX_STORIES]


def classify_jobnib_error(message: str, crawled: int = 0, total: int | None = None) -> dict[str, Any]:
    lowered = (message or "").lower()
    base: dict[str, Any] = {"crawled_chapters": crawled, "total_chapters": total, "error": message}
    if any(marker in lowered for marker in (
        "cloudflare", "turnstile", "bot-detected", "preview-only", "did not unlock", "session challenge",
        "browser did not unlock", "start reading", "read part 1 to unlock",
    )):
        return {
            **base,
            "status": "needs_session",
            "error": (
                "Jobnib requires interactive Turnstile verification for full chapter content; "
                "cookies can clear the page shell but cannot replace the per-chapter browser token. "
                f"{message}"
            ),
        }
    if "http 429" in lowered or "http 503" in lowered:
        return {**base, "status": "queued", "error": "Jobnib temporarily rate-limited this story; it remains queued."}
    if "http 404" in lowered or "page not found" in lowered or "page has been deleted" in lowered:
        return {**base, "status": "skipped", "error": "Jobnib removed or unpublished this story."}
    return {**base, "status": "failed"}


def jobnib_exception_message(exc: Exception) -> str:
    """Preserve Scrapy CloseSpider.reason, whose normal string value is empty."""
    message = str(exc).strip()
    if message:
        return message
    reason = str(getattr(exc, "reason", "") or "").strip()
    return reason or type(exc).__name__


def contains_locked_markers(content: str) -> bool:
    lowered = clean_text(content).lower()
    return any(marker in lowered for marker in (
        "tap to start reading", "read part 1 to unlock", "continue to part 2", "enable javascript and cookies",
    ))


def format_jobnib_markdown(
    title: str,
    source_url: str,
    chapters: list[dict[str, Any]],
    *,
    status: str = "Completed",
    total_chapters: int | None = None,
) -> str:
    chapter_count = f"{len(chapters)} of {total_chapters}" if total_chapters else str(len(chapters))
    lines = [f"# {title}", "", f"Source: {source_url}", f"Status: {status}", f"Chapters crawled: {chapter_count}", ""]
    for chapter in sorted(chapters, key=lambda item: int(item["sequence_index"])):
        display = chapter.get("displayed_chapter_number") or chapter["sequence_index"]
        volume = f" ({chapter['volume_label']})" if chapter.get("volume_label") else ""
        lines.extend([
            "---", "", f"## Chapter {display}{volume}: {chapter['title']}", "",
            f"Source: {chapter['url']}", "", str(chapter["content"]).strip(), "",
        ])
    return "\n".join(lines).rstrip() + "\n"


def _atomic_write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(content, encoding="utf-8")
    temporary.replace(path)


def clean_text(value: str) -> str:
    return re.sub(r"[\s\u00a0]+", " ", (value or "").replace("\ufeff", " ")).strip()


_jobnib_batch_service: JobnibBatchService | None = None


def get_jobnib_batch_service() -> JobnibBatchService:
    global _jobnib_batch_service
    if _jobnib_batch_service is None:
        _jobnib_batch_service = JobnibBatchService()
    return _jobnib_batch_service
