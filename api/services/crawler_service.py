"""Crawler execution service — manages Scrapy crawl sessions as subprocesses."""

import asyncio
import json
import logging
import os
import re
import subprocess
import sys
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path
from threading import Lock, Thread
from typing import Optional

from api.db import init_db
from api.models.crawl_request import LogEntry, ProgressUpdate
from api.repositories.crawl_repository import CrawlOutputRepository, CrawlSessionRepository
from utils.sanitize import sanitize_filename

logger = logging.getLogger(__name__)


def _get_wdm_cached_driver() -> str | None:
    import json as _json
    import platform as _platform

    try:
        wdm_dir = Path.home() / ".wdm"
        drivers_json = wdm_dir / "drivers.json"

        for lock_file in wdm_dir.glob("wdm-lock-*"):
            try:
                lock_file.unlink()
            except Exception:
                pass

        if not drivers_json.exists():
            return None

        with open(drivers_json, "r") as f:
            drivers: dict = _json.load(f)

        best_entry: str | None = None
        best_time: str = ""

        for key, val in drivers.items():
            if "chromedriver" not in key:
                continue
            if _platform.system() == "Windows" and "win64" not in key:
                continue
            if _platform.system() != "Windows" and "win64" in key:
                continue

            binary_path = val.get("binary_path", "")
            timestamp = val.get("timestamp", "")

            if binary_path and (not best_time or timestamp > best_time):
                best_time = timestamp
                best_entry = binary_path

        if best_entry:
            normalized = os.path.normpath(os.path.abspath(best_entry))
            if os.path.exists(normalized):
                return normalized

        return None
    except Exception:
        return None


def _resolve_chromedriver_for_env() -> str | None:
    import platform as _platform
    import shutil as _shutil

    if os.environ.get("CHROMEDRIVER_PATH"):
        return os.environ["CHROMEDRIVER_PATH"]

    if _platform.system() == "Windows":
        path = _shutil.which("chromedriver")
        if path:
            return os.path.normpath(os.path.abspath(path))
    else:
        for candidate in ("/usr/bin/chromedriver", "/usr/local/bin/chromedriver"):
            if os.path.exists(candidate):
                return candidate

    wdm_path = _get_wdm_cached_driver()
    if wdm_path:
        return wdm_path

    try:
        cache_root = Path.home() / ".cache" / "selenium" / "chromedriver"
        if cache_root.exists():
            for ver_dir in sorted(
                (d for d in cache_root.iterdir() if d.is_dir() and d.name[0].isdigit()),
                reverse=True,
            ):
                exe = ver_dir / "chromedriver.exe"
                if exe.exists():
                    return str(exe)
    except Exception as exc:
        logger.warning("_resolve_chromedriver_for_env: selenium-manager cache failed: %s", exc)

    return None


_RESOLVED_CHROMEDRIVER_PATH: str | None = None


def _get_chromedriver_path() -> str | None:
    global _RESOLVED_CHROMEDRIVER_PATH
    if _RESOLVED_CHROMEDRIVER_PATH is not None:
        return _RESOLVED_CHROMEDRIVER_PATH
    _RESOLVED_CHROMEDRIVER_PATH = _resolve_chromedriver_for_env()
    return _RESOLVED_CHROMEDRIVER_PATH


_LOG_LINE_RE = re.compile(
    r"\[(?P<slug>[^\]]+)/(?P<limit>\d+)\]\s+Crawled chapter (?P<idx>\d+):\s+(?P<title>.*)"
)
_TOTAL_RE = re.compile(r"found (?P<total>\d+) chapter links.*target=[^(]+\((?P<count>\d+)\)", re.IGNORECASE)
_ERROR_RE = re.compile(r"(?i)\b(error|exception|failed|traceback|critical)\b", re.IGNORECASE)
_WARNING_RE = re.compile(r"(?i)\b(warning|retry|retrying)\b", re.IGNORECASE)
_MD_CHAPTER_HEADER_RE = re.compile(r"^(?P<filename>.+?_chapter_(?P<number>\d+)\.md):\s*(?P<title>.*)$")


