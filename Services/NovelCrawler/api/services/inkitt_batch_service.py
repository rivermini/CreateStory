"""Inkitt free/completed genre batch export service."""

from __future__ import annotations

import json
import logging
import os
import random
import re
import shutil
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Literal

import requests
from bs4 import BeautifulSoup, Tag

from configs.base_config import load_site_config
from spiders.inkitt import InkittSpider
from utils.cleaner import build_promo_patterns, clean_chapter_content
from utils.proxy import requests_proxies
from utils.sanitize import sanitize_filename

logger = logging.getLogger(__name__)

INKITT_BATCH_MAX_PAGES = int(os.getenv("INKITT_BATCH_MAX_PAGES", "1000"))
INKITT_BATCH_MAX_STORIES = int(os.getenv("INKITT_BATCH_MAX_STORIES", "100000"))
INKITT_BATCH_MAX_DISCOVER_WORKERS = int(os.getenv("INKITT_BATCH_MAX_DISCOVER_WORKERS", "6"))
INKITT_BATCH_MAX_CRAWL_WORKERS = int(os.getenv("INKITT_BATCH_MAX_CRAWL_WORKERS", "5"))
INKITT_DISCOVER_RETRY_TIMES = int(os.getenv("INKITT_DISCOVER_RETRY_TIMES", "6"))
INKITT_DISCOVER_RETRY_BASE_SECONDS = float(os.getenv("INKITT_DISCOVER_RETRY_BASE_SECONDS", "15"))
INKITT_DISCOVER_RETRY_MAX_SECONDS = float(os.getenv("INKITT_DISCOVER_RETRY_MAX_SECONDS", "120"))
INKITT_DISCOVER_RETRY_HTTP_CODES = {429, 500, 502, 503, 504}
INKITT_RENDERED_FALLBACK = os.getenv("INKITT_RENDERED_FALLBACK", "1").strip().lower() not in {"0", "false", "no"}
INKITT_RENDERED_FALLBACK_WORDS = int(os.getenv("INKITT_RENDERED_FALLBACK_WORDS", "120"))
INKITT_RENDERED_FALLBACK_TINY_WORDS = int(os.getenv("INKITT_RENDERED_FALLBACK_TINY_WORDS", "12"))
INKITT_RENDERED_FALLBACK_SUSPICIOUS_WORDS = int(os.getenv("INKITT_RENDERED_FALLBACK_SUSPICIOUS_WORDS", "800"))
INKITT_BATCH_MEMORY_LOG_LINES = int(os.getenv("INKITT_BATCH_MEMORY_LOG_LINES", "10000"))
INKITT_PROGRESS_SAMPLE_LIMIT = int(os.getenv("INKITT_PROGRESS_SAMPLE_LIMIT", "500"))
INKITT_RECENT_ESTIMATE_SECONDS = int(os.getenv("INKITT_RECENT_ESTIMATE_SECONDS", "3600"))
INKITT_ESTIMATE_YIELD_CONFIDENCE_STORIES = int(os.getenv("INKITT_ESTIMATE_YIELD_CONFIDENCE_STORIES", "500"))

BatchPhase = Literal["discovering", "ready", "crawling", "completed", "failed"]
RowStatus = Literal["discovered", "queued", "crawling", "completed", "skipped", "failed"]


INKITT_GENRES: list[tuple[str, str]] = [
    ("action", "Action"),
    ("adventure", "Adventure"),
    ("drama", "Drama"),
    ("erotica", "Erotica"),
    ("fantasy", "Fantasy"),
    ("historical-fiction", "Historical Fiction"),
    ("horror", "Horror"),
    ("humor", "Humor"),
    ("lgbtq", "LGBTQ+"),
    ("literary-fiction", "Literary Fiction"),
    ("mystery", "Mystery"),
    ("other", "Other"),
    ("poetry", "Poetry"),
    ("romance", "Romance"),
    ("scifi", "Scifi"),
    ("thriller", "Thriller"),
    ("young-adult", "Young Adult"),
]


@dataclass
class InkittBatchRow:
    index: int
    genre: str
    genre_slug: str
    title: str
    url: str
    story_id: str
    author: str = ""
    status: RowStatus = "discovered"
    retry_priority: int = 0
    completion_status: str = "Complete"
    total_chapters: int | None = None
    crawled_chapters: int = 0
    rating: float | None = None
    review_count: int | None = None
    read_count: int | None = None
    output_file: str = ""
    metadata_file: str = ""
    crawl_run_id: str = ""
    completed_at: str = ""
    error: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class InkittDiscoveryResult:
    refs: list[dict[str, Any]]
    start_page: int = 1
    pages_checked: int = 0
    raw_stories_seen: int = 0
    last_success_page: int = 0
    stop_reason: str = ""
    terminal: bool = False


