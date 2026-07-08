"""Inkitt free/completed genre batch export service."""

from __future__ import annotations

import json
import logging
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

import requests
from bs4 import BeautifulSoup, Tag

from configs.base_config import load_site_config
from spiders.inkitt import InkittSpider
from utils.cleaner import build_promo_patterns, clean_chapter_content
from utils.proxy import requests_proxies
from utils.sanitize import sanitize_filename

logger = logging.getLogger(__name__)

INKITT_BATCH_MAX_PAGES = int(os.getenv("INKITT_BATCH_MAX_PAGES", "25"))
INKITT_BATCH_MAX_STORIES = int(os.getenv("INKITT_BATCH_MAX_STORIES", "2000"))
INKITT_BATCH_MAX_DISCOVER_WORKERS = int(os.getenv("INKITT_BATCH_MAX_DISCOVER_WORKERS", "6"))
INKITT_BATCH_MAX_CRAWL_WORKERS = int(os.getenv("INKITT_BATCH_MAX_CRAWL_WORKERS", "4"))

BatchPhase = Literal["running", "completed", "failed"]
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
    completion_status: str = "Complete"
    total_chapters: int | None = None
    crawled_chapters: int = 0
    rating: float | None = None
    review_count: int | None = None
    read_count: int | None = None
    output_file: str = ""
    metadata_file: str = ""
    error: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class InkittBatchState:
    batch_id: str
    created_by_user_id: str | None
    rows: list[InkittBatchRow] = field(default_factory=list)
    batch_name: str = ""
    phase: BatchPhase = "running"
    error_message: str = ""
    created_at: str = field(default_factory=lambda: datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
    started_at: str | None = None
    finished_at: str | None = None
    max_pages_per_genre: int = 3
    discover_concurrency: int = 4
    crawl_concurrency: int = 2
    request_delay_seconds: float = 0.35
    output_dir: str = ""
    selected_genres: list[str] = field(default_factory=list)
    log_lines: list[str] = field(default_factory=list)

    def add_log(self, message: str) -> None:
        self.log_lines.append(f"{datetime.now().strftime('%H:%M:%S')} {message}")
        if len(self.log_lines) > 250:
            self.log_lines = self.log_lines[-250:]


class InkittBatchService:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._batches: dict[str, InkittBatchState] = {}
        self._project_root = Path(__file__).parent.parent.parent.resolve()
        self._batch_root = (self._project_root / "output" / "inkitt_batch").resolve()
        self._batch_root.mkdir(parents=True, exist_ok=True)
        self._index_file = self._batch_root / "batch_index.json"
        self._last_persist_at = 0.0
        cfg = load_site_config("inkitt")
        self._promo_patterns = build_promo_patterns(cfg.get("promo_patterns", []))
        self._load_index()

    def start(
        self,
        created_by_user_id: str | None,
        batch_name: str,
        genres: list[str] | None,
        max_pages_per_genre: int,
        discover_concurrency: int,
        crawl_concurrency: int,
        request_delay_seconds: float,
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
            request_delay_seconds=max(0.0, min(float(request_delay_seconds), 5.0)),
            output_dir=str(self._prepare_output_dir(batch_id)),
            selected_genres=selected,
        )
        state.add_log(f"Started Inkitt batch for {len(selected)} genre(s).")

        with self._lock:
            self._batches[batch_id] = state
            self._persist_locked(force=True)

        thread = threading.Thread(target=self._run_thread, args=(batch_id,), daemon=True)
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

    def delete_batch(self, batch_id: str) -> bool:
        with self._lock:
            state = self._get_state_locked(batch_id)
            if state.phase == "running":
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

    def get_download_files(self, batch_id: str) -> tuple[InkittBatchState, list[tuple[Path, str]]]:
        with self._lock:
            state = self._get_state_locked(batch_id)
            if state.phase != "completed":
                raise ValueError("Batch is not completed yet.")
            output_dir = Path(state.output_dir).resolve() if state.output_dir else self._batch_root / batch_id

        if not output_dir.exists() or not output_dir.is_dir():
            raise FileNotFoundError("Batch output folder was not found.")
        if not output_dir.is_relative_to(self._batch_root):
            raise ValueError("Batch output path escapes the batch root.")

        files: list[tuple[Path, str]] = []
        for pattern in ("*.md", "info.json"):
            for path in sorted(output_dir.rglob(pattern)):
                if path.is_file() and not path.is_symlink():
                    archive_name = str(path.relative_to(output_dir)).replace("\\", "/")
                    files.append((path, archive_name))
        if not files:
            raise FileNotFoundError("No Inkitt batch files were created.")
        return state, files

    def _run_thread(self, batch_id: str) -> None:
        try:
            refs = self._discover(batch_id)
            with self._lock:
                state = self._batches.get(batch_id)
                if state is None:
                    return
                if not refs:
                    state.phase = "completed"
                    state.finished_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                    state.add_log("No free completed Inkitt stories found.")
                    self._persist_locked(force=True)
                    return
                state.rows = [
                    InkittBatchRow(index=index, **ref)
                    for index, ref in enumerate(refs[:INKITT_BATCH_MAX_STORIES], start=1)
                ]
                for row in state.rows:
                    row.status = "queued"
                state.add_log(f"Discovery finished: {len(state.rows)} completed story candidate(s).")
                self._persist_locked(force=True)

            self._crawl_rows(batch_id)

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

    def _discover(self, batch_id: str) -> list[dict[str, Any]]:
        with self._lock:
            state = self._get_state_locked(batch_id)
            selected = list(state.selected_genres)
            max_pages = state.max_pages_per_genre
            max_workers = state.discover_concurrency

        discovered: dict[str, dict[str, Any]] = {}
        with ThreadPoolExecutor(max_workers=max_workers) as pool:
            futures = {
                pool.submit(self._discover_genre, slug, label, max_pages): (slug, label)
                for slug, label in INKITT_GENRES
                if slug in selected
            }
            for future in as_completed(futures):
                slug, label = futures[future]
                try:
                    refs = future.result()
                except Exception as exc:
                    logger.warning("[inkitt-batch/%s] discovery failed for %s: %s", batch_id, slug, exc)
                    refs = []
                    with self._lock:
                        state = self._batches.get(batch_id)
                        if state:
                            state.add_log(f"{label}: discovery failed: {exc}")
                for ref in refs:
                    discovered.setdefault(ref["story_id"], ref)
                with self._lock:
                    state = self._batches.get(batch_id)
                    if state:
                        state.add_log(f"{label}: found {len(refs)} completed candidate(s).")
                        self._persist_locked()

        return sorted(discovered.values(), key=lambda item: (item["genre"], item["title"].lower()))

    def _discover_genre(self, genre_slug: str, genre_label: str, max_pages: int) -> list[dict[str, Any]]:
        session = self._make_session()
        refs_by_id: dict[str, dict[str, Any]] = {}
        previous_page_ids: set[str] = set()
        for page in range(1, max_pages + 1):
            url = f"https://www.inkitt.com/genres/{genre_slug}"
            if page > 1:
                url = f"{url}?page={page}"
            response = session.get(url, timeout=30)
            if response.status_code != 200:
                break
            soup = BeautifulSoup(response.text, "html.parser")
            refs = extract_completed_story_refs(soup, genre_slug, genre_label)
            page_ids = {ref["story_id"] for ref in refs}
            if page > 1 and (not page_ids or page_ids == previous_page_ids):
                break
            previous_page_ids = page_ids
            for ref in refs:
                refs_by_id.setdefault(ref["story_id"], ref)
        return list(refs_by_id.values())

    def _crawl_rows(self, batch_id: str) -> None:
        with self._lock:
            state = self._get_state_locked(batch_id)
            rows = [row for row in state.rows if row.status == "queued"]
            max_workers = state.crawl_concurrency
            output_dir = Path(state.output_dir).resolve()
            delay = state.request_delay_seconds

        with ThreadPoolExecutor(max_workers=max_workers) as pool:
            futures = {
                pool.submit(self._crawl_one, row, output_dir, delay): row.index
                for row in rows
            }
            for future in as_completed(futures):
                row_index = futures[future]
                try:
                    update = future.result()
                except Exception as exc:
                    logger.warning("[inkitt-batch/%s] crawl failed for row %s: %s", batch_id, row_index, exc)
                    update = {"status": "failed", "error": str(exc)}
                with self._lock:
                    state = self._batches.get(batch_id)
                    if state is None:
                        return
                    row = state.rows[row_index - 1]
                    for key, value in update.items():
                        setattr(row, key, value)
                    self._persist_locked()

    def _crawl_one(self, row: InkittBatchRow, output_dir: Path, delay: float) -> dict[str, Any]:
        row.status = "crawling"
        spider = InkittSpider(novel=row.url, limit=10000)
        story_html = spider._fetch_html(row.url)
        story_soup = BeautifulSoup(story_html, "html.parser")
        metadata = spider._extract_novel_metadata(story_soup, row.story_id, row.url)
        metadata.update(extract_story_quality(story_soup))

        status = extract_label_value(story_soup, "Status") or row.completion_status
        if status.lower() != "complete":
            return {"status": "skipped", "completion_status": status, "error": "Story is not complete."}

        chapter_links = spider._collect_chapter_links(story_soup, row.story_id, row.url)
        if not chapter_links:
            return {"status": "skipped", "error": "No chapter list found."}

        chapters: list[tuple[int, str, str, str]] = []
        try:
            for index, link in enumerate(chapter_links):
                chapter_url = link["url"]
                html = story_html if spider._same_url(chapter_url, row.url) else spider._fetch_html(chapter_url)
                soup = BeautifulSoup(html, "html.parser")
                content = spider._extract_chapter_content(soup)
                cleaned = clean_chapter_content(content, self._promo_patterns)
                if not cleaned:
                    raise RuntimeError("No readable free chapter content.")
                title = spider._extract_chapter_title(soup) or link.get("title") or f"Chapter {link['chapter_number']}"
                chapters.append((int(link["chapter_number"]), title, cleaned, chapter_url))
                if delay > 0 and index < len(chapter_links) - 1:
                    time.sleep(delay)
        except RuntimeError as exc:
            message = str(exc)
            if "requires login" in message.lower() or "subscription" in message.lower():
                return {"status": "skipped", "error": "Skipped paid/login-gated story."}
            return {"status": "failed", "error": message}

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

    def _summary_locked(self, state: InkittBatchState) -> dict[str, Any]:
        total = len(state.rows)
        completed = sum(1 for row in state.rows if row.status == "completed")
        skipped = sum(1 for row in state.rows if row.status == "skipped")
        failed = sum(1 for row in state.rows if row.status == "failed")
        crawled_or_done = completed + skipped + failed
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
            "download_ready": state.phase == "completed" and completed > 0,
            "error_message": state.error_message,
            "created_at": state.created_at,
            "started_at": state.started_at,
            "finished_at": state.finished_at,
            "max_pages_per_genre": state.max_pages_per_genre,
            "discover_concurrency": state.discover_concurrency,
            "crawl_concurrency": state.crawl_concurrency,
            "request_delay_seconds": state.request_delay_seconds,
            "selected_genres": state.selected_genres,
            "log_lines": state.log_lines[-60:],
        }

    def _filtered_rows(self, state: InkittBatchState, status_filter: str) -> list[InkittBatchRow]:
        if status_filter == "all":
            return state.rows
        if status_filter in {"completed", "skipped", "failed", "queued", "crawling", "discovered"}:
            return [row for row in state.rows if row.status == status_filter]
        return state.rows

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
                error_message = str(entry.get("error_message") or "")
                log_lines = list(entry.get("log_lines") or [])
                if phase == "running":
                    phase = "failed"
                    error_message = "Batch was interrupted by a service restart."
                    log_lines.append(f"{datetime.now().strftime('%H:%M:%S')} Batch interrupted by service restart.")
                    for row in rows:
                        if row.status in {"queued", "crawling", "discovered"}:
                            row.status = "failed"
                            row.error = row.error or "Interrupted before completion."
                self._batches[batch_id] = InkittBatchState(
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
                    crawl_concurrency=int(entry.get("crawl_concurrency") or 2),
                    request_delay_seconds=float(entry.get("request_delay_seconds") or 0.35),
                    output_dir=entry.get("output_dir") or str(self._batch_root / batch_id),
                    selected_genres=list(entry.get("selected_genres") or [slug for slug, _label in INKITT_GENRES]),
                    log_lines=log_lines[-250:],
                )
            if self._batches:
                self._persist_locked(force=True)
        except Exception as exc:
            logger.warning("Failed to load Inkitt batch index: %s", exc)

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
        rating = float(rating_match.group(1)) if rating_match else None
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


def parse_compact_number(value: str, suffix: str | None) -> int:
    number = float(value.replace(",", ""))
    multiplier = {"K": 1_000, "M": 1_000_000, "B": 1_000_000_000}.get((suffix or "").upper(), 1)
    return int(number * multiplier)


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
