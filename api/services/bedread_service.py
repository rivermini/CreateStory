"""BedRead service — external story API proxy + batch TTS generation."""

from __future__ import annotations

import json
import logging
import os
import re
import uuid
import zipfile
from dataclasses import dataclass
from datetime import datetime
from io import BytesIO
from pathlib import Path
from threading import Lock, Thread
from typing import Optional

import httpx

logger = logging.getLogger(__name__)


class BedReadConfigError(Exception):
    """Raised when required external API configuration is missing."""
    pass


def _get_external_api_config() -> tuple[str, dict]:
    """
    Fetch the external API config from FastAPIServer at runtime.
    The config is sourced from drive_sync_config.json (saved by the FE via FastAPIServer).

    Falls back to reading EXTERNAL_API_BASE_URL from env for backward compatibility.
    Raises BedReadConfigError if neither source provides a valid config.
    """
    # Primary: fetch from FastAPIServer (config written by FE)
    try:
        import httpx
        fastapi_base = os.environ.get("SERVICE_URLS_FastAPIServer", "http://localhost:8000").rstrip("/")
        url = f"{fastapi_base}/api/bedread/config/external-api"
        with httpx.Client(timeout=10.0) as client:
            resp = client.get(url)
            if resp.status_code == 200:
                data = resp.json()
                api_base = data.get("external_api_base_url", "").strip()
                if api_base:
                    headers: dict[str, str] = {}
                    token = data.get("external_api_token", "").strip()
                    if token:
                        headers["Authorization"] = f"Bearer {token}"
                    return api_base.rstrip("/"), headers
    except Exception:
        pass

    # Fallback: use env vars (for backward compatibility in dev environments)
    api_base = os.environ.get("EXTERNAL_API_BASE_URL", "").strip()
    if not api_base:
        raise BedReadConfigError(
            "External API Base URL is not configured. "
            "Please configure your Drive Sync settings in the frontend."
        )

    headers: dict[str, str] = {}
    token = os.environ.get("EXTERNAL_API_TOKEN", "").strip()
    if token:
        headers["Authorization"] = f"Bearer {token}"

    return api_base.rstrip("/"), headers


def _safe_filename(title: str) -> str:
    safe = re.sub(r'[<>:"/\\|?*]', "", title)
    return safe.strip() or "story"


def _voice_display_name(voice_id: str) -> str:
    if "_" in voice_id:
        return voice_id.split("_", 1)[1].title()
    return voice_id.title()


@dataclass
class ChapterTask:
    chapter_number: int
    title: str
    job_id: str = ""
    status: str = "pending"
    output_filename: str = ""
    error: str = ""
    progress_pct: int = 0


@dataclass
class BatchJob:
    batch_id: str
    story_id: str
    story_title: str
    chapters: list[ChapterTask]
    voice: str = "af_sarah"
    lang: str = "en-us"
    speed: float = 1.0
    format: str = "wav"
    status: str = "pending"
    output_dir: Optional[Path] = None
    started_at: Optional[str] = None
    finished_at: Optional[str] = None
    error: str = ""
    queue_position: int = 0
    zip_path: Optional[Path] = None
    from_auto_mode: bool = False

    @property
    def progress_pct(self) -> int:
        if not self.chapters:
            return 0
        done = sum(1 for c in self.chapters if c.status == "completed")
        return int(done * 100 / len(self.chapters))

    def to_dict(self, include_queue_position: bool = True) -> dict:
        result = {
            "batch_id": self.batch_id,
            "story_id": self.story_id,
            "story_title": self.story_title,
            "voice": self.voice,
            "lang": self.lang,
            "speed": self.speed,
            "format": self.format,
            "status": self.status,
            "progress_pct": self.progress_pct,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "error": self.error,
            "chapters": [
                {
                    "chapter_number": c.chapter_number,
                    "title": c.title,
                    "job_id": c.job_id,
                    "status": c.status,
                    "progress_pct": c.progress_pct,
                    "output_filename": c.output_filename,
                    "error": c.error,
                }
                for c in self.chapters
            ],
        }
        if include_queue_position:
            result["queue_position"] = self.queue_position
        result["zip_path"] = str(self.zip_path) if self.zip_path else None
        result["from_auto_mode"] = self.from_auto_mode
        return result