@dataclass
class InkittBatchState:
    batch_id: str
    created_by_user_id: str | None
    rows: list[InkittBatchRow] = field(default_factory=list)
    batch_name: str = ""
    phase: BatchPhase = "discovering"
    error_message: str = ""
    created_at: str = field(default_factory=lambda: datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
    started_at: str | None = None
    finished_at: str | None = None
    max_pages_per_genre: int = 3
    discover_concurrency: int = 4
    crawl_concurrency: int = 4
    request_delay_seconds: float = 1.0
    output_dir: str = ""
    selected_genres: list[str] = field(default_factory=list)
    crawl_runs: list[dict[str, Any]] = field(default_factory=list)
    cancel_requested: bool = False
    log_lines: list[str] = field(default_factory=list)
    log_file: str = ""
    progress_samples: list[dict[str, Any]] = field(default_factory=list)

    def add_log(self, message: str) -> None:
        line = f"{datetime.now().strftime('%H:%M:%S')} {message}"
        self.log_lines.append(line)
        if len(self.log_lines) > INKITT_BATCH_MEMORY_LOG_LINES:
            self.log_lines = self.log_lines[-INKITT_BATCH_MEMORY_LOG_LINES:]
        if self.log_file:
            try:
                log_path = Path(self.log_file)
                log_path.parent.mkdir(parents=True, exist_ok=True)
                with log_path.open("a", encoding="utf-8") as handle:
                    handle.write(f"{line}\n")
            except Exception as exc:
                logger.warning("Failed to append Inkitt batch log: %s", exc)


class InkittBatchService:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._batches: dict[str, InkittBatchState] = {}
        self._project_root = Path(__file__).parent.parent.parent.resolve()
        self._batch_root = (self._project_root / "output" / "inkitt_batch").resolve()
        self._batch_root.mkdir(parents=True, exist_ok=True)
        self._index_file = self._batch_root / "batch_index.json"
        self._discovered_story_index_file = self._batch_root / "discovered_story_index.json"
        self._exported_story_index_file = self._batch_root / "exported_story_index.json"
        self._discovery_progress_file = self._batch_root / "discovery_progress.json"
        self._last_persist_at = 0.0
        self._request_lock = threading.Lock()
        self._last_request_at = 0.0
        self._history_lock = threading.Lock()
        cfg = load_site_config("inkitt")
        self._promo_patterns = build_promo_patterns(cfg.get("promo_patterns", []))
        self._load_index()
        self._bootstrap_discovered_story_index_from_batches()
        self._bootstrap_exported_story_index_from_batches()

    def start(
        self,
        created_by_user_id: str | None,
        batch_name: str,
        genres: list[str] | None,
        max_pages_per_genre: int,
        discover_concurrency: int,
        crawl_concurrency: int,
        request_delay_seconds: float,
        crawl_after_discovery: bool = True,
    ) -> InkittBatchState:
        selected = normalize_genres(genres)
        batch_id = uuid.uuid4().hex[:8]
        state = InkittBatchState(
            batch_id=batch_id,
            created_by_user_id=created_by_user_id,
            batch_name=(batch_name or "Inkitt free completed batch").strip(),
            started_at=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            max_pages_per_genre=clamp(max_pages_per_genre, 1, INKITT_BATCH_MAX_PAGES),
            discover_concurrency=clamp(discover_concurrency, 1, INKITT_BATCH_MAX_DISCOVER_WORKERS),
            crawl_concurrency=clamp(crawl_concurrency, 1, INKITT_BATCH_MAX_CRAWL_WORKERS),
            request_delay_seconds=max(1.0, min(float(request_delay_seconds), 15.0)),
            output_dir=str(self._prepare_output_dir(batch_id)),
            selected_genres=selected,
            cancel_requested=False,
            log_file=str(self._log_file_for_batch(batch_id)),
        )
        state.add_log(f"Started Inkitt discovery for {len(selected)} genre(s).")

        with self._lock:
            self._batches[batch_id] = state
            self._persist_locked(force=True)

        thread = threading.Thread(target=self._run_thread, args=(batch_id, crawl_after_discovery), daemon=True)
        thread.start()
        return state

    def start_crawl(
        self,
        batch_id: str,
        crawl_concurrency: int,
        request_delay_seconds: float,
        max_stories: int | None = None,
    ) -> InkittBatchState:
        with self._lock:
            state = self._get_state_locked(batch_id)
            if state.phase in {"discovering", "crawling"}:
                raise ValueError("This Inkitt batch is already active.")
            available_rows = self._available_rows_for_crawl_locked(state, max_stories)
            if not available_rows:
                raise ValueError("This Inkitt batch has no queued stories to crawl.")
            run_id = uuid.uuid4().hex[:8]
            for row in available_rows:
                row.status = "queued"
                row.error = ""
                row.crawl_run_id = run_id
            state.phase = "crawling"
            state.cancel_requested = False
            state.finished_at = None
            state.crawl_concurrency = clamp(crawl_concurrency, 1, INKITT_BATCH_MAX_CRAWL_WORKERS)
            state.request_delay_seconds = max(1.0, min(float(request_delay_seconds), 15.0))
            state.crawl_runs.append({
                "run_id": run_id,
                "started_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "finished_at": None,
                "target_stories": len(available_rows),
                "completed_count": 0,
                "failed_count": 0,
                "skipped_count": 0,
                "processed_count": 0,
                "crawled_chapters": 0,
                "total_chapters": 0,
                "status": "crawling",
            })
            state.add_log(f"Started crawl run {run_id} for {len(available_rows)} story/stories.")
            self._persist_locked(force=True)

        thread = threading.Thread(target=self._crawl_thread, args=(batch_id, run_id), daemon=True)
        thread.start()
        return state

    def retry_failed(self, batch_id: str, row_index: int | None = None) -> InkittBatchState:
        with self._lock:
            state = self._get_state_locked(batch_id)
            if state.phase in {"discovering", "crawling"}:
                raise ValueError("Pause or wait for the active Inkitt batch before retrying failed stories.")
            if row_index is not None:
                if row_index < 1 or row_index > len(state.rows):
                    raise ValueError("Story row was not found in this Inkitt batch.")
                failed_rows = [state.rows[row_index - 1]] if state.rows[row_index - 1].status == "failed" else []
            else:
                failed_rows = [row for row in state.rows if row.status == "failed"]
            if not failed_rows:
                raise ValueError("This Inkitt batch has no failed stories to retry.")
            next_priority = max((int(row.retry_priority or 0) for row in state.rows), default=0) + 1
            for offset, row in enumerate(failed_rows):
                row.status = "queued"
                row.retry_priority = next_priority + offset
                row.error = ""
                row.output_file = ""
                row.metadata_file = ""
                row.crawled_chapters = 0
                row.completed_at = ""
                row.crawl_run_id = ""
            if state.phase in {"completed", "failed"}:
                state.phase = "ready"
                state.finished_at = None
            state.add_log(f"Queued {len(failed_rows)} failed story/stories at the top of the next crawl run.")
            self._persist_locked(force=True)
            return state

    def pause_crawl(self, batch_id: str) -> InkittBatchState:
        with self._lock:
            state = self._get_state_locked(batch_id)
            if state.phase != "crawling":
                raise ValueError("Only an active Inkitt crawl can be paused.")
            state.cancel_requested = True
            state.add_log("Pause requested. Current in-flight story/stories will finish, then the queue will stop.")
            self._persist_locked(force=True)
            return state

    def get_status(self, batch_id: str) -> dict[str, Any]:
        with self._lock:
            state = self._get_state_locked(batch_id)
            return self._summary_locked(state)

    def list_batches(self, user_id: str | None, role: str | None) -> list[dict[str, Any]]:
        with self._lock:
            states = [
                state
                for state in self._batches.values()
                if role in {"admin", "operator"} or (state.created_by_user_id and state.created_by_user_id == user_id)
            ]
            summaries = [self._summary_locked(state) for state in states]
        return sorted(summaries, key=lambda item: item.get("created_at") or "", reverse=True)

    def list_rows(self, batch_id: str, offset: int, limit: int, status_filter: str = "all") -> dict[str, Any]:
        with self._lock:
            state = self._get_state_locked(batch_id)
            rows = self._filtered_rows(state, status_filter)
            offset = max(0, offset)
            limit = clamp(limit, 1, 500)
            page = rows[offset: offset + limit]
            return {
                "batch": self._summary_locked(state),
                "items": [row.to_dict() for row in page],
                "total": len(rows),
                "offset": offset,
                "limit": limit,
            }

    def export_discovered_catalog(self) -> dict[str, Any]:
        with self._history_lock:
            index = self._load_discovered_story_index_unlocked()
        stories = sorted(index.values(), key=lambda item: (item.get("genre") or "", (item.get("title") or "").lower()))
        return {
            "kind": "inkitt_discovered_catalog",
            "version": 1,
            "exported_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "story_count": len(stories),
            "genres": [{"slug": slug, "label": label} for slug, label in INKITT_GENRES],
            "stories": stories,
        }

    def export_batch_catalog(self, batch_id: str) -> dict[str, Any]:
        with self._lock:
            state = self._get_state_locked(batch_id)
            stories: list[dict[str, Any]] = []
            for row in state.rows:
                normalized = normalize_catalog_ref({
                    "genre": row.genre,
                    "genre_slug": row.genre_slug,
                    "title": row.title,
                    "url": row.url,
                    "story_id": row.story_id,
                    "author": row.author,
                    "total_chapters": row.total_chapters,
                    "rating": row.rating,
                    "review_count": row.review_count,
                    "read_count": row.read_count,
                })
                if normalized:
                    stories.append(normalized)
            payload = {
                "kind": "inkitt_batch_discovered_catalog",
                "version": 1,
                "exported_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "batch_id": state.batch_id,
                "batch_name": state.batch_name,
                "story_count": len(stories),
                "selected_genres": list(state.selected_genres),
                "genres": [{"slug": slug, "label": label} for slug, label in INKITT_GENRES],
                "stories": sorted(
                    stories,
                    key=lambda item: (item.get("genre") or "", (item.get("title") or "").lower()),
                ),
            }
        return payload

    def import_discovered_catalog(self, payload: Any, created_by_user_id: str | None) -> dict[str, Any]:
        refs = self._extract_catalog_refs(payload)
        if not refs:
            raise ValueError("No valid Inkitt discovered stories found in the import file.")
        new_count, catalog_refs = self._merge_discovered_story_refs(refs)
        exported_story_ids = self._load_exported_story_ids()
        queued_refs = [ref for ref in refs if ref["story_id"] not in exported_story_ids]
        state = self._create_ready_batch_from_refs(
            created_by_user_id=created_by_user_id,
            batch_name="Imported Inkitt discovered catalog",
            refs=queued_refs,
        )
        with self._lock:
            state.add_log(
                f"Imported discovered catalog backup: {len(refs)} valid story/stories, "
                f"{new_count} new, {len(catalog_refs)} total in catalog."
            )
            if len(refs) != len(queued_refs):
                state.add_log(f"Skipped {len(refs) - len(queued_refs)} imported story/stories already exported in prior batches.")
            self._persist_locked(force=True)
            summary = self._summary_locked(state)
        return {
            "imported_count": len(refs),
            "new_count": new_count,
            "total_count": len(catalog_refs),
            "queued_count": len(queued_refs),
            "batch": summary,
        }

    def get_full_logs(self, batch_id: str) -> dict[str, Any]:
        with self._lock:
            state = self._get_state_locked(batch_id)
            summary = self._summary_locked(state)
            log_file = Path(state.log_file).resolve() if state.log_file else self._log_file_for_batch(batch_id)
            memory_lines = list(state.log_lines)

        log_lines = self._read_log_lines(log_file)
        if not log_lines:
            log_lines = memory_lines
        return {
            "batch": summary,
            "log_lines": log_lines,
            "total": len(log_lines),
        }

    def _create_ready_batch_from_refs(
        self,
        created_by_user_id: str | None,
        batch_name: str,
        refs: list[dict[str, Any]],
    ) -> InkittBatchState:
        batch_id = uuid.uuid4().hex[:8]
        rows = [
            InkittBatchRow(index=index, **ref, status="queued")
            for index, ref in enumerate(refs[:INKITT_BATCH_MAX_STORIES], start=1)
        ]
        state = InkittBatchState(
            batch_id=batch_id,
            created_by_user_id=created_by_user_id,
            rows=rows,
            batch_name=batch_name,
            phase="ready",
            started_at=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            finished_at=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            max_pages_per_genre=INKITT_BATCH_MAX_PAGES,
            discover_concurrency=1,
            crawl_concurrency=1,
            request_delay_seconds=5.0,
            output_dir=str(self._prepare_output_dir(batch_id)),
            selected_genres=[slug for slug, _label in INKITT_GENRES],
            cancel_requested=False,
            log_file=str(self._log_file_for_batch(batch_id)),
        )
        state.add_log(f"Ready batch created from discovered catalog: {len(rows)} queued story/stories.")
        if len(refs) > len(rows):
            state.add_log(
                f"Import queue capped at {len(rows)} of {len(refs)} story/stories. "
                "Increase INKITT_BATCH_MAX_STORIES to include more."
            )
        with self._lock:
            self._batches[batch_id] = state
            self._persist_locked(force=True)
        return state

    def _extract_catalog_refs(self, payload: Any) -> list[dict[str, Any]]:
        stories: Any
        if isinstance(payload, list):
            stories = payload
        elif isinstance(payload, dict):
            stories = payload.get("stories") or payload.get("items") or payload.get("data") or payload
            if isinstance(stories, dict):
                stories = list(stories.values())
        else:
            stories = []
        if not isinstance(stories, list):
            return []
        refs: dict[str, dict[str, Any]] = {}
        for story in stories:
            normalized = normalize_catalog_ref(story)
            if normalized:
                refs[normalized["story_id"]] = normalized
        return list(refs.values())

    def delete_batch(self, batch_id: str) -> bool:
        with self._lock:
            state = self._get_state_locked(batch_id)
            if state.phase in {"discovering", "crawling"}:
                raise ValueError("Active Inkitt batches cannot be deleted. Wait for the batch to finish first.")
            output_dirs = [(self._batch_root / batch_id).resolve()]
            if state.output_dir:
                output_dirs.append(Path(state.output_dir).resolve())

            seen: set[Path] = set()
            for output_dir in output_dirs:
                if output_dir in seen:
                    continue
                seen.add(output_dir)
                if output_dir == self._batch_root or not output_dir.is_relative_to(self._batch_root):
                    raise ValueError("Batch output path escapes the batch root.")
                if output_dir.exists():
                    if output_dir.is_symlink():
                        raise ValueError("Refusing to delete a symlinked batch output path.")
                    shutil.rmtree(output_dir)

            self._batches.pop(batch_id, None)
            self._persist_locked(force=True)
            return True

    def require_owner(self, batch_id: str, user_id: str | None, role: str | None) -> None:
        from fastapi import HTTPException

        with self._lock:
            state = self._get_state_locked(batch_id)
            owner = state.created_by_user_id
        if role in {"admin", "operator"}:
            return
        if owner and user_id and owner == user_id:
            return
        raise HTTPException(status_code=403, detail="Access denied for this Inkitt batch.")

    def get_download_files(self, batch_id: str, run_id: str | None = None) -> tuple[InkittBatchState, list[tuple[Path, str]]]:
        with self._lock:
            state = self._get_state_locked(batch_id)
            output_dir = Path(state.output_dir).resolve() if state.output_dir else self._batch_root / batch_id
            run_rows = [
                row
                for row in state.rows
                if run_id and row.status == "completed" and row.crawl_run_id == run_id
            ]

        if not output_dir.exists() or not output_dir.is_dir():
            raise FileNotFoundError("Batch output folder was not found.")
        if not output_dir.is_relative_to(self._batch_root):
            raise ValueError("Batch output path escapes the batch root.")

        files: list[tuple[Path, str]] = []
        if run_id:
            for row in run_rows:
                for name in (row.output_file, row.metadata_file):
                    if not name:
                        continue
                    path = (output_dir / name).resolve()
                    if path.is_file() and not path.is_symlink() and path.is_relative_to(output_dir):
                        files.append((path, name.replace("\\", "/")))
        else:
            for pattern in ("*.md", "info.json"):
                for path in sorted(output_dir.rglob(pattern)):
                    if path.is_file() and not path.is_symlink():
                        archive_name = str(path.relative_to(output_dir)).replace("\\", "/")
                        files.append((path, archive_name))
        if not files:
            raise FileNotFoundError("No Inkitt batch files were created.")
        return state, files

    def _run_thread(self, batch_id: str, crawl_after_discovery: bool) -> None:
        try:
            refs = self._discover(batch_id)
            with self._lock:
                state = self._batches.get(batch_id)
                if state is None:
                    return
                if not refs:
                    state.phase = "ready"
                    state.finished_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                    state.add_log("No free completed Inkitt stories found.")
                    self._persist_locked(force=True)
                    return
                queued_refs = refs[:INKITT_BATCH_MAX_STORIES]
                state.rows = [
                    InkittBatchRow(index=index, **ref)
                    for index, ref in enumerate(queued_refs, start=1)
                ]
                for row in state.rows:
                    row.status = "queued"
                state.add_log(f"Discovery finished: {len(state.rows)} completed story candidate(s).")
                if len(refs) > len(queued_refs):
                    state.add_log(
                        f"Discovery queue capped at {len(queued_refs)} of {len(refs)} candidate(s). "
                        "Increase INKITT_BATCH_MAX_STORIES to include more."
                    )
                state.phase = "crawling" if crawl_after_discovery else "ready"
                if not crawl_after_discovery:
                    state.finished_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                self._persist_locked(force=True)

            if not crawl_after_discovery:
                return

            self._crawl_rows(batch_id, None)

            with self._lock:
                state = self._batches.get(batch_id)
                if state is None:
                    return
                state.phase = "completed"
                state.finished_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                completed = sum(1 for row in state.rows if row.status == "completed")
                skipped = sum(1 for row in state.rows if row.status == "skipped")
                failed = sum(1 for row in state.rows if row.status == "failed")
                state.add_log(f"Batch completed: {completed} exported, {skipped} skipped, {failed} failed.")
                self._persist_locked(force=True)
        except Exception as exc:
            logger.exception("[inkitt-batch/%s] failed", batch_id)
            with self._lock:
                state = self._batches.get(batch_id)
                if state:
                    state.phase = "failed"
                    state.error_message = str(exc)
                    state.finished_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                    state.add_log(f"Batch failed: {exc}")
                    self._persist_locked(force=True)

    def _crawl_thread(self, batch_id: str, run_id: str) -> None:
        try:
            self._crawl_rows(batch_id, run_id)
            with self._lock:
                state = self._batches.get(batch_id)
                if state is None:
                    return
                paused = state.cancel_requested
                state.cancel_requested = False
                remaining = any(row.status in {"queued", "discovered", "failed"} for row in state.rows)
                state.phase = "ready" if paused or remaining else "completed"
                state.finished_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                completed = sum(1 for row in state.rows if row.status == "completed")
                skipped = sum(1 for row in state.rows if row.status == "skipped")
                failed = sum(1 for row in state.rows if row.status == "failed")
                self._finish_crawl_run_locked(state, run_id, status="paused" if paused else "completed")
                if paused:
                    state.add_log(f"Crawl run {run_id} paused. Total progress: {completed} exported, {skipped} skipped, {failed} failed.")
                else:
                    state.add_log(f"Crawl run {run_id} finished. Total progress: {completed} exported, {skipped} skipped, {failed} failed.")
                self._persist_locked(force=True)
        except Exception as exc:
            logger.exception("[inkitt-batch/%s] crawl failed", batch_id)
            with self._lock:
                state = self._batches.get(batch_id)
                if state:
                    state.phase = "failed"
                    state.error_message = str(exc)
                    state.finished_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                    state.add_log(f"Crawl failed: {exc}")
                    self._finish_crawl_run_locked(state, run_id, status="failed")
                    self._persist_locked(force=True)

    def _discover(self, batch_id: str) -> list[dict[str, Any]]:
        with self._lock:
            state = self._get_state_locked(batch_id)
            selected = list(state.selected_genres)
            max_pages = state.max_pages_per_genre
            max_workers = state.discover_concurrency
            delay = state.request_delay_seconds

        discovered_this_run: dict[str, dict[str, Any]] = {}
        added_during_run = 0
        progress = self._load_discovery_progress()
        with ThreadPoolExecutor(max_workers=max_workers) as pool:
            futures = {}
            for slug, label in INKITT_GENRES:
                if slug not in selected:
                    continue
                genre_progress = progress.get(slug, {})
                if genre_progress.get("terminal"):
                    with self._lock:
                        state = self._batches.get(batch_id)
                        if state:
                            state.add_log(
                                f"{label}: skipped; prior scan reached terminal stop at page "
                                f"{genre_progress.get('last_success_page') or '?'} "
                                f"({genre_progress.get('stop_reason') or 'complete'})."
                            )
                            self._persist_locked()
                    continue
                start_page = max(1, int(genre_progress.get("last_success_page") or 0) + 1)
                futures[pool.submit(self._discover_genre, batch_id, slug, label, max_pages, delay, start_page)] = (slug, label)
            for future in as_completed(futures):
                slug, label = futures[future]
                try:
                    result = future.result()
                    refs = result.refs
                except Exception as exc:
                    logger.warning("[inkitt-batch/%s] discovery failed for %s: %s", batch_id, slug, exc)
                    refs = []
                    result = InkittDiscoveryResult(refs=[], stop_reason=f"failed: {exc}")
                    with self._lock:
                        state = self._batches.get(batch_id)
                        if state:
                            state.add_log(f"{label}: discovery failed: {exc}")
                for ref in refs:
                    discovered_this_run.setdefault(ref["story_id"], ref)
                added_so_far, catalog_refs_so_far = self._merge_discovered_story_refs(refs, selected)
                added_during_run += added_so_far
                self._record_discovery_progress(slug, label, result)
                with self._lock:
                    state = self._batches.get(batch_id)
                    if state:
                        detail = (
                            f"{label}: found {len(refs)} completed candidate(s) "
                            f"from {result.raw_stories_seen} API story row(s) "
                            f"across {result.pages_checked} page(s)"
                        )
                        if result.start_page > 1:
                            detail += f" starting at page {result.start_page}"
                        if result.stop_reason:
                            detail += f"; stopped: {result.stop_reason}"
                        if refs:
                            detail += (
                                f"; catalog +{added_so_far}, "
                                f"{len(catalog_refs_so_far)} total selected"
                            )
                        state.add_log(detail)
                        self._persist_locked()

        _final_added_count, catalog_refs = self._merge_discovered_story_refs(discovered_this_run.values(), selected)
        exported_story_ids = self._load_exported_story_ids()
        refs = [ref for ref in catalog_refs if ref["story_id"] not in exported_story_ids]
        skipped_exported = len(catalog_refs) - len(refs)
        with self._lock:
            state = self._batches.get(batch_id)
            if state:
                state.add_log(
                    f"System catalog updated: {added_during_run} new, "
                    f"{len(catalog_refs)} total for selected genre(s)."
                )
                if skipped_exported:
                    state.add_log(f"Skipped {skipped_exported} story/stories already exported in prior batches.")
                self._persist_locked(force=True)
        return sorted(refs, key=lambda item: (item["genre"], item["title"].lower()))

    def _discover_genre(
        self,
        batch_id: str | None,
        genre_slug: str,
        genre_label: str,
        max_pages: int,
        delay: float = 2.0,
        start_page: int = 1,
    ) -> InkittDiscoveryResult:
        session = self._make_session()
        refs_by_id: dict[str, dict[str, Any]] = {}
        pages_checked = 0
        raw_stories_seen = 0
        last_success_page = max(0, start_page - 1)
        terminal = False
        stop_reason = f"reached max page limit ({max_pages})"
        next_row_log_at = 1_000
        if start_page > max_pages:
            return InkittDiscoveryResult(
                refs=[],
                start_page=start_page,
                pages_checked=0,
                raw_stories_seen=0,
                last_success_page=max_pages,
                stop_reason=f"already scanned through requested max page limit ({max_pages})",
                terminal=False,
            )
        self._log_batch(
            batch_id,
            f"{genre_label}: discovery worker started at page {start_page}/{max_pages} with {delay:g}s delay.",
        )
        for page in range(start_page, max_pages + 1):
            url = f"https://www.inkitt.com/1/genres/{genre_slug}"
            pages_checked += 1
            request_kwargs = {
                "params": {"page": page, "sorting": "popular_all_time", "story_type": "original"},
                "headers": {
                    "Accept": "application/json, text/javascript, */*; q=0.01",
                    "X-Requested-With": "XMLHttpRequest",
                    "Referer": f"https://www.inkitt.com/genres/{genre_slug}",
                },
                "timeout": 30,
            }
            response: requests.Response | None = None
            for attempt in range(INKITT_DISCOVER_RETRY_TIMES + 1):
                try:
                    response = self._throttled_get(session, url, delay, **request_kwargs)
                except requests.RequestException as exc:
                    stop_reason = f"request failed on page {page}: {exc.__class__.__name__}"
                    if attempt >= INKITT_DISCOVER_RETRY_TIMES:
                        response = None
                        break
                    wait = self._discover_retry_wait(None, attempt)
                    self._log_batch(
                        batch_id,
                        f"{genre_label}: request failed on page {page} ({exc.__class__.__name__}); "
                        f"retry {attempt + 1}/{INKITT_DISCOVER_RETRY_TIMES} in {wait:.1f}s.",
                    )
                    time.sleep(wait)
                    continue
                if response.status_code not in INKITT_DISCOVER_RETRY_HTTP_CODES:
                    break
                retry_after = response.headers.get("Retry-After")
                stop_reason = f"HTTP {response.status_code} on page {page}"
                if retry_after:
                    stop_reason += f" (Retry-After: {retry_after})"
                if attempt >= INKITT_DISCOVER_RETRY_TIMES:
                    stop_reason += f" after {INKITT_DISCOVER_RETRY_TIMES} retries"
                    break
                wait = self._discover_retry_wait(response, attempt)
                self._log_batch(
                    batch_id,
                    f"{genre_label}: HTTP {response.status_code} on page {page}; "
                    f"retry {attempt + 1}/{INKITT_DISCOVER_RETRY_TIMES} in {wait:.1f}s.",
                )
                time.sleep(wait)
            if response is None:
                break
            if response.status_code != 200:
                stop_reason = f"HTTP {response.status_code} on page {page}"
                if response.status_code == 500 and page > 500 and raw_stories_seen >= 10_000:
                    stop_reason = f"probable Inkitt page cap at page {page} after {raw_stories_seen} API story row(s)"
                    terminal = True
                elif response.status_code in INKITT_DISCOVER_RETRY_HTTP_CODES:
                    retry_after = response.headers.get("Retry-After")
                    if retry_after:
                        stop_reason += f" (Retry-After: {retry_after})"
                    stop_reason += f" after {INKITT_DISCOVER_RETRY_TIMES} retries"
                break
            try:
                payload = response.json()
            except ValueError:
                stop_reason = f"invalid JSON on page {page}"
                break
            stories = payload.get("stories") or []
            if not stories:
                stop_reason = f"empty page {page}"
                terminal = True
                break
            raw_stories_seen += len(stories)
            last_success_page = page
            refs = extract_completed_story_refs_from_api(payload, genre_slug, genre_label)
            for ref in refs:
                refs_by_id.setdefault(ref["story_id"], ref)
            if page == start_page or page % 25 == 0 or raw_stories_seen >= next_row_log_at:
                self._log_batch(
                    batch_id,
                    f"{genre_label}: scanning page {page}/{max_pages}; "
                    f"{raw_stories_seen:,} API rows, {len(refs_by_id):,} completed candidates so far.",
                )
                self._checkpoint_discovery_progress(
                    genre_slug=genre_slug,
                    genre_label=genre_label,
                    start_page=start_page,
                    pages_checked=pages_checked,
                    raw_stories_seen=raw_stories_seen,
                    last_success_page=last_success_page,
                    stop_reason=f"in progress at page {page}",
                )
                while raw_stories_seen >= next_row_log_at:
                    next_row_log_at += 1_000
            if len(stories) < 20:
                stop_reason = f"short page {page} ({len(stories)} story row(s))"
                terminal = True
                break
        return InkittDiscoveryResult(
            refs=list(refs_by_id.values()),
            start_page=start_page,
            pages_checked=pages_checked,
            raw_stories_seen=raw_stories_seen,
            last_success_page=last_success_page,
            stop_reason=stop_reason,
            terminal=terminal,
        )

    def _crawl_rows(self, batch_id: str, run_id: str | None = None) -> None:
        with self._lock:
            state = self._get_state_locked(batch_id)
            pending_rows = [
                row for row in state.rows
                if row.status == "queued" and (run_id is None or row.crawl_run_id == run_id)
            ]
            pending_rows.sort(key=lambda row: (0 if int(row.retry_priority or 0) > 0 else 1, -int(row.retry_priority or 0), row.index))
            pending_indices = [row.index for row in pending_rows]
            max_workers = state.crawl_concurrency
            output_dir = Path(state.output_dir).resolve()
            delay = state.request_delay_seconds

        pending_lock = threading.Lock()

        def take_next_row() -> InkittBatchRow | None:
            while True:
                with self._lock:
                    state = self._batches.get(batch_id)
                    if state is None or state.cancel_requested:
                        return None
                with pending_lock:
                    if not pending_indices:
                        return None
                    row_index = pending_indices.pop(0)
                with self._lock:
                    state = self._batches.get(batch_id)
                    if state is None or row_index < 1 or row_index > len(state.rows):
                        continue
                    row = state.rows[row_index - 1]
                    if row.status == "queued" and (run_id is None or row.crawl_run_id == run_id):
                        return row

        def worker() -> None:
            while True:
                row = take_next_row()
                if row is None:
                    return
                try:
                    update = self._crawl_one(batch_id, row, output_dir, delay)
                except Exception as exc:
                    logger.warning("[inkitt-batch/%s] crawl failed for row %s: %s", batch_id, row.index, exc)
                    update = {"status": "failed", "error": str(exc)}
                with self._lock:
                    state = self._batches.get(batch_id)
                    if state is None:
                        return
                    persisted_row = state.rows[row.index - 1]
                    for key, value in update.items():
                        setattr(persisted_row, key, value)
                    if persisted_row.status != "queued":
                        persisted_row.retry_priority = 0
                    if persisted_row.status == "completed":
                        persisted_row.completed_at = persisted_row.completed_at or datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                        self._record_exported_story(persisted_row, batch_id)
                    total_chapters = sum(int(item.total_chapters or 0) for item in state.rows)
                    crawled_chapters = sum(int(item.crawled_chapters or 0) for item in state.rows)
                    processed_count = sum(1 for item in state.rows if item.status in {"completed", "skipped", "failed"})
                    self._append_progress_sample_locked(state, crawled_chapters, processed_count, total_chapters)
                    self._persist_locked()

        with ThreadPoolExecutor(max_workers=max_workers) as pool:
            futures = [pool.submit(worker) for _ in range(min(max_workers, len(pending_indices)))]
            for future in as_completed(futures):
                future.result()

    def _crawl_one(self, batch_id: str, row: InkittBatchRow, output_dir: Path, delay: float) -> dict[str, Any]:
        if self._is_cancel_requested(batch_id):
            return {"status": "queued", "error": ""}
        row.status = "crawling"
        spider = InkittSpider(novel=row.url, limit=10000)

        chapters: list[tuple[int, str, str, str]] = []
        try:
            story_html = self._fetch_spider_html(spider, row.url, delay)
            if self._is_cancel_requested(batch_id):
                return {"status": "queued", "error": ""}
            story_soup = BeautifulSoup(story_html, "html.parser")
            metadata = spider._extract_novel_metadata(story_soup, row.story_id, row.url)
            metadata.update(extract_story_quality(story_soup))

            status = extract_label_value(story_soup, "Status") or row.completion_status
            if status.lower() != "complete":
                return {"status": "skipped", "completion_status": status, "error": "Story is not complete."}

            chapter_links = spider._collect_chapter_links(story_soup, row.story_id, row.url)
            if not chapter_links:
                return {"status": "skipped", "total_chapters": 0, "crawled_chapters": 0, "error": "No chapter list found."}
            self._update_row_progress(batch_id, row.index, status="crawling", total_chapters=len(chapter_links), crawled_chapters=0)

            for link in chapter_links:
                if self._is_cancel_requested(batch_id):
                    return {
                        "status": "queued",
                        "total_chapters": len(chapter_links),
                        "crawled_chapters": 0,
                        "error": "",
                    }
                chapter_url = link["url"]
                html = story_html if spider._same_url(chapter_url, row.url) else self._fetch_spider_html(spider, chapter_url, delay)
                if self._is_cancel_requested(batch_id):
                    return {
                        "status": "queued",
                        "total_chapters": len(chapter_links),
                        "crawled_chapters": 0,
                        "error": "",
                    }
                soup = BeautifulSoup(html, "html.parser")
                content = spider._extract_chapter_content(soup)
                cleaned = clean_chapter_content(content, self._promo_patterns)
                if should_use_rendered_fallback(cleaned):
                    self._log_batch(
                        batch_id,
                        f"{row.title}: rendered fallback for chapter {link['chapter_number']} "
                        f"after static content returned {len(cleaned.split())} word(s).",
                    )
                    rendered = self._fetch_rendered_chapter_content(chapter_url, delay)
                    rendered_cleaned = clean_chapter_content(rendered, self._promo_patterns)
                    if len(rendered_cleaned.split()) > len(cleaned.split()):
                        cleaned = rendered_cleaned
                if not cleaned:
                    raise RuntimeError("No readable free chapter content.")
                title = spider._extract_chapter_title(soup) or link.get("title") or f"Chapter {link['chapter_number']}"
                chapters.append((int(link["chapter_number"]), title, cleaned, chapter_url))
                self._update_row_progress(batch_id, row.index, crawled_chapters=len(chapters))
                if len(chapters) == 1 or len(chapters) % 25 == 0 or len(chapters) == len(chapter_links):
                    self._log_batch(
                        batch_id,
                        f"{row.title}: crawled {len(chapters)}/{len(chapter_links)} chapter(s).",
                        force=len(chapters) == len(chapter_links),
                    )
        except RuntimeError as exc:
            return classify_inkitt_crawl_error(str(exc))

        genre_dir = output_dir / sanitize_filename(row.genre)
        story_folder = f"{row.index:04d}_{sanitize_filename(metadata.get('title') or row.title)}_{row.story_id}"
        story_dir = genre_dir / story_folder
        story_dir.mkdir(parents=True, exist_ok=True)

        md_filename = f"Inkitt_{sanitize_filename(metadata.get('title') or row.title)}.md"
        md_path = story_dir / md_filename
        md_path.write_text(format_combined_markdown(metadata, row.url, chapters), encoding="utf-8")

        info = {
            "title": metadata.get("title") or row.title,
            "author": row.author or (metadata.get("authors") or [""])[0],
            "genre": row.genre,
            "status": status,
            "source_url": row.url,
            "story_id": row.story_id,
            "rating": metadata.get("rating"),
            "review_count": metadata.get("review_count"),
            "read_count": metadata.get("read_count"),
            "chapters": len(chapter_links),
            "crawled_chapters": len(chapters),
            "description": metadata.get("description"),
            "tags": metadata.get("tags"),
        }
        info_path = story_dir / "info.json"
        info_path.write_text(json.dumps(info, ensure_ascii=False, indent=2), encoding="utf-8")

        rel_dir = Path(sanitize_filename(row.genre)) / story_folder
        return {
            "status": "completed",
            "title": metadata.get("title") or row.title,
            "author": info["author"] or row.author,
            "completion_status": status,
            "total_chapters": len(chapter_links),
            "crawled_chapters": len(chapters),
            "rating": metadata.get("rating"),
            "review_count": metadata.get("review_count"),
            "read_count": metadata.get("read_count"),
            "output_file": str(rel_dir / md_filename).replace("\\", "/"),
            "metadata_file": str(rel_dir / "info.json").replace("\\", "/"),
            "error": "",
        }

    def _is_cancel_requested(self, batch_id: str) -> bool:
        with self._lock:
            state = self._batches.get(batch_id)
            return bool(state and state.cancel_requested)

    def _update_row_progress(self, batch_id: str, row_index: int, **updates: Any) -> None:
        with self._lock:
            state = self._batches.get(batch_id)
            if state is None or row_index < 1 or row_index > len(state.rows):
                return
            row = state.rows[row_index - 1]
            for key, value in updates.items():
                setattr(row, key, value)
            total_chapters = sum(int(item.total_chapters or 0) for item in state.rows)
            crawled_chapters = sum(int(item.crawled_chapters or 0) for item in state.rows)
            processed_count = sum(1 for item in state.rows if item.status in {"completed", "skipped", "failed"})
            self._append_progress_sample_locked(state, crawled_chapters, processed_count, total_chapters)
            self._persist_locked()

    def _fetch_rendered_chapter_content(self, url: str, delay: float) -> str:
        if not INKITT_RENDERED_FALLBACK:
            return ""
        try:
            from handlers.selenium_handler import _get_browser

            browser = _get_browser()
            with self._request_lock:
                self._wait_for_request_slot_locked(delay)
                html, status, _body, _headers, paragraphs = browser.fetch_with_retry(
                    url,
                    timeout=60,
                    skip_scroll=False,
                    max_retries=1,
                )
                self._last_request_at = time.monotonic()
            if status and status >= 400:
                return ""
            if paragraphs:
                return "\n\n".join(clean_text(str(paragraph)) for paragraph in paragraphs if clean_text(str(paragraph)))
            soup = BeautifulSoup(html or "", "html.parser")
            return InkittSpider(novel=url, limit=1)._extract_chapter_content(soup)
        except Exception as exc:
            logger.warning("[inkitt-batch] rendered fallback failed for %s: %s", url, exc)
            return ""

    def _finish_crawl_run_locked(self, state: InkittBatchState, run_id: str, status: str = "completed") -> None:
        for run in state.crawl_runs:
            if run.get("run_id") != run_id:
                continue
            run_rows = [row for row in state.rows if row.crawl_run_id == run_id]
            run["finished_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            run["completed_count"] = sum(1 for row in run_rows if row.status == "completed")
            run["failed_count"] = sum(1 for row in run_rows if row.status == "failed")
            run["skipped_count"] = sum(1 for row in run_rows if row.status == "skipped")
            run["processed_count"] = run["completed_count"] + run["failed_count"] + run["skipped_count"]
            run["crawled_chapters"] = sum(int(row.crawled_chapters or 0) for row in run_rows)
            run["total_chapters"] = sum(int(row.total_chapters or 0) for row in run_rows)
            run["status"] = status
            return

    def _log_batch(self, batch_id: str | None, message: str, force: bool = False) -> None:
        if not batch_id:
            return
        with self._lock:
            state = self._batches.get(batch_id)
            if state is None:
                return
            state.add_log(message)
            self._persist_locked(force=force)

    def _fetch_spider_html(self, spider: InkittSpider, url: str, delay: float, attempts: int = 5) -> str:
        last_error = ""
        for attempt in range(attempts):
            response = self._throttled_get(spider._session, url, delay)
            if response.status_code == 429:
                retry_after = parse_retry_after(response.headers.get("Retry-After"))
                wait = retry_after if retry_after is not None else min(90.0, 8.0 * (attempt + 1))
                wait += random.uniform(0.5, 2.0)
                last_error = f"[inkitt] HTTP 429 while fetching {url}"
                time.sleep(wait)
                continue
            if (spider._is_blocked_response(response) or spider._is_login_gated_response(response.text)) and not spider._cookies_loaded:
                spider._saved_cookie_count = spider._load_saved_cookies()
                response = self._throttled_get(spider._session, url, delay)
            if response.status_code != 200:
                raise RuntimeError(f"[inkitt] HTTP {response.status_code} while fetching {url}")
            if spider._is_blocked_response(response):
                raise RuntimeError(
                    "[inkitt] Cloudflare challenge did not clear. "
                    "Open the story in a browser and save cookies before retrying."
                )
            if spider._is_login_gated_response(response.text):
                saved_count = int(getattr(spider, "_saved_cookie_count", 0) or 0)
                cookie_state = (
                    f"Loaded {saved_count} saved Inkitt cookie(s), but Inkitt still asked for login."
                    if saved_count
                    else "No saved Inkitt cookies were loaded."
                )
                raise RuntimeError(
                    f"[inkitt] Login required for this free/adult-gated page. {cookie_state} "
                    "Refresh Inkitt user_credentials/cf_clearance in Settings from the same VPN/IP, then retry."
                )
            return response.text
        raise RuntimeError(f"{last_error}; retry limit reached. Increase delay seconds and retry the batch.")

    def _discover_retry_wait(self, response: requests.Response | None, attempt: int) -> float:
        retry_after = parse_retry_after(response.headers.get("Retry-After") if response is not None else None)
        wait = retry_after if retry_after is not None else INKITT_DISCOVER_RETRY_BASE_SECONDS * (attempt + 1)
        wait = min(INKITT_DISCOVER_RETRY_MAX_SECONDS, max(1.0, wait))
        return wait + random.uniform(0.5, 2.0)

    def _throttled_get(self, session: requests.Session, url: str, delay: float, **kwargs: Any) -> requests.Response:
        with self._request_lock:
            self._wait_for_request_slot_locked(delay)
            kwargs.setdefault("timeout", 30)
            response = session.get(url, **kwargs)
            self._last_request_at = time.monotonic()
            return response

    def _wait_for_request_slot_locked(self, delay: float) -> None:
        min_delay = max(1.0, float(delay or 0))
        elapsed = time.monotonic() - self._last_request_at
        if elapsed < min_delay:
            time.sleep(min_delay - elapsed)

    def _load_exported_story_ids(self) -> set[str]:
        with self._history_lock:
            index = self._load_exported_story_index_unlocked()
            return set(index.keys())

    def _merge_discovered_story_refs(
        self,
        refs: Any,
        selected_genres: list[str] | None = None,
    ) -> tuple[int, list[dict[str, Any]]]:
        selected = set(selected_genres or [slug for slug, _label in INKITT_GENRES])
        with self._history_lock:
            index = self._load_discovered_story_index_unlocked()
            original_ids = set(index.keys())
            changed = False
            for ref in refs:
                normalized = normalize_catalog_ref(ref)
                if normalized:
                    merged = {**index.get(normalized["story_id"], {}), **normalized}
                    if index.get(normalized["story_id"]) != merged:
                        index[normalized["story_id"]] = merged
                        changed = True
            if changed:
                self._write_discovered_story_index_unlocked(index)
            catalog_refs = [
                ref for ref in index.values()
                if ref.get("genre_slug") in selected
            ]
            return len(set(index.keys()) - original_ids), catalog_refs

    def _load_discovery_progress(self) -> dict[str, dict[str, Any]]:
        with self._history_lock:
            return self._load_discovery_progress_unlocked()

    def _record_discovery_progress(self, genre_slug: str, genre_label: str, result: InkittDiscoveryResult) -> None:
        if result.last_success_page <= 0 and not result.terminal:
            return
        self._checkpoint_discovery_progress(
            genre_slug=genre_slug,
            genre_label=genre_label,
            start_page=result.start_page,
            pages_checked=result.pages_checked,
            raw_stories_seen=result.raw_stories_seen,
            last_success_page=result.last_success_page,
            stop_reason=result.stop_reason,
            terminal=result.terminal,
        )

    def _checkpoint_discovery_progress(
        self,
        genre_slug: str,
        genre_label: str,
        start_page: int,
        pages_checked: int,
        raw_stories_seen: int,
        last_success_page: int,
        stop_reason: str,
        terminal: bool = False,
    ) -> None:
        if last_success_page <= 0 and not terminal:
            return
        if not hasattr(self, "_history_lock") or not hasattr(self, "_discovery_progress_file"):
            return
        with self._history_lock:
            progress = self._load_discovery_progress_unlocked()
            current = progress.get(genre_slug, {})
            current_last_page = int(current.get("last_success_page") or 0)
            progress[genre_slug] = {
                "genre": genre_label,
                "last_success_page": max(current_last_page, int(last_success_page or 0)),
                "last_start_page": start_page,
                "last_pages_checked": pages_checked,
                "last_raw_stories_seen": raw_stories_seen,
                "stop_reason": stop_reason,
                "terminal": bool(terminal or current.get("terminal")),
                "updated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            }
            self._write_discovery_progress_unlocked(progress)

    def _load_discovery_progress_unlocked(self) -> dict[str, dict[str, Any]]:
        if not self._discovery_progress_file.exists():
            return {}
        try:
            payload = json.loads(self._discovery_progress_file.read_text(encoding="utf-8"))
        except Exception as exc:
            logger.warning("Failed to load Inkitt discovery progress: %s", exc)
            return {}
        progress = payload.get("genres") if isinstance(payload, dict) else payload
        if not isinstance(progress, dict):
            return {}
        allowed = {slug for slug, _label in INKITT_GENRES}
        clean: dict[str, dict[str, Any]] = {}
        for slug, entry in progress.items():
            if slug not in allowed or not isinstance(entry, dict):
                continue
            try:
                last_success_page = max(0, int(entry.get("last_success_page") or 0))
            except (TypeError, ValueError):
                last_success_page = 0
            clean[slug] = {
                "genre": clean_text(str(entry.get("genre") or dict(INKITT_GENRES).get(slug) or slug)),
                "last_success_page": last_success_page,
                "last_start_page": entry.get("last_start_page") or 1,
                "last_pages_checked": entry.get("last_pages_checked") or 0,
                "last_raw_stories_seen": entry.get("last_raw_stories_seen") or 0,
                "stop_reason": clean_text(str(entry.get("stop_reason") or "")),
                "terminal": bool(entry.get("terminal") or False),
                "updated_at": clean_text(str(entry.get("updated_at") or "")),
            }
        return clean

    def _write_discovery_progress_unlocked(self, progress: dict[str, dict[str, Any]]) -> None:
        tmp_path = self._discovery_progress_file.with_suffix(".tmp")
        payload = {
            "updated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "genres": dict(sorted(progress.items(), key=lambda item: item[0])),
        }
        try:
            tmp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
            tmp_path.replace(self._discovery_progress_file)
        except Exception as exc:
            logger.warning("Failed to persist Inkitt discovery progress: %s", exc)

    def _load_discovered_story_index_unlocked(self) -> dict[str, dict[str, Any]]:
        if not self._discovered_story_index_file.exists():
            return {}
        try:
            payload = json.loads(self._discovered_story_index_file.read_text(encoding="utf-8"))
        except Exception as exc:
            logger.warning("Failed to load Inkitt discovered story index: %s", exc)
            return {}
        stories = payload.get("stories") if isinstance(payload, dict) else payload
        if not isinstance(stories, dict):
            return {}
        index: dict[str, dict[str, Any]] = {}
        for story_id, story in stories.items():
            if not re.fullmatch(r"\d+", str(story_id)) or not isinstance(story, dict):
                continue
            normalized = normalize_catalog_ref(story)
            if normalized:
                index[str(story_id)] = normalized
        return index

    def _write_discovered_story_index_unlocked(self, index: dict[str, dict[str, Any]]) -> None:
        tmp_path = self._discovered_story_index_file.with_suffix(".tmp")
        payload = {
            "updated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "stories": dict(sorted(index.items(), key=lambda item: item[0])),
        }
        try:
            tmp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
            tmp_path.replace(self._discovered_story_index_file)
        except Exception as exc:
            logger.warning("Failed to persist Inkitt discovered story index: %s", exc)

    def _record_exported_story(self, row: InkittBatchRow, batch_id: str) -> None:
        if not row.story_id:
            return
        with self._history_lock:
            index = self._load_exported_story_index_unlocked()
            index[row.story_id] = {
                "story_id": row.story_id,
                "title": row.title,
                "author": row.author,
                "genre": row.genre,
                "genre_slug": row.genre_slug,
                "source_url": row.url,
                "batch_id": batch_id,
                "output_file": row.output_file,
                "metadata_file": row.metadata_file,
                "crawl_run_id": row.crawl_run_id,
                "rating": row.rating,
                "review_count": row.review_count,
                "read_count": row.read_count,
                "crawled_chapters": row.crawled_chapters,
                "exported_at": row.completed_at or datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            }
            self._write_exported_story_index_unlocked(index)

    def _load_exported_story_index_unlocked(self) -> dict[str, dict[str, Any]]:
        if not self._exported_story_index_file.exists():
            return {}
        try:
            payload = json.loads(self._exported_story_index_file.read_text(encoding="utf-8"))
        except Exception as exc:
            logger.warning("Failed to load Inkitt exported story index: %s", exc)
            return {}
        stories = payload.get("stories") if isinstance(payload, dict) else payload
        if not isinstance(stories, dict):
            return {}
        return {
            str(story_id): story
            for story_id, story in stories.items()
            if re.fullmatch(r"\d+", str(story_id)) and isinstance(story, dict)
        }

    def _write_exported_story_index_unlocked(self, index: dict[str, dict[str, Any]]) -> None:
        tmp_path = self._exported_story_index_file.with_suffix(".tmp")
        payload = {
            "updated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "stories": dict(sorted(index.items(), key=lambda item: item[0])),
        }
        try:
            tmp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
            tmp_path.replace(self._exported_story_index_file)
        except Exception as exc:
            logger.warning("Failed to persist Inkitt exported story index: %s", exc)

    def _bootstrap_discovered_story_index_from_batches(self) -> None:
        refs = []
        for state in self._batches.values():
            for row in state.rows:
                if row.story_id and row.status != "completed":
                    refs.append(row.to_dict())
        if refs:
            self._merge_discovered_story_refs(refs)

    def _bootstrap_exported_story_index_from_batches(self) -> None:
        with self._history_lock:
            index = self._load_exported_story_index_unlocked()
            original_count = len(index)
            for batch_id, state in self._batches.items():
                for row in state.rows:
                    if row.status != "completed" or not row.story_id:
                        continue
                    index.setdefault(row.story_id, {
                        "story_id": row.story_id,
                        "title": row.title,
                        "author": row.author,
                        "genre": row.genre,
                        "genre_slug": row.genre_slug,
                        "source_url": row.url,
                        "batch_id": batch_id,
                        "output_file": row.output_file,
                        "metadata_file": row.metadata_file,
                        "rating": row.rating,
                        "review_count": row.review_count,
                        "read_count": row.read_count,
                        "crawled_chapters": row.crawled_chapters,
                        "exported_at": state.finished_at or state.started_at or state.created_at,
                    })
            if len(index) != original_count:
                self._write_exported_story_index_unlocked(index)

    def _make_session(self) -> requests.Session:
        session = requests.Session()
        session.headers.update(InkittSpider._HEADERS)
        proxies = requests_proxies("inkitt")
        if proxies:
            session.proxies.update(proxies)
        cookies, user_agent = load_saved_inkitt_cookies()
        if user_agent:
            session.headers["User-Agent"] = user_agent
        for cookie in cookies:
            if not cookie.get("name"):
                continue
            session.cookies.set(
                str(cookie.get("name") or ""),
                str(cookie.get("value") or ""),
                domain=str(cookie.get("domain") or ".inkitt.com"),
                path=str(cookie.get("path") or "/"),
            )
        return session

    def _prepare_output_dir(self, batch_id: str) -> Path:
        output_dir = (self._batch_root / batch_id).resolve()
        if not output_dir.is_relative_to(self._batch_root):
            raise ValueError("Batch output path escapes the batch root.")
        if output_dir.exists():
            shutil.rmtree(output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)
        return output_dir

    def _log_file_for_batch(self, batch_id: str) -> Path:
        return (self._batch_root / batch_id / "full.log").resolve()

    def _read_log_lines(self, log_file: Path) -> list[str]:
        try:
            if not log_file.exists() or not log_file.is_file():
                return []
            if not log_file.is_relative_to(self._batch_root):
                return []
            return [line.rstrip("\n") for line in log_file.read_text(encoding="utf-8").splitlines()]
        except Exception as exc:
            logger.warning("Failed to read Inkitt batch log: %s", exc)
            return []

    def _normalize_progress_samples(self, samples: Any) -> list[dict[str, Any]]:
        if not isinstance(samples, list):
            return []
        clean: list[dict[str, Any]] = []
        for sample in samples[-INKITT_PROGRESS_SAMPLE_LIMIT:]:
            if not isinstance(sample, dict):
                continue
            try:
                at = float(sample.get("at") or 0)
                crawled_chapters = int(sample.get("crawled_chapters") or 0)
                processed_count = int(sample.get("processed_count") or 0)
                total_chapters = int(sample.get("total_chapters") or 0)
            except (TypeError, ValueError):
                continue
            if at > 0:
                clean.append({
                    "at": at,
                    "crawled_chapters": max(0, crawled_chapters),
                    "processed_count": max(0, processed_count),
                    "total_chapters": max(0, total_chapters),
                })
        return clean

    def _append_progress_sample_locked(
        self,
        state: InkittBatchState,
        crawled_chapters: int,
        processed_count: int,
        total_chapters: int,
    ) -> None:
        if crawled_chapters <= 0 and processed_count <= 0:
            return
        now = time.time()
        sample = {
            "at": now,
            "crawled_chapters": int(crawled_chapters),
            "processed_count": int(processed_count),
            "total_chapters": int(total_chapters),
        }
        last = state.progress_samples[-1] if state.progress_samples else None
        if (
            isinstance(last, dict)
            and int(last.get("crawled_chapters") or 0) == sample["crawled_chapters"]
            and int(last.get("processed_count") or 0) == sample["processed_count"]
            and int(last.get("total_chapters") or 0) == sample["total_chapters"]
        ):
            return
        state.progress_samples.append(sample)
        if len(state.progress_samples) > INKITT_PROGRESS_SAMPLE_LIMIT:
            state.progress_samples = state.progress_samples[-INKITT_PROGRESS_SAMPLE_LIMIT:]

    def _crawl_elapsed_seconds(self, state: InkittBatchState, now_dt: datetime) -> float:
        elapsed = 0.0
        for run in state.crawl_runs:
            if not isinstance(run, dict):
                continue
            started = parse_local_datetime(run.get("started_at"))
            if started is None:
                continue
            finished = parse_local_datetime(run.get("finished_at"))
            if finished is None and run.get("status") == "crawling" and state.phase == "crawling":
                finished = now_dt
            if finished is None:
                continue
            elapsed += max(0.0, (finished - started).total_seconds())
        return elapsed

    def _recent_rates(self, state: InkittBatchState, now_ts: float) -> dict[str, float | None]:
        samples = self._normalize_progress_samples(state.progress_samples)
        if len(samples) < 2:
            return {"chapters_per_second": None, "stories_per_second": None, "window_seconds": None}
        latest = samples[-1]
        cutoff = now_ts - INKITT_RECENT_ESTIMATE_SECONDS
        candidates = [sample for sample in samples if sample["at"] >= cutoff]
        if len(candidates) < 2:
            candidates = samples[-min(len(samples), 20):]
        first = candidates[0]
        delta_seconds = latest["at"] - first["at"]
        if delta_seconds < 30:
            return {"chapters_per_second": None, "stories_per_second": None, "window_seconds": delta_seconds}
        delta_chapters = latest["crawled_chapters"] - first["crawled_chapters"]
        delta_stories = latest["processed_count"] - first["processed_count"]
        chapters_per_second = (delta_chapters / delta_seconds) if delta_chapters >= 5 else None
        stories_per_second = (delta_stories / delta_seconds) if delta_stories >= 2 else None
        return {
            "chapters_per_second": chapters_per_second,
            "stories_per_second": stories_per_second,
            "window_seconds": delta_seconds,
        }

    def _chapter_yield_ratio(
        self,
        completed: int,
        skipped: int,
        failed: int,
    ) -> float:
        processed_count = completed + skipped + failed
        if processed_count <= 0:
            return 1.0
        raw_success_ratio = completed / processed_count
        confidence = min(1.0, processed_count / max(1, INKITT_ESTIMATE_YIELD_CONFIDENCE_STORIES))
        return max(0.05, min(1.0, 1.0 - ((1.0 - raw_success_ratio) * confidence)))

    def _estimate_crawl_progress_locked(
        self,
        state: InkittBatchState,
        total: int,
        completed: int,
        skipped: int,
        failed: int,
        total_chapters: int,
        crawled_chapters: int,
    ) -> dict[str, Any]:
        now_dt = datetime.now()
        now_ts = time.time()
        processed_count = completed + skipped + failed
        remaining_stories = max(0, total - processed_count)
        completed_story_totals = [
            int(row.crawled_chapters or 0)
            for row in state.rows
            if row.status == "completed" and int(row.crawled_chapters or 0) > 0
        ]
        known_story_totals = [
            int(row.total_chapters or 0)
            for row in state.rows
            if int(row.total_chapters or 0) > 0
        ]
        average_exported_chapters = (sum(completed_story_totals) / len(completed_story_totals)) if completed_story_totals else 0.0
        average_known_chapters = (sum(known_story_totals) / len(known_story_totals)) if known_story_totals else 0.0
        average_unknown_chapters = average_exported_chapters or average_known_chapters
        active_remaining_chapters = 0
        queued_known_remaining_chapters = 0
        unknown_remaining_stories = 0
        for row in state.rows:
            if row.status in {"completed", "skipped", "failed"}:
                continue
            row_total = int(row.total_chapters or 0)
            if row_total > 0:
                row_remaining = max(0, row_total - int(row.crawled_chapters or 0))
                if row.status == "crawling":
                    active_remaining_chapters += row_remaining
                else:
                    queued_known_remaining_chapters += row_remaining
            else:
                unknown_remaining_stories += 1
        raw_known_remaining_chapters = active_remaining_chapters + queued_known_remaining_chapters
        chapter_yield_ratio = self._chapter_yield_ratio(completed, skipped, failed)
        estimated_unknown_chapters = int(round(unknown_remaining_stories * average_unknown_chapters * chapter_yield_ratio))
        estimated_remaining_chapters = max(
            0,
            active_remaining_chapters
            + int(round(queued_known_remaining_chapters * chapter_yield_ratio))
            + estimated_unknown_chapters,
        )
        estimated_total_chapters = crawled_chapters + estimated_remaining_chapters
        elapsed_seconds = self._crawl_elapsed_seconds(state, now_dt)
        all_time_chapters_per_second = (
            crawled_chapters / elapsed_seconds
            if elapsed_seconds >= 30 and crawled_chapters > 0
            else None
        )
        all_time_stories_per_second = (
            processed_count / elapsed_seconds
            if elapsed_seconds >= 30 and processed_count > 0
            else None
        )
        self._append_progress_sample_locked(state, crawled_chapters, processed_count, total_chapters)
        recent_rates = self._recent_rates(state, now_ts)
        recent_chapters_per_second = recent_rates["chapters_per_second"]
        recent_stories_per_second = recent_rates["stories_per_second"]
        estimate_chapters_per_second = recent_chapters_per_second or all_time_chapters_per_second
        source = "insufficient_data"
        if recent_chapters_per_second and all_time_chapters_per_second:
            estimate_chapters_per_second = (recent_chapters_per_second * 0.65) + (all_time_chapters_per_second * 0.35)
            source = "blended_chapters"
        elif recent_chapters_per_second:
            source = "recent_chapters"
        elif all_time_chapters_per_second:
            source = "all_time_chapters"

        remaining_seconds: int | None = None
        if remaining_stories == 0 or estimated_remaining_chapters == 0:
            remaining_seconds = 0
            source = "complete"
        elif estimate_chapters_per_second:
            remaining_seconds = int(round(estimated_remaining_chapters / estimate_chapters_per_second))
        elif all_time_stories_per_second:
            remaining_seconds = int(round(remaining_stories / all_time_stories_per_second))
            source = "all_time_stories"
        elif recent_stories_per_second:
            remaining_seconds = int(round(remaining_stories / recent_stories_per_second))
            source = "recent_stories"

        finished_at = (
            datetime.fromtimestamp(now_ts + remaining_seconds).strftime("%Y-%m-%d %H:%M:%S")
            if remaining_seconds is not None and remaining_seconds > 0
            else None
        )
        return {
            "remaining_stories": remaining_stories,
            "remaining_chapters": estimated_remaining_chapters,
            "known_remaining_chapters": raw_known_remaining_chapters,
            "raw_remaining_chapters": raw_known_remaining_chapters + int(round(unknown_remaining_stories * average_unknown_chapters)),
            "active_remaining_chapters": active_remaining_chapters,
            "chapter_yield_ratio": round(chapter_yield_ratio, 4),
            "estimated_total_chapters": estimated_total_chapters,
            "known_total_chapters": total_chapters,
            "elapsed_seconds": int(round(elapsed_seconds)),
            "chapters_per_hour": round(all_time_chapters_per_second * 3600, 2) if all_time_chapters_per_second else None,
            "recent_chapters_per_hour": round(recent_chapters_per_second * 3600, 2) if recent_chapters_per_second else None,
            "effective_chapters_per_hour": round(estimate_chapters_per_second * 3600, 2) if estimate_chapters_per_second else None,
            "stories_per_hour": round(all_time_stories_per_second * 3600, 2) if all_time_stories_per_second else None,
            "recent_stories_per_hour": round(recent_stories_per_second * 3600, 2) if recent_stories_per_second else None,
            "recent_window_seconds": int(round(recent_rates["window_seconds"] or 0)) if recent_rates["window_seconds"] else None,
            "estimated_remaining_seconds": remaining_seconds,
            "estimated_finished_at": finished_at,
            "source": source,
        }

    def _summary_locked(self, state: InkittBatchState) -> dict[str, Any]:
        total = len(state.rows)
        completed = sum(1 for row in state.rows if row.status == "completed")
        skipped = sum(1 for row in state.rows if row.status == "skipped")
        failed = sum(1 for row in state.rows if row.status == "failed")
        crawled_or_done = completed + skipped + failed
        total_chapters = sum(int(row.total_chapters or 0) for row in state.rows)
        crawled_chapters = sum(int(row.crawled_chapters or 0) for row in state.rows)
        crawl_estimate = self._estimate_crawl_progress_locked(
            state,
            total=total,
            completed=completed,
            skipped=skipped,
            failed=failed,
            total_chapters=total_chapters,
            crawled_chapters=crawled_chapters,
        )
        return {
            "batch_id": state.batch_id,
            "batch_name": state.batch_name,
            "phase": state.phase,
            "total_stories": total,
            "discovered_count": total,
            "completed_count": completed,
            "skipped_count": skipped,
            "failed_count": failed,
            "processed_count": crawled_or_done,
            "total_chapters": total_chapters,
            "crawled_chapters": crawled_chapters,
            "crawl_estimate": crawl_estimate,
            "download_ready": completed > 0 or self._has_downloadable_files(state),
            "error_message": state.error_message,
            "created_at": state.created_at,
            "started_at": state.started_at,
            "finished_at": state.finished_at,
            "max_pages_per_genre": state.max_pages_per_genre,
            "discover_concurrency": state.discover_concurrency,
            "crawl_concurrency": state.crawl_concurrency,
            "request_delay_seconds": state.request_delay_seconds,
            "selected_genres": state.selected_genres,
            "crawl_runs": self._crawl_run_summaries_locked(state),
            "cancel_requested": state.cancel_requested,
            "log_lines": state.log_lines[-180:],
        }

    def _crawl_run_summaries_locked(self, state: InkittBatchState) -> list[dict[str, Any]]:
        """Return recent runs with live counters for the active crawl.

        Stored run totals are finalized when a run ends. While it is active,
        derive them from its rows so status polling can show per-story and
        per-chapter progress immediately.
        """
        summaries: list[dict[str, Any]] = []
        for stored_run in state.crawl_runs[-20:]:
            run = dict(stored_run)
            run["processed_count"] = int(
                run.get("processed_count")
                or int(run.get("completed_count") or 0)
                + int(run.get("failed_count") or 0)
                + int(run.get("skipped_count") or 0)
            )
            if run.get("status") == "crawling" and not run.get("finished_at"):
                run_rows = [row for row in state.rows if row.crawl_run_id == run.get("run_id")]
                run["completed_count"] = sum(1 for row in run_rows if row.status == "completed")
                run["failed_count"] = sum(1 for row in run_rows if row.status == "failed")
                run["skipped_count"] = sum(1 for row in run_rows if row.status == "skipped")
                run["processed_count"] = (
                    run["completed_count"] + run["failed_count"] + run["skipped_count"]
                )
                run["crawled_chapters"] = sum(int(row.crawled_chapters or 0) for row in run_rows)
                run["total_chapters"] = sum(int(row.total_chapters or 0) for row in run_rows)
            summaries.append(run)
        return list(reversed(summaries))

    def _filtered_rows(self, state: InkittBatchState, status_filter: str) -> list[InkittBatchRow]:
        if status_filter == "all":
            return state.rows
        if status_filter in {"completed", "skipped", "failed", "queued", "crawling", "discovered"}:
            return [row for row in state.rows if row.status == status_filter]
        return state.rows

    def _available_rows_for_crawl_locked(
        self,
        state: InkittBatchState,
        max_stories: int | None,
    ) -> list[InkittBatchRow]:
        available_rows = [row for row in state.rows if row.status in {"queued", "discovered", "failed"}]
        available_rows.sort(key=lambda row: (0 if int(row.retry_priority or 0) > 0 else 1, -int(row.retry_priority or 0), row.index))
        if max_stories is not None:
            return available_rows[:max(1, int(max_stories))]
        return available_rows

    def _has_downloadable_files(self, state: InkittBatchState) -> bool:
        output_dir = Path(state.output_dir).resolve() if state.output_dir else self._batch_root / state.batch_id
        if not output_dir.exists() or not output_dir.is_dir() or not output_dir.is_relative_to(self._batch_root):
            return False
        return any(path.is_file() and not path.is_symlink() for path in output_dir.rglob("*.md"))

    def _get_state_locked(self, batch_id: str) -> InkittBatchState:
        if not re.fullmatch(r"[0-9a-f]{8}", batch_id or ""):
            raise KeyError("Invalid batch identifier.")
        state = self._batches.get(batch_id)
        if state is None:
            raise KeyError(f"Inkitt batch '{batch_id}' was not found.")
        return state

    def _load_index(self) -> None:
        if not self._index_file.exists():
            return
        try:
            payload = json.loads(self._index_file.read_text(encoding="utf-8"))
            entries = payload.get("batches") if isinstance(payload, dict) else payload
            if not isinstance(entries, list):
                return
            for entry in entries:
                if not isinstance(entry, dict):
                    continue
                batch_id = str(entry.get("batch_id") or "")
                if not re.fullmatch(r"[0-9a-f]{8}", batch_id):
                    continue
                rows = [InkittBatchRow(**row) for row in entry.get("rows", []) if isinstance(row, dict)]
                phase = entry.get("phase") or "failed"
                cancel_requested = bool(entry.get("cancel_requested") or False)
                error_message = str(entry.get("error_message") or "")
                log_lines = list(entry.get("log_lines") or [])
                if phase in {"running", "crawling"}:
                    phase = "ready"
                    cancel_requested = False
                    error_message = ""
                    log_lines.append(f"{datetime.now().strftime('%H:%M:%S')} Crawl paused by service restart; queued work can be resumed.")
                    for row in rows:
                        if row.status in {"crawling", "discovered"}:
                            row.status = "queued"
                            row.error = ""
                elif phase == "discovering":
                    phase = "failed"
                    cancel_requested = False
                    error_message = "Discovery was interrupted by a service restart. Start a new discovery to rebuild the catalog."
                    log_lines.append(f"{datetime.now().strftime('%H:%M:%S')} Discovery interrupted by service restart.")
                state = InkittBatchState(
                    batch_id=batch_id,
                    created_by_user_id=entry.get("created_by_user_id"),
                    rows=rows,
                    batch_name=entry.get("batch_name") or "Inkitt batch",
                    phase=phase,
                    error_message=error_message,
                    created_at=entry.get("created_at") or datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                    started_at=entry.get("started_at"),
                    finished_at=entry.get("finished_at"),
                    max_pages_per_genre=int(entry.get("max_pages_per_genre") or 3),
                    discover_concurrency=int(entry.get("discover_concurrency") or 4),
                    crawl_concurrency=int(entry.get("crawl_concurrency") or 4),
                    request_delay_seconds=float(entry.get("request_delay_seconds") or 1.0),
                    output_dir=entry.get("output_dir") or str(self._batch_root / batch_id),
                    selected_genres=list(entry.get("selected_genres") or [slug for slug, _label in INKITT_GENRES]),
                    crawl_runs=list(entry.get("crawl_runs") or []),
                    cancel_requested=cancel_requested,
                    log_lines=log_lines[-INKITT_BATCH_MEMORY_LOG_LINES:],
                    log_file=entry.get("log_file") or str(self._log_file_for_batch(batch_id)),
                    progress_samples=self._normalize_progress_samples(entry.get("progress_samples")),
                )
                self._seed_log_file_if_missing(state)
                self._batches[batch_id] = state
            if self._batches:
                self._persist_locked(force=True)
        except Exception as exc:
            logger.warning("Failed to load Inkitt batch index: %s", exc)

    def _seed_log_file_if_missing(self, state: InkittBatchState) -> None:
        if not state.log_file or not state.log_lines:
            return
        try:
            log_file = Path(state.log_file).resolve()
            if not log_file.is_relative_to(self._batch_root) or log_file.exists():
                return
            log_file.parent.mkdir(parents=True, exist_ok=True)
            log_file.write_text("\n".join(state.log_lines) + "\n", encoding="utf-8")
        except Exception as exc:
            logger.warning("Failed to seed Inkitt batch full log: %s", exc)

    def _persist_locked(self, force: bool = False) -> None:
        now = time.time()
        if not force and now - self._last_persist_at < 2.0:
            return
        self._last_persist_at = now
        tmp_path = self._index_file.with_suffix(".tmp")
        payload = {"batches": [asdict(state) for state in self._batches.values()]}
        try:
            tmp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
            tmp_path.replace(self._index_file)
        except Exception as exc:
            logger.warning("Failed to persist Inkitt batch index: %s", exc)


def classify_inkitt_crawl_error(message: str) -> dict[str, str]:
    lowered = message.lower()
    if is_inkitt_subscription_gate(lowered):
        return {"status": "skipped", "error": "Skipped paid/subscription-gated story."}
    if is_inkitt_login_gate(lowered):
        return {
            "status": "failed",
            "error": (
                "Inkitt needs fresh login cookies for this story. "
                "Save Inkitt user_credentials/cf_clearance in Settings from the same VPN/IP, then retry this row."
            ),
        }
    return {"status": "failed", "error": message}


def is_inkitt_login_gate(lowered_message: str) -> bool:
    login_markers = (
        "requires login",
        "login required",
        "asked for login",
        "log in to inkitt",
        "log in to continue",
        "login to continue",
        "please log in",
        "please login",
        "sign up to continue",
        "user_credentials",
    )
    return any(marker in lowered_message for marker in login_markers)


def is_inkitt_subscription_gate(lowered_message: str) -> bool:
    subscription_markers = (
        "subscription",
        "patron",
        "patrons only",
        "paid chapter",
        "paid story",
        "requires payment",
    )
    return any(marker in lowered_message for marker in subscription_markers)


def extract_completed_story_refs(soup: BeautifulSoup, genre_slug: str, genre_label: str) -> list[dict[str, Any]]:
    refs: dict[str, dict[str, Any]] = {}
    for anchor in soup.select("a[href*='/stories/']"):
        href = str(anchor.get("href") or "")
        match = re.search(r"/stories/(\d+)", href)
        if not match:
            continue
        title = clean_text(anchor.get_text(" ", strip=True))
        if not title or title.lower() in {"read now", "continue reading"}:
            continue
        block = find_story_block(anchor)
        text = clean_text(block.get_text(" ", strip=True) if block else anchor.parent.get_text(" ", strip=True))
        if re.search(r"\b(?:Ongoing|Excerpt)\s*[\u2022\-]\s*\d+\s+chapters?\b", text, re.IGNORECASE):
            continue
        if not re.search(r"\bComplete\b", text, re.IGNORECASE):
            continue
        chapter_match = re.search(r"\bComplete\s*[\u2022\-]\s*(\d+)\s+chapters?\b", text, re.IGNORECASE)
        review_match = re.search(r"Show Reviews\s*\(([\d,]+)\)", text, re.IGNORECASE)
        author_match = re.search(r"\bby\s+(.+?)\s*[\u2022\-]\s*Complete\b", text, re.IGNORECASE)
        story_id = match.group(1)
        refs[story_id] = {
            "genre": genre_label,
            "genre_slug": genre_slug,
            "title": title,
            "url": urllib_join(href),
            "story_id": story_id,
            "author": clean_text(author_match.group(1)) if author_match else "",
            "total_chapters": int(chapter_match.group(1)) if chapter_match else None,
            "review_count": int(review_match.group(1).replace(",", "")) if review_match else None,
        }
    return list(refs.values())


def extract_completed_story_refs_from_api(payload: dict[str, Any], genre_slug: str, genre_label: str) -> list[dict[str, Any]]:
    refs: dict[str, dict[str, Any]] = {}
    stories = payload.get("stories") if isinstance(payload, dict) else None
    if not isinstance(stories, list):
        return []

    for story in stories:
        if not isinstance(story, dict):
            continue
        story_id = str(story.get("id") or "").strip()
        title = clean_text(str(story.get("title") or story.get("test_title") or ""))
        if not story_id or not title:
            continue
        if str(story.get("story_status") or "").lower() != "complete":
            continue
        if story.get("for_patrons_only") is True:
            continue

        user = story.get("user") if isinstance(story.get("user"), dict) else {}
        author = clean_text(str(user.get("name") or user.get("username") or ""))
        rating = story.get("overall_rating_cache")
        review_count = story.get("reviews_count")
        chapter_count = story.get("chapters_count")
        refs[story_id] = {
            "genre": genre_label,
            "genre_slug": genre_slug,
            "title": title,
            "url": f"https://www.inkitt.com/stories/{story_id}",
            "story_id": story_id,
            "author": author,
            "total_chapters": int(chapter_count) if isinstance(chapter_count, int) else None,
            "rating": float(rating) if isinstance(rating, (int, float)) else None,
            "review_count": int(review_count) if isinstance(review_count, int) else None,
        }
    return list(refs.values())


def find_story_block(anchor: Tag) -> Tag | None:
    current: Tag | None = anchor
    best: Tag | None = None
    for _ in range(8):
        if current is None:
            break
        text = clean_text(current.get_text(" ", strip=True))
        if ("Complete" in text or "Ongoing" in text or "Excerpt" in text) and "chapters" in text and 20 <= len(text) <= 3000:
            best = current
            break
        parent = current.parent if isinstance(current.parent, Tag) else None
        current = parent
    return best


def extract_story_quality(soup: BeautifulSoup) -> dict[str, Any]:
    rating_raw = extract_label_value(soup, "Rating")
    rating = None
    review_count = None
    if rating_raw:
        rating_match = re.search(r"(\d+(?:\.\d+)?)", rating_raw)
        review_match = re.search(r"([\d,]+)\s+reviews?", rating_raw, re.IGNORECASE)
        rating = parse_float(rating_match.group(1)) if rating_match else None
        review_count = int(review_match.group(1).replace(",", "")) if review_match else None

    text = clean_text(soup.get_text(" ", strip=True))
    read_count = None
    read_match = re.search(r"([\d,.]+)\s*([KMB])?\s*(?:reads|readers|views)\b", text, re.IGNORECASE)
    if read_match:
        read_count = parse_compact_number(read_match.group(1), read_match.group(2))

    tags = []
    for anchor in soup.select("a[href*='/genres/'], a[href*='/topics/']"):
        value = clean_text(anchor.get_text(" ", strip=True))
        if value and value not in tags:
            tags.append(value)

    return {
        "rating": rating,
        "review_count": review_count,
        "read_count": read_count,
        "tags": tags or None,
    }


def extract_label_value(soup: BeautifulSoup, label: str) -> str:
    text = soup.get_text("\n", strip=True)
    match = re.search(rf"^{re.escape(label)}\s*\n\s*([^\n]+)", text, re.IGNORECASE | re.MULTILINE)
    return clean_text(match.group(1)) if match else ""


def format_combined_markdown(metadata: dict[str, Any], source_url: str, chapters: list[tuple[int, str, str, str]]) -> str:
    title = metadata.get("title") or "Inkitt Story"
    lines = [
        f"# {title}",
        "",
        f"Source: {source_url}",
    ]
    authors = metadata.get("authors")
    if authors:
        lines.append(f"Author: {', '.join(str(author) for author in authors)}")
    if metadata.get("rating") is not None:
        lines.append(f"Rating: {metadata['rating']}")
    if metadata.get("review_count") is not None:
        lines.append(f"Reviews: {metadata['review_count']}")
    if metadata.get("read_count") is not None:
        lines.append(f"Reads: {metadata['read_count']}")
    lines.extend([
        f"Chapters crawled: {len(chapters)}",
        "",
    ])

    for chapter_number, chapter_title, content, chapter_url in chapters:
        lines.extend([
            "---",
            "",
            f"## Chapter {chapter_number}: {chapter_title}",
            "",
            f"Source: {chapter_url}",
            "",
            content.strip(),
            "",
        ])
    return "\n".join(lines).rstrip() + "\n"


def normalize_genres(genres: list[str] | None) -> list[str]:
    valid = {slug for slug, _label in INKITT_GENRES}
    if not genres:
        return [slug for slug, _label in INKITT_GENRES]
    selected = []
    for genre in genres:
        slug = str(genre).strip().lower()
        if slug in valid and slug not in selected:
            selected.append(slug)
    return selected or [slug for slug, _label in INKITT_GENRES]


def normalize_catalog_ref(ref: Any) -> dict[str, Any] | None:
    if not isinstance(ref, dict):
        return None
    story_id = str(ref.get("story_id") or "").strip()
    title = clean_text(str(ref.get("title") or ""))
    url = str(ref.get("url") or "").strip()
    genre_slug = str(ref.get("genre_slug") or "").strip()
    if not story_id or not title or not url or not genre_slug:
        return None
    genre_labels = dict(INKITT_GENRES)
    normalized: dict[str, Any] = {
        "genre": clean_text(str(ref.get("genre") or genre_labels.get(genre_slug) or genre_slug)),
        "genre_slug": genre_slug,
        "title": title,
        "url": url,
        "story_id": story_id,
        "author": clean_text(str(ref.get("author") or "")),
        "total_chapters": int(ref["total_chapters"]) if isinstance(ref.get("total_chapters"), int) else None,
        "rating": float(ref["rating"]) if isinstance(ref.get("rating"), (int, float)) else None,
        "review_count": int(ref["review_count"]) if isinstance(ref.get("review_count"), int) else None,
        "read_count": int(ref["read_count"]) if isinstance(ref.get("read_count"), int) else None,
    }
    return normalized


def parse_compact_number(value: str, suffix: str | None) -> int | None:
    try:
        number = float(value.replace(",", ""))
    except ValueError:
        return None
    multiplier = {"K": 1_000, "M": 1_000_000, "B": 1_000_000_000}.get((suffix or "").upper(), 1)
    return int(number * multiplier)


def parse_float(value: Any) -> float | None:
    try:
        return float(str(value).strip())
    except (TypeError, ValueError):
        return None


def parse_retry_after(value: str | None) -> float | None:
    if not value:
        return None
    try:
        return max(0.0, float(value))
    except ValueError:
        return None


def parse_local_datetime(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.strptime(str(value), "%Y-%m-%d %H:%M:%S")
    except ValueError:
        return None


def should_use_rendered_fallback(content: str) -> bool:
    text = clean_text(content)
    if not text:
        return True
    words = text.split()
    if len(words) > INKITT_RENDERED_FALLBACK_SUSPICIOUS_WORDS:
        return False
    suspicious = (
        "about the author",
        "follow +",
        "write a review",
        "add to reading list",
        "next chapter",
    )
    lowered = text.lower()
    if any(marker in lowered for marker in suspicious):
        return True
    if len(words) < INKITT_RENDERED_FALLBACK_TINY_WORDS:
        return True
    return False


def clean_text(text: str) -> str:
    return re.sub(r"[\s\u00a0]+", " ", (text or "").replace("\ufeff", " ")).strip()


def urllib_join(href: str) -> str:
    import urllib.parse

    return urllib.parse.urljoin("https://www.inkitt.com", href)


def clamp(value: int, low: int, high: int) -> int:
    return max(low, min(high, int(value)))


def load_saved_inkitt_cookies() -> tuple[list[dict[str, Any]], str | None]:
    try:
        from api.db import SessionLocal
        from api.repositories.inkitt_cookie_repository import InkittCookieRepository

        db = SessionLocal()
        try:
            repo = InkittCookieRepository(db)
            rows = repo.get_valid()
            user_agent = repo.get_user_agent()
            cookies = [
                {"name": row.name, "value": row.value, "domain": row.domain, "path": row.path}
                for row in rows
            ]
            if cookies:
                return cookies, user_agent
        finally:
            db.close()
    except Exception:
        pass

    cookie_files = [
        Path(__file__).resolve().parents[2] / "handlers" / "selenium_cookies_www_inkitt_com.json",
        Path(__file__).resolve().parents[2] / "handlers" / "selenium_cookies.json",
    ]
    for cookie_file in cookie_files:
        if not cookie_file.exists():
            continue
        try:
            raw = json.loads(cookie_file.read_text(encoding="utf-8"))
        except Exception:
            continue
        if not isinstance(raw, list):
            continue
        cookies = []
        for item in raw:
            if not isinstance(item, dict) or not item.get("name") or item.get("value") is None:
                continue
            cookies.append({
                "name": item.get("name"),
                "value": item.get("value"),
                "domain": item.get("domain", ".inkitt.com"),
                "path": item.get("path", "/"),
            })
        if cookies:
            return cookies, None
    return [], None


_inkitt_batch_service: InkittBatchService | None = None


def get_inkitt_batch_service() -> InkittBatchService:
    global _inkitt_batch_service
    if _inkitt_batch_service is None:
        _inkitt_batch_service = InkittBatchService()
    return _inkitt_batch_service
