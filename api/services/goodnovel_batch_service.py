"""GoodNovel batch title search and free-chapter export service."""

from __future__ import annotations

import logging
import json
import math
import os
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

from api.services.goodnovel_api import GoodNovelApiClient, GoodNovelSearchResult
from configs.base_config import load_site_config
from utils.cleaner import build_promo_patterns, clean_chapter_content
from utils.sanitize import sanitize_filename

logger = logging.getLogger(__name__)

GOODNOVEL_BATCH_MAX_TITLES = int(os.getenv("GOODNOVEL_BATCH_MAX_TITLES", "12000"))
GOODNOVEL_BATCH_MAX_SCAN_WORKERS = int(os.getenv("GOODNOVEL_BATCH_MAX_SCAN_WORKERS", "8"))
GOODNOVEL_BATCH_MAX_CRAWL_WORKERS = int(os.getenv("GOODNOVEL_BATCH_MAX_CRAWL_WORKERS", "8"))

ScanStatus = Literal["pending", "found", "not_found", "ambiguous", "error"]
CrawlStatus = Literal["pending", "queued", "crawling", "completed", "failed", "skipped"]
BatchPhase = Literal["scanning", "scan_completed", "crawling", "completed", "failed"]


@dataclass
class GoodNovelBatchRow:
    index: int
    input_title: str
    status: ScanStatus = "pending"
    matched_title: str = ""
    author: str = ""
    url: str = ""
    book_id: str = ""
    score: float = 0.0
    total_chapters: int | None = None
    free_chapters: int | None = None
    paid_chapters: int | None = None
    crawled_chapters: int = 0
    crawl_status: CrawlStatus = "pending"
    output_file: str = ""
    folder_path: str = ""
    error: str = ""
    candidates: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "index": self.index,
            "input_title": self.input_title,
            "status": self.status,
            "matched_title": self.matched_title,
            "author": self.author,
            "url": self.url,
            "book_id": self.book_id,
            "score": self.score,
            "total_chapters": self.total_chapters,
            "free_chapters": self.free_chapters,
            "paid_chapters": self.paid_chapters,
            "crawled_chapters": self.crawled_chapters,
            "crawl_status": self.crawl_status,
            "output_file": self.output_file,
            "folder_path": self.folder_path,
            "error": self.error,
            "candidates": self.candidates,
        }