class BedReadService:
    """
    Manages external story API calls and batch TTS generation.
    Batch jobs launch individual TTSService jobs per chapter and poll
    them for progress. Audio files go to output/bedread/{batch_id}/.
    """

    def __init__(self) -> None:
        self._batch_jobs: dict[str, BatchJob] = {}
        self._batch_queue: list[str] = []
        self._active_batch_id: Optional[str] = None
        self._lock = Lock()
        self._poll_thread: Optional[Thread] = None
        self._poll_running = False
        self._project_root = Path(__file__).parent.parent.parent.resolve()
        self._output_base = self._project_root / "output" / "bedread"
        self._output_base.mkdir(parents=True, exist_ok=True)
        self._jobs_file = self._output_base / "jobs.json"

        self._load_jobs()
        self._tts_service = None

    def _load_jobs(self) -> None:
        if not self._jobs_file.exists():
            return
        try:
            with open(self._jobs_file, "r", encoding="utf-8") as fh:
                data = json.load(fh)
            for entry in data:
                batch_id = entry.get("batch_id", "")
                if not batch_id:
                    continue
                status = entry.get("status", "")
                if status in ("running", "queued"):
                    entry["status"] = "failed"
                    entry["error"] = "Job was interrupted by server restart"
                chapters = [
                    ChapterTask(
                        chapter_number=c.get("chapter_number", 0),
                        title=c.get("title", ""),
                        job_id=c.get("job_id", ""),
                        status=c.get("status", "pending"),
                        output_filename=c.get("output_filename", ""),
                        error=c.get("error", ""),
                        progress_pct=c.get("progress_pct", 0),
                    )
                    for c in entry.get("chapters", [])
                ]
                batch = BatchJob(
                    batch_id=batch_id,
                    story_id=entry.get("story_id", ""),
                    story_title=entry.get("story_title", ""),
                    chapters=chapters,
                    voice=entry.get("voice", "af_sarah"),
                    lang=entry.get("lang", "en-us"),
                    speed=entry.get("speed", 1.0),
                    format=entry.get("format", "wav"),
                    status=entry.get("status", "pending"),
                    output_dir=Path(entry["output_dir"]) if entry.get("output_dir") else None,
                    started_at=entry.get("started_at"),
                    finished_at=entry.get("finished_at"),
                    error=entry.get("error", ""),
                    from_auto_mode=entry.get("from_auto_mode", False),
                )
                self._batch_jobs[batch_id] = batch

                if status in ("completed", "failed"):
                    old_zip_path = entry.get("zip_path")
                    voice = entry.get("voice", "af_sarah")
                    voice_name = _voice_display_name(voice)
                    safe_title = _safe_filename(entry.get("story_title", "story"))
                    output_dir = batch.output_dir if batch.output_dir else self._output_base / batch_id
                    expected_zip_path = output_dir / f"{safe_title}_{voice_name}.zip"
                    if old_zip_path and old_zip_path != str(expected_zip_path):
                        old_zip = Path(old_zip_path)
                        if old_zip.exists():
                            old_zip.rename(expected_zip_path)
                            batch.zip_path = expected_zip_path
                            logger.info("Renamed zip for batch %s: %s -> %s", batch_id, old_zip.name, expected_zip_path.name)

            logger.info("Loaded %d persisted job(s) from %s", len(self._batch_jobs), self._jobs_file)
        except Exception as exc:
            logger.warning("Failed to load persisted jobs: %s", exc)

    def _persist_jobs(self) -> None:
        try:
            entries = [b.to_dict() for b in self._batch_jobs.values()]
            with open(self._jobs_file, "w", encoding="utf-8") as fh:
                json.dump(entries, fh, indent=2)
        except Exception as exc:
            logger.warning("Failed to persist jobs: %s", exc)

    def _generate_zip(self, batch: BatchJob) -> Optional[Path]:
        output_dir = batch.output_dir
        if not output_dir or str(output_dir) == ".":
            output_dir = None
        if output_dir is None:
            if batch.zip_path:
                output_dir = batch.zip_path.parent
            else:
                output_dir = self._output_base / batch.batch_id
        if not output_dir or not output_dir.exists():
            return None

        completed = [c for c in batch.chapters if c.status == "completed" and c.output_filename]
        if not completed:
            return None

        voice_name = _voice_display_name(batch.voice)
        safe_title = _safe_filename(batch.story_title)
        zip_filename = f"{safe_title}_{voice_name}.zip"
        zip_path = output_dir / zip_filename

        try:
            with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
                for ch in completed:
                    file_path = output_dir / ch.output_filename
                    if file_path.exists():
                        arcname = f"{batch.story_title}_{voice_name}_{ch.chapter_number:03d}.{batch.format}"
                        zf.write(str(file_path), arcname)
            return zip_path
        except Exception as exc:
            logger.warning("Failed to generate zip for batch %s: %s", batch.batch_id, exc)
            return None

    @property
    def tts_service(self):
        if self._tts_service is None:
            from api.services.tts_service import get_tts_service
            self._tts_service = get_tts_service()
        return self._tts_service

    def _external_get(self, path: str, user_id: Optional[str] = None) -> list | dict:
        api_base, base_headers = _get_external_api_config()
        url = f"{api_base}{path}"
        headers = dict(base_headers)
        if user_id:
            headers["x-user-id"] = user_id
        with httpx.Client(timeout=30.0) as client:
            resp = client.get(url, headers=headers)
            resp.raise_for_status()
            return resp.json()

    def fetch_stories(self) -> list[dict]:
        data = self._external_get("/api/v1/story/discover")
        if isinstance(data, dict):
            items = data.get("data", {}).get("items", [])
            if isinstance(items, list):
                return items
        return []

    def search_stories(
        self,
        keyword: Optional[str] = None,
        categories: Optional[list[str]] = None,
        status: Optional[str] = None,
        sort: Optional[str] = None,
        min_chapters: Optional[int] = None,
        published_within: Optional[int] = None,
        page: int = 1,
        limit: int = 20,
    ) -> dict:
        params: dict[str, str | int] = {"page": page, "limit": limit}

        if keyword:
            params["keyword"] = keyword
        if categories:
            params["categories"] = ",".join(categories)
        if status and status != "all":
            params["status"] = status
        if sort:
            params["sort"] = sort
        if min_chapters is not None:
            params["minchapters"] = min_chapters
        if published_within is not None:
            params["publishedWithin"] = published_within

        query = "&".join(f"{k}={v}" for k, v in params.items())
        data = self._external_get(f"/api/v1/story/discover?{query}")

        if isinstance(data, dict):
            raw_items = data.get("data", {})
            if isinstance(raw_items, dict):
                items = raw_items.get("items", [])
                total = raw_items.get("total", len(items))
                total_pages = raw_items.get("totalPages", (total + limit - 1) // limit if limit > 0 else 0)
            elif isinstance(raw_items, list):
                items = raw_items
                total = len(items)
                total_pages = 1
            else:
                items = []
                total = 0
                total_pages = 0
        elif isinstance(data, list):
            items = data
            total = len(items)
            total_pages = 1
        else:
            items = []
            total = 0
            total_pages = 0

        return {
            "stories": items,
            "total": total,
            "page": page,
            "limit": limit,
            "totalPages": total_pages,
        }

    def fetch_chapters(self, story_id: str, user_id: Optional[str] = None) -> list[dict]:
        data = self._external_get(f"/api/v1/story/{story_id}/chapter", user_id=user_id)
        if isinstance(data, dict):
            chapters = data.get("data", [])
            if isinstance(chapters, list):
                return chapters
        if isinstance(data, list):
            return data
        return []

    def fetch_chapter(self, story_id: str, chapter_num: int, user_id: Optional[str] = None) -> dict:
        data = self._external_get(f"/api/v1/story/{story_id}/chapter/{chapter_num}", user_id=user_id)
        if isinstance(data, dict):
            return data.get("data", data)
        return data if isinstance(data, dict) else {}

    def start_batch_job(
        self,
        story_id: str,
        story_title: str,
        chapter_numbers: list[int],
        voice: str,
        lang: str,
        speed: float,
        format: str,
        from_auto_mode: bool = False,
    ) -> str:
        _get_external_api_config()

        batch_id = str(uuid.uuid4())[:8]
        output_dir = self._output_base / batch_id
        output_dir.mkdir(parents=True, exist_ok=True)

        chapters: list[ChapterTask] = []
        try:
            chapter_list = self.fetch_chapters(story_id)
            title_map = {c.get("index") or c.get("chapterNumber", c.get("chapter_number")): c.get("title", f"Chapter {c.get('index')}") for c in chapter_list}
        except Exception:
            title_map = {}

        for cn in chapter_numbers:
            chapters.append(ChapterTask(
                chapter_number=cn,
                title=title_map.get(cn, f"Chapter {cn}"),
            ))

        with self._lock:
            queue_position = len(self._batch_queue) + 1
            batch = BatchJob(
                batch_id=batch_id,
                story_id=story_id,
                story_title=story_title,
                chapters=chapters,
                voice=voice,
                lang=lang,
                speed=speed,
                format=format,
                status="queued",
                output_dir=output_dir,
                started_at=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                queue_position=queue_position,
                from_auto_mode=from_auto_mode,
            )
            self._batch_jobs[batch_id] = batch
            self._batch_queue.append(batch_id)
            logger.info("BedRead batch %s added to queue at position %d", batch_id, queue_position)

        self._persist_jobs()
        self._process_next_in_queue()
        self._start_poll_thread()

        return batch_id

    def _process_next_in_queue(self) -> None:
        with self._lock:
            if self._active_batch_id is not None:
                return
            if not self._batch_queue:
                return

            batch_id = self._batch_queue.pop(0)
            self._active_batch_id = batch_id

            batch = self._batch_jobs.get(batch_id)
            if batch is None:
                self._active_batch_id = None
                return

            batch.status = "running"
            batch.queue_position = 0

            for i, bid in enumerate(self._batch_queue):
                b = self._batch_jobs.get(bid)
                if b:
                    b.queue_position = i + 1

            story_id = batch.story_id
            batch_id_for_tts = batch_id
            voice = batch.voice
            lang = batch.lang
            speed = batch.speed
            format = batch.format
            chapters = list(batch.chapters)

        # Fetch all chapters at once — the /chapter endpoint includes content for each chapter
        chapter_map: dict[int, dict] = {}
        try:
            all_chapters = self.fetch_chapters(story_id)
            for ch in all_chapters:
                idx = ch.get("index") or ch.get("chapterNumber") or ch.get("chapter_number")
                if idx is not None:
                    chapter_map[idx] = ch
        except Exception:
            logger.warning("Failed to fetch chapter list for batch %s", batch_id_for_tts)

        for ch in chapters:
            try:
                with self._lock:
                    batch = self._batch_jobs.get(batch_id_for_tts)
                    if batch is None or batch.status == "cancelled":
                        logger.info(
                            "BedRead batch %s cancelled while starting chapter jobs",
                            batch_id_for_tts,
                        )
                        break

                chapter_data = chapter_map.get(ch.chapter_number, {})
                plain_content = chapter_data.get("content") or chapter_data.get("plainContent", "")
                if plain_content:
                    from api.services.tts_service import TTSService
                    clean_text = TTSService.clean_text(plain_content)
                    if clean_text:
                        tts_job_id = self.tts_service.start_job(
                            text=clean_text,
                            voice=voice,
                            lang=lang,
                            speed=speed,
                            format=format,
                        )
                        should_cancel_tts = False
                        with self._lock:
                            batch = self._batch_jobs.get(batch_id_for_tts)
                            if batch and batch.status == "cancelled":
                                should_cancel_tts = True
                            elif batch:
                                for c in batch.chapters:
                                    if c.chapter_number == ch.chapter_number:
                                        c.job_id = tts_job_id
                                        c.status = "queued"
                        if should_cancel_tts:
                            self.tts_service.cancel_job(tts_job_id)
                            break
                        logger.info("BedRead batch %s: chapter %d queued as TTS job %s",
                                    batch_id_for_tts, ch.chapter_number, tts_job_id)
                    else:
                        with self._lock:
                            batch = self._batch_jobs.get(batch_id_for_tts)
                            if batch:
                                for c in batch.chapters:
                                    if c.chapter_number == ch.chapter_number:
                                        c.status = "failed"
                                        c.error = "Empty chapter content"
                else:
                    with self._lock:
                        batch = self._batch_jobs.get(batch_id_for_tts)
                        if batch:
                            for c in batch.chapters:
                                if c.chapter_number == ch.chapter_number:
                                    c.status = "failed"
                                    c.error = "No content returned"
            except Exception as exc:
                with self._lock:
                    batch = self._batch_jobs.get(batch_id_for_tts)
                    if batch:
                        for c in batch.chapters:
                            if c.chapter_number == ch.chapter_number:
                                c.status = "failed"
                                c.error = repr(exc)
                logger.exception("BedRead batch %s: failed to fetch chapter %d",
                                 batch_id_for_tts, ch.chapter_number)

    def _start_poll_thread(self) -> None:
        with self._lock:
            if self._poll_running:
                return
            self._poll_running = True
        self._poll_thread = Thread(target=self._poll_and_sync, daemon=True)
        self._poll_thread.start()

    def _cleanup_tts_job(self, job_id: str) -> None:
        try:
            tts_output = self.tts_service.get_output_path(job_id)
            if tts_output and tts_output.parent.exists():
                import shutil
                shutil.rmtree(tts_output.parent)
                logger.info("Cleaned up TTS job %s directory: %s", job_id, tts_output.parent)
        except Exception as exc:
            logger.warning("Failed to clean up TTS job %s directory: %s", job_id, exc)

    def _poll_and_sync(self) -> None:
        import time
        import shutil

        while True:
            time.sleep(2)

            batches_to_process: list[tuple] = []

            with self._lock:
                if self._active_batch_id is None:
                    has_queued_batch = bool(self._batch_queue)
                else:
                    has_queued_batch = False

            if self._active_batch_id is None:
                if has_queued_batch:
                    self._process_next_in_queue()

                with self._lock:
                    if self._active_batch_id is None:
                        self._poll_running = False
                        return

            with self._lock:
                batch = self._batch_jobs.get(self._active_batch_id)
                if batch is None:
                    self._active_batch_id = None
                    continue

                batches_to_process.append((
                    batch.batch_id, batch.story_title, batch.format, batch.output_dir,
                    [(c.chapter_number, c.status, c.job_id, c.progress_pct) for c in batch.chapters]
                ))

            for batch_id, story_title, fmt, output_dir, chapters_data in batches_to_process:
                all_done = True

                with self._lock:
                    batch = self._batch_jobs.get(batch_id)
                    if batch is None:
                        continue
                    if batch.status == "cancelled":
                        if self._active_batch_id == batch_id:
                            self._active_batch_id = None
                        continue

                try:
                    for cn, status, job_id, progress in chapters_data:
                        if status in ("completed", "failed"):
                            continue

                        if not job_id:
                            with self._lock:
                                batch = self._batch_jobs.get(batch_id)
                                if batch:
                                    for c in batch.chapters:
                                        if c.chapter_number == cn:
                                            c.status = "failed"
                                            c.error = "No TTS job was started"
                            continue

                        tts_job = self.tts_service.get_job(job_id)
                        if tts_job is None:
                            with self._lock:
                                batch = self._batch_jobs.get(batch_id)
                                if batch:
                                    for c in batch.chapters:
                                        if c.chapter_number == cn:
                                            c.status = "failed"
                                            c.error = "TTS job not found"
                            continue

                        tts_status = tts_job.get("status", "unknown")

                        if tts_status == "completed":
                            with self._lock:
                                batch = self._batch_jobs.get(batch_id)
                                if batch:
                                    for c in batch.chapters:
                                        if c.chapter_number == cn:
                                            c.status = "completed"
                                            c.progress_pct = 100
                            tts_output = self.tts_service.get_output_path(job_id)
                            if tts_output and tts_output.exists():
                                voice_name = _voice_display_name(batch.voice if batch else "")
                                new_name = f"{story_title}_{voice_name}_{cn:03d}.{fmt}"
                                new_path = output_dir / new_name
                                shutil.copy2(str(tts_output), str(new_path))
                                with self._lock:
                                    batch = self._batch_jobs.get(batch_id)
                                    if batch:
                                        for c in batch.chapters:
                                            if c.chapter_number == cn:
                                                c.output_filename = new_name
                                self._cleanup_tts_job(job_id)
                        elif tts_status == "failed":
                            with self._lock:
                                batch = self._batch_jobs.get(batch_id)
                                if batch:
                                    for c in batch.chapters:
                                        if c.chapter_number == cn:
                                            c.status = "failed"
                                            c.error = tts_job.get("error", "TTS job failed")
                        elif tts_status == "cancelled":
                            with self._lock:
                                batch = self._batch_jobs.get(batch_id)
                                if batch:
                                    for c in batch.chapters:
                                        if c.chapter_number == cn:
                                            c.status = "failed"
                                            c.error = "TTS job was cancelled"
                        elif tts_status == "processing":
                            with self._lock:
                                batch = self._batch_jobs.get(batch_id)
                                if batch:
                                    for c in batch.chapters:
                                        if c.chapter_number == cn:
                                            if c.status == "queued":
                                                c.status = "processing"
                                            c.progress_pct = tts_job.get("progress_pct", 0)
                            all_done = False
                        else:
                            with self._lock:
                                batch = self._batch_jobs.get(batch_id)
                                if batch:
                                    for c in batch.chapters:
                                        if c.chapter_number == cn:
                                            c.progress_pct = tts_job.get("progress_pct", 0)
                            all_done = False
                except Exception:
                    pass

                batch_finished = False
                with self._lock:
                    batch = self._batch_jobs.get(batch_id)
                    if batch is None:
                        continue
                    if batch.status == "cancelled":
                        if self._active_batch_id == batch_id:
                            self._active_batch_id = None
                        continue
                    chapter_statuses = [c.status for c in batch.chapters]
                    if all(s == "completed" for s in chapter_statuses):
                        batch.status = "completed"
                        batch.finished_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                        batch_finished = True
                        batch.zip_path = self._generate_zip(batch)
                        logger.info("BedRead batch %s completed, zip: %s", batch_id, batch.zip_path)
                    elif all(s in ("completed", "failed") for s in chapter_statuses):
                        batch.status = "failed"
                        batch.error = "Some chapters failed"
                        batch.finished_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                        batch_finished = True
                        batch.zip_path = self._generate_zip(batch)
                        logger.info("BedRead batch %s finished with some chapters failed, zip: %s", batch_id, batch.zip_path)

                if batch_finished:
                    self._persist_jobs()

                if batch_finished:
                    with self._lock:
                        if self._active_batch_id == batch_id:
                            self._active_batch_id = None
                    self._process_next_in_queue()
                    with self._lock:
                        no_active_batch = self._active_batch_id is None
                    if no_active_batch:
                        with self._lock:
                            self._poll_running = False
                        self.tts_service.release_idle_models()
                        return

    def get_batch_job(self, batch_id: str) -> Optional[dict]:
        with self._lock:
            batch = self._batch_jobs.get(batch_id)
        if batch is None:
            return None
        return batch.to_dict()

    def list_batch_jobs(self) -> list[dict]:
        with self._lock:
            jobs = sorted(
                self._batch_jobs.values(),
                key=lambda b: b.started_at or "",
                reverse=True,
            )
        return [b.to_dict() for b in jobs]

    def delete_batch_job(self, batch_id: str) -> bool:
        with self._lock:
            batch = self._batch_jobs.get(batch_id)
            if batch is None:
                return False

            if batch.status == "queued":
                if batch_id in self._batch_queue:
                    self._batch_queue.remove(batch_id)
                    for i, bid in enumerate(self._batch_queue):
                        b = self._batch_jobs.get(bid)
                        if b:
                            b.queue_position = i + 1
                batch.status = "cancelled"
                batch.finished_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                logger.info("BedRead batch %s removed from queue and cancelled", batch_id)
                self._persist_jobs()
                self.tts_service.release_idle_models()
                return True

            if batch.status not in ("pending", "running"):
                return False

            batch.status = "cancelled"
            batch.finished_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

            if self._active_batch_id == batch_id:
                self._active_batch_id = None

            for ch in batch.chapters:
                if ch.job_id:
                    self.tts_service.cancel_job(ch.job_id)

        should_restart_poll = False
        with self._lock:
            no_active_batch = self._active_batch_id is None

        if no_active_batch:
            self._process_next_in_queue()
            with self._lock:
                should_restart_poll = self._active_batch_id is not None

        self._persist_jobs()
        if should_restart_poll:
            self._start_poll_thread()
        else:
            self.tts_service.release_idle_models()
        logger.info("BedRead batch %s cancelled", batch_id)
        return True

    def delete_batch_output(self, batch_id: str) -> bool:
        with self._lock:
            batch = self._batch_jobs.get(batch_id)
            if batch is None:
                return False
            output_dir = batch.output_dir
        if output_dir is None or not output_dir.exists():
            return True
        try:
            import shutil
            shutil.rmtree(output_dir)
            logger.info("Deleted batch %s output directory: %s", batch_id, output_dir)
            return True
        except Exception as exc:
            logger.warning("Failed to delete batch %s output directory: %s", batch_id, exc)
            return False

    def remove_batch_job(self, batch_id: str) -> bool:
        with self._lock:
            if batch_id not in self._batch_jobs:
                return False
            del self._batch_jobs[batch_id]
        self._persist_jobs()
        logger.info("BedRead batch %s removed", batch_id)
        return True

    def get_output_dir(self, batch_id: str) -> Optional[Path]:
        with self._lock:
            batch = self._batch_jobs.get(batch_id)
        if batch is None:
            return None
        output_dir = batch.output_dir
        if output_dir:
            return output_dir
        if batch.zip_path:
            return batch.zip_path.parent
        base_output = self._output_base
        return base_output / batch_id

    def get_chapter_file(self, batch_id: str, chapter_num: int) -> Optional[Path]:
        batch = self.get_batch_job(batch_id)
        if batch is None:
            return None

        output_dir = self.get_output_dir(batch_id)
        if output_dir is None:
            return None

        for ch in batch.get("chapters", []):
            if ch.get("chapter_number") == chapter_num:
                stored_filename = ch.get("output_filename")
                if stored_filename:
                    file_path = output_dir / stored_filename
                    if file_path.exists():
                        return file_path

        voice_name = _voice_display_name(batch.get("voice", "af_sarah"))
        filename = f"{batch.get('story_title', 'story')}_{voice_name}_{chapter_num:03d}.{batch.get('format', 'wav')}"
        file_path = output_dir / filename

        if not file_path.exists():
            return None
        return file_path

    def get_batch_zip(self, batch_id: str) -> Optional[BytesIO]:
        batch = self.get_batch_job(batch_id)
        if batch is None:
            return None

        output_dir = self.get_output_dir(batch_id)
        if output_dir is None:
            return None

        voice_name = _voice_display_name(batch["voice"])
        zip_buffer = BytesIO()

        with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
            for ch in batch["chapters"]:
                if ch["status"] != "completed" or not ch["output_filename"]:
                    continue

                file_path = output_dir / ch["output_filename"]
                if not file_path.exists():
                    continue

                arcname = f"{batch['story_title']}_{voice_name}_{ch['chapter_number']:03d}.{batch['format']}"
                zf.write(str(file_path), arcname)

        if zip_buffer.tell() == 0:
            return None

        zip_buffer.seek(0)
        return zip_buffer


_bedread_service: Optional[BedReadService] = None


def get_bedread_service() -> BedReadService:
    global _bedread_service
    if _bedread_service is None:
        _bedread_service = BedReadService()
    return _bedread_service