def chapter_record_from_output_file(filepath: Path, chapter_number: int) -> dict:
    raw = filepath.read_text(encoding="utf-8").strip()

    if filepath.suffix.lower() == ".json":
        data = json.loads(raw)
        if isinstance(data, dict):
            return {
                "content": str(data.get("content") or ""),
                "chapter_number": int(data.get("chapter_number") or chapter_number),
                "title": str(data.get("title") or data.get("chapter_title") or ""),
                "source_url": data.get("source_url"),
                "novel_title": data.get("novel_title"),
                "novel_slug": data.get("novel_slug"),
            }

    title = ""
    content = raw
    if filepath.suffix.lower() == ".md" and raw:
        first_line, sep, rest = raw.partition("\n")
        match = _MD_CHAPTER_HEADER_RE.match(first_line.strip())
        if match:
            title = match.group("title").strip()
            content = rest.strip() if sep else ""

    return {
        "content": content,
        "chapter_number": chapter_number,
        "title": title,
    }


@dataclass
class CrawlProgress:
    chapters_crawled: int = 0
    chapters_total: int = 0
    current_title: str = ""
    log_lines: list[LogEntry] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    status: str = "idle"
    error_message: str = ""
    started_at: Optional[str] = None
    finished_at: Optional[str] = None
    crawl_id: str = ""
    novel_name: str = ""
    site_name: str = ""
    completed: Optional[bool] = None
    output_format: str = "md"
    combine_chapters: bool = False
    combined_file: str = ""
    combined_md_file: str = ""
    source_url: str = ""

    def add_log(self, message: str, level: str = "info") -> LogEntry:
        entry = LogEntry(
            timestamp=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            message=message,
            level=level,
        )
        self.log_lines.append(entry)
        if len(self.log_lines) > 500:
            self.log_lines = self.log_lines[-500:]
        return entry

    def to_progress_update(self) -> ProgressUpdate:
        return ProgressUpdate(
            chapters_crawled=self.chapters_crawled,
            chapters_total=self.chapters_total,
            current_title=self.current_title,
            status=self.status,
            error_message=self.error_message or None,
            source_url=self.source_url or None,
        )