@dataclass
class GoodNovelBatchState:
    batch_id: str
    created_by_user_id: str | None
    rows: list[GoodNovelBatchRow]
    batch_name: str = ""
    phase: BatchPhase = "scanning"
    error_message: str = ""
    created_at: str = field(default_factory=lambda: datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
    started_at: str | None = None
    finished_at: str | None = None
    scan_concurrency: int = 4
    crawl_concurrency: int = 3
    split_mode: Literal["stories_per_folder", "folder_count"] = "stories_per_folder"
    stories_per_folder: int = 100
    folder_count: int | None = None
    output_dir: str = ""
    log_lines: list[str] = field(default_factory=list)

    def add_log(self, message: str) -> None:
        self.log_lines.append(f"{datetime.now().strftime('%H:%M:%S')} {message}")
        if len(self.log_lines) > 200:
            self.log_lines = self.log_lines[-200:]


class GoodNovelBatchService:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._batches: dict[str, GoodNovelBatchState] = {}
        self._project_root = Path(__file__).parent.parent.parent.resolve()
        self._batch_root = (self._project_root / "output" / "goodnovel_batch").resolve()
        self._batch_root.mkdir(parents=True, exist_ok=True)
        self._index_file = self._batch_root / "batch_index.json"
        self._last_persist_at = 0.0
        cfg = load_site_config("goodnovel")
        self._promo_patterns = build_promo_patterns(cfg.get("promo_patterns", []))
        self._load_index()

    def start_scan(
        self,
        titles_text: str,
        delimiter: str,
        scan_concurrency: int,
        created_by_user_id: str | None,
        batch_name: str = "",
    ) -> GoodNovelBatchState:
        titles = parse_titles(titles_text, delimiter)
        if not titles:
            raise ValueError("No story titles found in the uploaded text.")
        if len(titles) > GOODNOVEL_BATCH_MAX_TITLES:
            raise ValueError(f"Batch title count exceeds the {GOODNOVEL_BATCH_MAX_TITLES} title limit.")

        batch_id = uuid.uuid4().hex[:8]
        rows = [
            GoodNovelBatchRow(index=index, input_title=title)
            for index, title in enumerate(titles, start=1)
        ]
        state = GoodNovelBatchState(
            batch_id=batch_id,
            created_by_user_id=created_by_user_id,
            rows=rows,
            batch_name=(batch_name or f"GoodNovel batch {len(rows)} titles").strip(),
            scan_concurrency=clamp(scan_concurrency, 1, GOODNOVEL_BATCH_MAX_SCAN_WORKERS),
            started_at=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        )
        state.add_log(f"Scan queued for {len(rows)} title(s).")

        with self._lock:
            self._batches[batch_id] = state
            self._persist_locked(force=True)

        thread = threading.Thread(target=self._scan_thread, args=(batch_id,), daemon=True)
        thread.start()
        return state

    def start_crawl(
        self,
        batch_id: str,
        split_mode: Literal["stories_per_folder", "folder_count"],
        stories_per_folder: int,
        folder_count: int | None,
        crawl_concurrency: int,
        request_delay_seconds: float,
    ) -> GoodNovelBatchState:
        with self._lock:
            state = self._get_state_locked(batch_id)
            if state.phase not in ("scan_completed", "completed", "failed"):
                raise ValueError("Batch scan must finish before crawling can start.")
            selected = [row for row in state.rows if is_crawlable_row(row)]
            if not selected:
                raise ValueError("No GoodNovel story links are available to crawl.")

            state.phase = "crawling"
            state.error_message = ""
            state.finished_at = None
            state.started_at = state.started_at or datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            state.split_mode = split_mode
            state.stories_per_folder = max(1, stories_per_folder)
            state.folder_count = folder_count if folder_count and folder_count > 0 else None
            state.crawl_concurrency = clamp(crawl_concurrency, 1, GOODNOVEL_BATCH_MAX_CRAWL_WORKERS)
            state.output_dir = str(self._prepare_output_dir(batch_id))
            for row in state.rows:
                if is_crawlable_row(row):
                    row.crawl_status = "queued"
                    row.crawled_chapters = 0
                    row.output_file = ""
                    row.folder_path = ""
                    row.error = ""
            state.add_log(f"Crawl queued for {len(selected)} story link(s).")
            self._persist_locked(force=True)

        thread = threading.Thread(
            target=self._crawl_thread,
            args=(batch_id, max(0.0, request_delay_seconds)),
            daemon=True,
        )
        thread.start()
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

    def list_rows(
        self,
        batch_id: str,
        offset: int,
        limit: int,
        status_filter: str = "all",
    ) -> dict[str, Any]:
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

    def require_owner(self, batch_id: str, user_id: str | None, role: str | None) -> None:
        from fastapi import HTTPException

        with self._lock:
            state = self._get_state_locked(batch_id)
            owner = state.created_by_user_id
        if role in {"admin", "operator"}:
            return
        if owner and user_id and owner == user_id:
            return
        raise HTTPException(status_code=403, detail="Access denied for this GoodNovel batch.")

    def get_download_files(self, batch_id: str) -> tuple[GoodNovelBatchState, list[tuple[Path, str]]]:
        with self._lock:
            state = self._get_state_locked(batch_id)
            if state.phase != "completed":
                raise ValueError("Batch crawl is not completed yet.")
            output_dir = Path(state.output_dir).resolve() if state.output_dir else self._batch_root / batch_id

        if not output_dir.exists() or not output_dir.is_dir():
            raise FileNotFoundError("Batch output folder was not found.")
        if not output_dir.is_relative_to(self._batch_root):
            raise ValueError("Batch output path escapes the batch root.")

        files: list[tuple[Path, str]] = []
        for path in sorted(output_dir.rglob("*.md")):
            if path.is_file() and not path.is_symlink():
                archive_name = str(path.relative_to(output_dir)).replace("\\", "/")
                files.append((path, archive_name))
        if not files:
            raise FileNotFoundError("No combined story files were created for this batch.")
        return state, files

    def _scan_thread(self, batch_id: str) -> None:
        with self._lock:
            state = self._batches.get(batch_id)
            if state is None:
                return
            rows = list(state.rows)
            max_workers = state.scan_concurrency

        try:
            with ThreadPoolExecutor(max_workers=max_workers) as pool:
                futures = {
                    pool.submit(self._scan_one, row.input_title): row.index
                    for row in rows
                }
                for future in as_completed(futures):
                    row_index = futures[future]
                    try:
                        update = future.result()
                    except Exception as exc:
                        logger.warning("[goodnovel-batch/%s] scan failed for row %s: %s", batch_id, row_index, exc)
                        update = {
                            "status": "error",
                            "error": str(exc),
                            "candidates": [],
                        }

                    with self._lock:
                        state = self._batches.get(batch_id)
                        if state is None:
                            return
                        row = state.rows[row_index - 1]
                        for key, value in update.items():
                            setattr(row, key, value)
                        self._persist_locked()
                        self._persist_locked()

            with self._lock:
                state = self._batches.get(batch_id)
                if state is None:
                    return
                state.phase = "scan_completed"
                state.finished_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                state.add_log("Scan completed.")
                self._persist_locked(force=True)
        except Exception as exc:
            logger.exception("[goodnovel-batch/%s] scan failed", batch_id)
            with self._lock:
                state = self._batches.get(batch_id)
                if state:
                    state.phase = "failed"
                    state.error_message = str(exc)
                    state.finished_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                    state.add_log(f"Scan failed: {exc}")
                    self._persist_locked(force=True)

    def _scan_one(self, title: str) -> dict[str, Any]:
        client = GoodNovelApiClient(timeout=20, retries=1, load_db_cookies=False)
        results = client.search_stories(title, limit=5)
        candidates = [search_result_to_candidate(result) for result in results[:3]]
        best = client.best_search_match(title, results, min_score=0.96)
        if best:
            return {
                "status": "found",
                "matched_title": best.title,
                "author": best.author,
                "url": best.url,
                "book_id": best.book_id,
                "score": round(best.score, 4),
                "candidates": candidates,
            }
        if results:
            top = results[0]
            return {
                "status": "ambiguous",
                "matched_title": top.title,
                "author": top.author,
                "url": top.url,
                "book_id": top.book_id,
                "score": round(top.score, 4),
                "candidates": candidates,
                "error": "No high-confidence exact title match.",
            }
        return {
            "status": "not_found",
            "error": "No GoodNovel search results found.",
            "candidates": [],
        }

    def _crawl_thread(self, batch_id: str, request_delay_seconds: float) -> None:
        with self._lock:
            state = self._batches.get(batch_id)
            if state is None:
                return
            selected = [row for row in state.rows if is_crawlable_row(row)]
            max_workers = state.crawl_concurrency
            output_dir = Path(state.output_dir).resolve()
            groups = self._build_group_plan_locked(state, len(selected))
            row_jobs = [
                (row.index, position, groups[position])
                for position, row in enumerate(selected)
            ]

        try:
            with ThreadPoolExecutor(max_workers=max_workers) as pool:
                futures = {
                    pool.submit(
                        self._crawl_one,
                        batch_id,
                        row_index,
                        position,
                        group_name,
                        output_dir,
                        request_delay_seconds,
                    ): row_index
                    for row_index, position, group_name in row_jobs
                }
                for future in as_completed(futures):
                    row_index = futures[future]
                    try:
                        update = future.result()
                    except Exception as exc:
                        logger.warning("[goodnovel-batch/%s] crawl failed for row %s: %s", batch_id, row_index, exc)
                        update = {
                            "crawl_status": "failed",
                            "error": str(exc),
                        }
                    with self._lock:
                        state = self._batches.get(batch_id)
                        if state is None:
                            return
                        row = state.rows[row_index - 1]
                        for key, value in update.items():
                            setattr(row, key, value)

            with self._lock:
                state = self._batches.get(batch_id)
                if state is None:
                    return
                failed = [row for row in state.rows if row.crawl_status == "failed"]
                completed = [row for row in state.rows if row.crawl_status == "completed"]
                state.phase = "completed"
                state.finished_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                state.add_log(f"Crawl completed: {len(completed)} story file(s), {len(failed)} failed.")
                self._persist_locked(force=True)
        except Exception as exc:
            logger.exception("[goodnovel-batch/%s] crawl failed", batch_id)
            with self._lock:
                state = self._batches.get(batch_id)
                if state:
                    state.phase = "failed"
                    state.error_message = str(exc)
                    state.finished_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                    state.add_log(f"Crawl failed: {exc}")
                    self._persist_locked(force=True)

    def _crawl_one(
        self,
        batch_id: str,
        row_index: int,
        position: int,
        group_name: str,
        output_dir: Path,
        request_delay_seconds: float,
    ) -> dict[str, Any]:
        with self._lock:
            state = self._batches.get(batch_id)
            if state is None:
                raise ValueError("Batch no longer exists.")
            row = state.rows[row_index - 1]
            row.crawl_status = "crawling"
            source_url = row.url
            original_title = row.input_title
            self._persist_locked()

        client = GoodNovelApiClient(timeout=25, retries=2, load_db_cookies=False)
        story = client.resolve_story(source_url)
        free_refs = [ref for ref in story.chapters if not ref.charge]
        paid_count = max(0, len(story.chapters) - len(free_refs))

        if not free_refs:
            return {
                "matched_title": story.title or original_title,
                "author": story.author,
                "total_chapters": len(story.chapters),
                "free_chapters": 0,
                "paid_chapters": paid_count,
                "crawl_status": "skipped",
                "error": "No free chapters available.",
            }

        chapters: list[tuple[int, str, str, str]] = []
        for ref in free_refs:
            data = client.fetch_chapter(ref)
            if data.is_locked or not data.content:
                continue
            cleaned = clean_chapter_content(data.content, self._promo_patterns)
            if cleaned:
                chapters.append((ref.chapter_number, data.title or ref.title, cleaned, ref.url))
            if request_delay_seconds > 0:
                time.sleep(request_delay_seconds)

        if not chapters:
            return {
                "matched_title": story.title or original_title,
                "author": story.author,
                "total_chapters": len(story.chapters),
                "free_chapters": len(free_refs),
                "paid_chapters": paid_count,
                "crawl_status": "skipped",
                "error": "GoodNovel returned no readable free chapter content.",
            }

        story_folder_name = f"{position + 1:04d}_{sanitize_filename(story.title or original_title)}_{story.book_id}"
        story_dir = output_dir / group_name / story_folder_name
        story_dir.mkdir(parents=True, exist_ok=True)
        filename = f"GoodNovel_{sanitize_filename(story.title or original_title)}.md"
        md_path = story_dir / filename
        md_text = self._format_combined_markdown(story, source_url, chapters)
        md_path.write_text(md_text, encoding="utf-8")

        return {
            "matched_title": story.title or original_title,
            "author": story.author,
            "book_id": story.book_id,
            "url": source_url,
            "total_chapters": len(story.chapters),
            "free_chapters": len(free_refs),
            "paid_chapters": paid_count,
            "crawled_chapters": len(chapters),
            "crawl_status": "completed",
            "folder_path": str((Path(group_name) / story_folder_name)).replace("\\", "/"),
            "output_file": str((Path(group_name) / story_folder_name / filename)).replace("\\", "/"),
            "error": "",
        }

    def _format_combined_markdown(
        self,
        story,
        source_url: str,
        chapters: list[tuple[int, str, str, str]],
    ) -> str:
        lines = [
            f"# {story.title}",
            "",
            f"Source: {source_url}",
            f"GoodNovel book ID: {story.book_id}",
        ]
        if story.author:
            lines.append(f"Author: {story.author}")
        lines.extend([
            f"Free chapters crawled: {len(chapters)}",
            "",
        ])

        for chapter_number, title, content, chapter_url in chapters:
            lines.extend([
                "---",
                "",
                f"## Chapter {chapter_number}: {title}",
                "",
                f"Source: {chapter_url}",
                "",
                content.strip(),
                "",
            ])
        return "\n".join(lines).rstrip() + "\n"

    def _prepare_output_dir(self, batch_id: str) -> Path:
        output_dir = (self._batch_root / batch_id).resolve()
        if not output_dir.is_relative_to(self._batch_root):
            raise ValueError("Batch output path escapes the batch root.")
        if output_dir.exists():
            shutil.rmtree(output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)
        return output_dir

    def _build_group_plan_locked(self, state: GoodNovelBatchState, total: int) -> list[str]:
        if total <= 0:
            return []
        if state.split_mode == "folder_count" and state.folder_count:
            folder_count = clamp(state.folder_count, 1, total)
            per_folder = max(1, math.ceil(total / folder_count))
        else:
            per_folder = max(1, state.stories_per_folder)
            folder_count = max(1, math.ceil(total / per_folder))
        return [
            f"goodnovel_batch_{(position // per_folder) + 1:03d}_of_{folder_count:03d}"
            for position in range(total)
        ]

    def _summary_locked(self, state: GoodNovelBatchState) -> dict[str, Any]:
        scanned_count = sum(1 for row in state.rows if row.status != "pending")
        found_count = sum(1 for row in state.rows if row.status == "found")
        not_found_count = sum(1 for row in state.rows if row.status == "not_found")
        ambiguous_count = sum(1 for row in state.rows if row.status == "ambiguous")
        scan_error_count = sum(1 for row in state.rows if row.status == "error")
        crawl_total = sum(1 for row in state.rows if is_crawlable_row(row))
        crawled_count = sum(1 for row in state.rows if row.crawl_status == "completed")
        crawl_failed_count = sum(1 for row in state.rows if row.crawl_status == "failed")
        crawl_skipped_count = sum(1 for row in state.rows if row.crawl_status == "skipped")
        download_ready = state.phase == "completed" and crawled_count > 0
        folder_count = None
        if crawl_total:
            if state.split_mode == "folder_count" and state.folder_count:
                folder_count = clamp(state.folder_count, 1, crawl_total)
            else:
                folder_count = math.ceil(crawl_total / max(1, state.stories_per_folder))

        return {
            "batch_id": state.batch_id,
            "batch_name": state.batch_name,
            "phase": state.phase,
            "total_titles": len(state.rows),
            "scanned_count": scanned_count,
            "found_count": found_count,
            "not_found_count": not_found_count,
            "ambiguous_count": ambiguous_count,
            "scan_error_count": scan_error_count,
            "crawl_total": crawl_total,
            "crawled_count": crawled_count,
            "crawl_failed_count": crawl_failed_count,
            "crawl_skipped_count": crawl_skipped_count,
            "download_ready": download_ready,
            "error_message": state.error_message,
            "created_at": state.created_at,
            "started_at": state.started_at,
            "finished_at": state.finished_at,
            "scan_concurrency": state.scan_concurrency,
            "crawl_concurrency": state.crawl_concurrency,
            "split_mode": state.split_mode,
            "stories_per_folder": state.stories_per_folder,
            "folder_count": folder_count,
            "log_lines": state.log_lines[-50:],
        }

    def _filtered_rows(self, state: GoodNovelBatchState, status_filter: str) -> list[GoodNovelBatchRow]:
        if status_filter == "all":
            return state.rows
        if status_filter == "crawl_failed":
            return [row for row in state.rows if row.crawl_status == "failed"]
        if status_filter == "crawled":
            return [row for row in state.rows if row.crawl_status == "completed"]
        allowed = {"found", "not_found", "ambiguous", "error", "pending"}
        if status_filter in allowed:
            return [row for row in state.rows if row.status == status_filter]
        return state.rows

    def _get_state_locked(self, batch_id: str) -> GoodNovelBatchState:
        if not re.fullmatch(r"[0-9a-f]{8}", batch_id or ""):
            raise KeyError("Invalid batch identifier.")
        state = self._batches.get(batch_id)
        if state is None:
            raise KeyError(f"GoodNovel batch '{batch_id}' was not found.")
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
                rows = [
                    GoodNovelBatchRow(**row)
                    for row in entry.get("rows", [])
                    if isinstance(row, dict)
                ]
                if not rows:
                    continue

                phase = entry.get("phase") or "failed"
                error_message = str(entry.get("error_message") or "")
                log_lines = list(entry.get("log_lines") or [])
                if phase in {"scanning", "crawling"}:
                    phase = "failed"
                    error_message = "Batch was interrupted by a service restart."
                    log_lines.append(f"{datetime.now().strftime('%H:%M:%S')} Batch interrupted by service restart.")
                    for row in rows:
                        if row.status == "pending":
                            row.status = "error"
                            row.error = row.error or "Interrupted before scan completed."
                        if row.crawl_status in {"queued", "crawling"}:
                            row.crawl_status = "failed"
                            row.error = row.error or "Interrupted before crawl completed."

                self._batches[batch_id] = GoodNovelBatchState(
                    batch_id=batch_id,
                    created_by_user_id=entry.get("created_by_user_id"),
                    rows=rows,
                    batch_name=entry.get("batch_name") or f"GoodNovel batch {len(rows)} titles",
                    phase=phase,
                    error_message=error_message,
                    created_at=entry.get("created_at") or datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                    started_at=entry.get("started_at"),
                    finished_at=entry.get("finished_at"),
                    scan_concurrency=int(entry.get("scan_concurrency") or 4),
                    crawl_concurrency=int(entry.get("crawl_concurrency") or 3),
                    split_mode=entry.get("split_mode") or "stories_per_folder",
                    stories_per_folder=int(entry.get("stories_per_folder") or 100),
                    folder_count=entry.get("folder_count"),
                    output_dir=entry.get("output_dir") or str(self._batch_root / batch_id),
                    log_lines=log_lines[-200:],
                )

            if self._batches:
                self._persist_locked(force=True)
        except Exception as exc:
            logger.warning("Failed to load GoodNovel batch index: %s", exc)

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
            logger.warning("Failed to persist GoodNovel batch index: %s", exc)


def parse_titles(titles_text: str, delimiter: str = ";") -> list[str]:
    raw = (titles_text or "").replace("\ufeff", " ").strip()
    if not raw:
        return []

    if delimiter == "newline":
        parts = raw.splitlines()
    else:
        split_on = delimiter if delimiter else ";"
        parts = raw.split(split_on)

    titles: list[str] = []
    for part in parts:
        title = re.sub(r"\s+", " ", part).strip(" \t\r\n\"'")
        if title:
            titles.append(title)
    return titles


def clamp(value: int, low: int, high: int) -> int:
    return max(low, min(high, int(value)))


def is_crawlable_row(row: GoodNovelBatchRow) -> bool:
    return bool(row.url) and row.status in {"found", "ambiguous"}


def search_result_to_candidate(result: GoodNovelSearchResult) -> dict[str, Any]:
    return {
        "title": result.title,
        "author": result.author,
        "url": result.url,
        "book_id": result.book_id,
        "score": round(result.score, 4),
    }


_goodnovel_batch_service: GoodNovelBatchService | None = None


def get_goodnovel_batch_service() -> GoodNovelBatchService:
    global _goodnovel_batch_service
    if _goodnovel_batch_service is None:
        _goodnovel_batch_service = GoodNovelBatchService()
    return _goodnovel_batch_service