class CrawlService:
    def __init__(self) -> None:
        self._sessions: dict[str, CrawlProgress] = {}
        self._cancel_flags: dict[str, bool] = {}
        self._lock = Lock()
        self._project_root = Path(__file__).parent.parent.parent.resolve()
        self._index_file = self._project_root / "api" / "data" / "crawl_sessions.json"
        init_db()
        self._repo = CrawlSessionRepository()
        self._output_repo = CrawlOutputRepository()
        self._repo.import_existing_file(self._index_file)
        self._load_index()

    def _load_index(self) -> None:
        try:
            data = self._repo.load_sessions()
            for entry in data:
                crawl_id = entry.get("crawl_id", "")
                if crawl_id and crawl_id not in self._sessions:
                    self._sessions[crawl_id] = CrawlProgress(
                        crawl_id=crawl_id,
                        site_name=entry.get("site_name", ""),
                        novel_name=entry.get("novel_name", ""),
                        chapters_crawled=entry.get("chapters_crawled", 0),
                        chapters_total=entry.get("chapters_total", 0),
                        status=entry.get("status", "completed"),
                        started_at=entry.get("started_at"),
                        finished_at=entry.get("finished_at"),
                        error_message=entry.get("error_message", ""),
                        combined_file=entry.get("combined_file", ""),
                        combined_md_file=entry.get("combined_md_file", entry.get("combined_txt_file", "")),
                        completed=entry.get("completed"),
                        output_format=entry.get("output_format", "md"),
                        source_url=entry.get("source_url", ""),
                    )
            logger.info("Loaded %d persisted session(s) from %s", len(data), self._index_file)
        except Exception as exc:
            logger.warning("Failed to load session index: %s", exc)

    def _persist_index(self) -> None:
        try:
            entries: list[dict] = []
            for p in self._sessions.values():
                entries.append({
                    "crawl_id": p.crawl_id,
                    "site_name": p.site_name,
                    "novel_name": p.novel_name,
                    "chapters_crawled": p.chapters_crawled,
                    "chapters_total": p.chapters_total,
                    "status": p.status,
                    "started_at": p.started_at,
                    "finished_at": p.finished_at,
                    "error_message": p.error_message,
                    "combined_file": p.combined_file,
                    "combined_md_file": p.combined_md_file,
                    "completed": p.completed,
                    "output_format": p.output_format,
                    "source_url": p.source_url,
                })
            self._repo.save_sessions(entries)
        except Exception as exc:
            logger.warning("Failed to persist session index: %s", exc)

    def _now(self) -> str:
        return datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    def _new_crawl_id(self) -> str:
        return str(uuid.uuid4())[:8]

    def start_crawl(
        self,
        spider_name: str,
        site_name: str,
        novel: str,
        limit: int,
        output_format: str = "md",
        chapter_range: Optional[str] = None,
        novel_name: Optional[str] = None,
        completed: Optional[bool] = None,
        combine_chapters: bool = False,
        source_url: Optional[str] = None,
    ) -> str:
        crawl_id = self._new_crawl_id()
        output_dir = f"output/crawl/{crawl_id}"

        env = os.environ.copy()
        env["SCRAPY_ENV"] = "dev"
        env["PYTHONUNBUFFERED"] = "1"
        env.setdefault("PYTHONPATH", str(self._project_root))
        if _get_chromedriver_path():
            env["CHROMEDRIVER_PATH"] = _RESOLVED_CHROMEDRIVER_PATH

        scrapy_cmd = [
            sys.executable, "-u", "-m", "scrapy", "crawl", spider_name,
            "-a", f"novel={novel}", "-a", f"limit={limit}",
            "-s", f"OUTPUT_DIR={output_dir}",
            "-s", f"OUTPUT_FORMAT={output_format}",
            "-s", "LOG_LEVEL=INFO",
            "-s", f"SITE_NAME={site_name}",
        ]
        if chapter_range:
            scrapy_cmd += ["-a", f"chapter_range={chapter_range}"]
        if novel_name:
            scrapy_cmd += ["-s", f"NOVEL_NAME={novel_name}"]
        if completed is not None:
            scrapy_cmd += ["-s", f"NOVEL_COMPLETED={'true' if completed else 'false'}"]

        progress = CrawlProgress(
            status="running",
            started_at=self._now(),
            crawl_id=crawl_id,
            site_name=site_name,
            completed=completed,
            novel_name=novel_name or "",
            combine_chapters=combine_chapters,
            output_format=output_format,
            source_url=source_url or novel or "",
        )
        progress.add_log(f"[CMD] {' '.join(scrapy_cmd)}", "info")

        with self._lock:
            self._sessions[crawl_id] = progress
            self._cancel_flags[crawl_id] = False

        self._persist_index()
        logger.info("Starting crawl %s: %s", crawl_id, " ".join(scrapy_cmd))

        thread = Thread(
            target=self._run_subprocess_thread,
            args=(crawl_id, scrapy_cmd, str(self._project_root), env),
            daemon=True,
        )
        thread.start()

        return crawl_id

    def _run_subprocess_thread(self, crawl_id: str, cmd: list[str], cwd: str, env: dict[str, str]) -> None:
        with self._lock:
            progress = self._sessions.get(crawl_id)
            if progress is None:
                return

        try:
            process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                cwd=cwd,
                env=env,
                bufsize=1,
            )
            progress.add_log(f"[PID] {process.pid}", "debug")

            saw_output = False
            for raw_line in process.stdout:
                line = raw_line.decode("utf-8", errors="replace").rstrip("\n\r")

                with self._lock:
                    cancel = self._cancel_flags.get(crawl_id, False)

                if cancel:
                    progress.add_log("[CANCEL] Terminating subprocess...", "warning")
                    process.terminate()
                    try:
                        process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        process.kill()
                    with self._lock:
                        progress.status = "cancelled"
                        progress.finished_at = self._now()
                    logger.info("Crawl %s cancelled.", crawl_id)
                    self._persist_index()
                    return

                if line.strip():
                    saw_output = True
                self._parse_line(crawl_id, line)

            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                pass

            with self._lock:
                if progress.status == "running":
                    if process.returncode == 0:
                        progress.status = "completed"
                        progress.finished_at = self._now()
                        progress.add_log("[DONE] Scrapy finished successfully.", "info")
                        t = Thread(target=self._run_combine, args=(crawl_id,), daemon=True)
                        t.start()
                        self._persist_index()
                    else:
                        progress.status = "failed"
                        progress.finished_at = self._now()
                        if not saw_output:
                            progress.error_message = f"Scrapy exited with code {process.returncode} (no output)"
                        else:
                            progress.error_message = f"Scrapy exited with code {process.returncode}"
                        progress.add_log(f"[FAIL] Scrapy exit code: {process.returncode}", "error")
                        self._persist_index()

        except Exception as exc:
            logger.exception("Crawl %s failed with exception", crawl_id)
            with self._lock:
                progress.status = "failed"
                progress.error_message = repr(exc)
                progress.add_log(f"[ERROR] {repr(exc)}", "error")
                progress.finished_at = self._now()
                self._persist_index()

    def _parse_line(self, crawl_id: str, line: str) -> None:
        stripped = line.strip()
        with self._lock:
            progress = self._sessions.get(crawl_id)
            if progress is None:
                return

            if not stripped:
                return

            if _ERROR_RE.search(stripped):
                progress.errors.append(stripped)
                progress.add_log(stripped, "error")
                return

            if _WARNING_RE.search(stripped):
                progress.add_log(stripped, "warning")
                return

            if self._is_noise(stripped):
                return

            m = _LOG_LINE_RE.search(stripped)
            if m:
                progress.current_title = m.group("title").strip()
                progress.add_log(stripped, "info")
                progress.chapters_crawled += 1
                progress.chapters_total = int(m.group("limit"))
                return

            m = _TOTAL_RE.search(stripped)
            if m:
                if progress.chapters_total == 0:
                    progress.chapters_total = int(m.group("count"))
                    progress.add_log(stripped, "info")
                return

            progress.add_log(stripped, "info")

    def _is_noise(self, line: str) -> bool:
        noise_prefixes = (
            "[scrapy.core.engine]", "[scrapy.downloadermiddlewares",
            "[scrapy.extensions", "[scrapy.spidermiddlewares",
            "[scrapy.util", "[scrapy.middleware", "[scrapy.crawler",
            "[scrapy.core.scraper", "[scrapy.addons]", "[py.warnings]",
            "DEBUG:", "INFO: Scrapy", "INFO: Versions:",
            "INFO: Enabled", "INFO: Overridden", "INFO: Telnet",
        )
        return any(line.startswith(p) for p in noise_prefixes)

    def _read_chapter_file(self, filepath: Path) -> list[dict]:
        import json as _json
        with open(filepath, "r", encoding="utf-8") as fh:
            raw = fh.read().strip()

        if not raw:
            return []

        if filepath.suffix.lower() == ".md":
            return []

        if "\n" in raw:
            results: list[dict] = []
            for line in raw.splitlines():
                line = line.strip()
                if not line:
                    continue
                try:
                    results.append(_json.loads(line))
                except _json.JSONDecodeError:
                    pass
            return results
        else:
            try:
                return [_json.loads(raw)]
            except _json.JSONDecodeError:
                return []

    def _run_combine(self, crawl_id: str) -> None:
        import json as _json
        from api.services.file_service import get_file_service

        file_service = get_file_service()

        with self._lock:
            p = self._sessions.get(crawl_id)
        if not p:
            return

        output_dir = file_service.get_output_dir(crawl_id)
        output_format = p.output_format or "md"
        chapter_files = file_service.list_output_files(crawl_id, fmt=output_format)
        if not chapter_files:
            with self._lock:
                p = self._sessions.get(crawl_id)
                if p:
                    p.add_log("[COMBINE] No chapter files found, skipping.", "warning")
            return
        chapter_files_sorted = sorted(chapter_files, key=lambda f: f.chapter_number)

        site_name = p.site_name
        novel_name = p.novel_name
        completed = p.completed

        if not novel_name:
            for file_meta in chapter_files_sorted:
                filepath = output_dir / file_meta.filename
                try:
                    with open(filepath, "r", encoding="utf-8") as fh:
                        raw = fh.read().strip()
                    if not raw:
                        continue
                    if filepath.suffix.lower() == ".txt":
                        first_line = raw.split("\n", 1)[0].strip()
                        filename_part = first_line.split(": ", 1)[0].rstrip(":")
                        if filename_part and filename_part.endswith("_chapter_1"):
                            slug = filename_part[:-len("_chapter_1")]
                            if slug.startswith(f"{site_name}_"):
                                slug = slug[len(site_name) + 1:]
                            if slug and slug.lower() != "unknown":
                                novel_name = slug
                                break
                    else:
                        chapters = self._read_chapter_file(filepath)
                        if chapters:
                            first = chapters[0]
                            if isinstance(first, dict):
                                novel_name = first.get("novel_title") or first.get("title") or ""
                            if novel_name:
                                break
                except OSError:
                    continue

        # Strip site_name_ prefix from novel_name if it was derived from the URL
        # and already contains the site prefix (e.g. "Wattpad_Misconduct_Ongoing" -> "Misconduct_Ongoing")
        if site_name and novel_name and novel_name.startswith(f"{site_name}_"):
            novel_name = novel_name[len(site_name) + 1:]

        if site_name and novel_name:
            status = "Completed" if completed else "Ongoing" if completed is not None else ""
            safe_name = sanitize_filename(novel_name)
            if status:
                base_name = f"{site_name}_{safe_name}_{status}"
            else:
                base_name = f"{site_name}_{safe_name}"
        elif novel_name:
            status = "Completed" if completed else "Ongoing" if completed is not None else ""
            base_name = f"{sanitize_filename(novel_name)}_{status}" if status else sanitize_filename(novel_name)
        else:
            base_name = crawl_id

        combined: list[dict] = []
        novel_metadata: Optional[dict] = None

        # Write combined .md — full chapter content including header, separated by HR
        md_filename = f"{sanitize_filename(base_name)}.md"
        md_path = output_dir / md_filename
        md_parts: list[str] = []
        chapters_data: list[dict] = []
        for file_meta in chapter_files_sorted:
            filepath = output_dir / file_meta.filename
            try:
                raw = filepath.read_text(encoding="utf-8").strip()
                if raw:
                    md_parts.append(raw)
                chapters_data.append(chapter_record_from_output_file(filepath, file_meta.chapter_number))
            except OSError:
                continue
        md_text = "\n\n---\n\n".join(md_parts).rstrip()
        try:
            with open(md_path, "w", encoding="utf-8") as fh:
                fh.write(md_text)
        except Exception as exc:
            with self._lock:
                p = self._sessions.get(crawl_id)
                if p:
                    p.add_log(f"[COMBINE] Error writing Markdown: {exc}", "error")
            return

        # Also write combined .json for the API
        combined_name = f"{sanitize_filename(base_name)}_combined_{crawl_id}.json"
        combined_path = output_dir / combined_name
        combined_payload = {
            "crawl_id": crawl_id,
            "chapter_count": len(chapter_files_sorted),
            "chapters": chapters_data,
        }
        try:
            with open(combined_path, "w", encoding="utf-8") as fh:
                _json.dump(combined_payload, fh, ensure_ascii=False, indent=2)
        except Exception as exc:
            with self._lock:
                p = self._sessions.get(crawl_id)
                if p:
                    p.add_log(f"[COMBINE] Error writing JSON: {exc}", "error")
            return

        with self._lock:
            p = self._sessions.get(crawl_id)
            if p:
                p.combined_file = combined_name
                p.combined_md_file = md_filename
                p.add_log(f"[COMBINE] Created '{md_filename}' with {len(chapter_files_sorted)} chapters.", "info")
                self._persist_index()
        try:
            self._output_repo.scan_output_dir(crawl_id, output_dir, ext=output_format)
        except Exception as exc:
            logger.warning("Failed to index crawl output files for %s: %s", crawl_id, exc)

    def cancel_crawl(self, crawl_id: str) -> bool:
        with self._lock:
            if crawl_id not in self._sessions:
                return False
            self._cancel_flags[crawl_id] = True
            return True

    def get_progress(self, crawl_id: str) -> Optional[CrawlProgress]:
        with self._lock:
            return self._sessions.get(crawl_id)

    def get_active_ids(self) -> list[str]:
        with self._lock:
            return [cid for cid, p in self._sessions.items() if p.status == "running"]

    def get_all_sessions(self) -> list[CrawlProgress]:
        with self._lock:
            return list(self._sessions.values())

    def get_novel_slug_from_crawl_id(self, crawl_id: str) -> str:
        with self._lock:
            progress = self._sessions.get(crawl_id)
            if not progress:
                return ""
            for entry in progress.log_lines:
                m = re.search(r"\[([^\]]+)/\d+\]", entry.message)
                if m:
                    return m.group(1)
            return ""

    def delete_sessions(self, crawl_ids: list[str]) -> int:
        import shutil
        from api.services.file_service import get_file_service

        deleted_count = 0
        file_service = get_file_service()

        with self._lock:
            for crawl_id in crawl_ids:
                if crawl_id in self._sessions:
                    del self._sessions[crawl_id]
                    if crawl_id in self._cancel_flags:
                        del self._cancel_flags[crawl_id]
                    deleted_count += 1

        for crawl_id in crawl_ids:
            try:
                output_dir = file_service.get_output_dir(crawl_id)
                if output_dir.exists():
                    shutil.rmtree(output_dir)
                    logger.info("Deleted output directory for crawl %s", crawl_id)
            except Exception as exc:
                logger.warning("Failed to delete output directory for %s: %s", crawl_id, exc)

        try:
            self._output_repo.delete_for_crawls(crawl_ids)
        except Exception as exc:
            logger.warning("Failed to delete crawl output metadata: %s", exc)

        self._persist_index()
        return deleted_count


_crawl_service: Optional[CrawlService] = None


def get_crawl_service() -> CrawlService:
    global _crawl_service
    if _crawl_service is None:
        _crawl_service = CrawlService()
    return _crawl_service
