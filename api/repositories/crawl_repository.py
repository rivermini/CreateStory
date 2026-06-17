"""PostgreSQL repository for crawl session metadata."""

from __future__ import annotations

import json
from pathlib import Path

from sqlalchemy import delete, select

from api.db import SessionLocal
from api.models.db_models import CrawlOutputFileRecord, CrawlSessionRecord


class CrawlSessionRepository:
    def __init__(self, session_factory=SessionLocal) -> None:
        self.session_factory = session_factory

    def load_sessions(self) -> list[dict]:
        with self.session_factory() as db:
            rows = db.scalars(select(CrawlSessionRecord).order_by(CrawlSessionRecord.started_at.desc().nullslast())).all()
            return [self._row_to_dict(row) for row in rows]

    def save_sessions(self, entries: list[dict]) -> None:
        with self.session_factory() as db:
            for entry in entries:
                db.merge(self._dict_to_row(entry))
            db.commit()

    def import_existing_file(self, index_file: Path) -> None:
        if not index_file.exists() or self.load_sessions():
            return
        raw = json.loads(index_file.read_text(encoding="utf-8"))
        if isinstance(raw, list):
            self.save_sessions(raw)

    @staticmethod
    def _dict_to_row(entry: dict) -> CrawlSessionRecord:
        return CrawlSessionRecord(
            crawl_id=entry.get("crawl_id", ""),
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
            raw=entry,
        )

    @staticmethod
    def _row_to_dict(row: CrawlSessionRecord) -> dict:
        data = dict(row.raw or {})
        data.update({
            "crawl_id": row.crawl_id,
            "site_name": row.site_name,
            "novel_name": row.novel_name,
            "chapters_crawled": row.chapters_crawled,
            "chapters_total": row.chapters_total,
            "status": row.status,
            "started_at": row.started_at,
            "finished_at": row.finished_at,
            "error_message": row.error_message,
            "combined_file": row.combined_file,
            "combined_md_file": row.combined_md_file,
            "completed": row.completed,
            "output_format": row.output_format,
            "source_url": row.source_url,
        })
        return data

    def delete_for_sessions(self, crawl_ids: list[str]) -> None:
        if not crawl_ids:
            return
        with self.session_factory() as db:
            db.execute(delete(CrawlSessionRecord).where(CrawlSessionRecord.crawl_id.in_(crawl_ids)))
            db.commit()


class CrawlOutputRepository:
    def __init__(self, session_factory=SessionLocal) -> None:
        self.session_factory = session_factory

    def replace_for_crawl(self, crawl_id: str, files: list[dict]) -> None:
        with self.session_factory() as db:
            db.execute(delete(CrawlOutputFileRecord).where(CrawlOutputFileRecord.crawl_id == crawl_id))
            for entry in files:
                db.add(self._dict_to_row(crawl_id, entry))
            db.commit()

    def delete_for_crawls(self, crawl_ids: list[str]) -> None:
        if not crawl_ids:
            return
        with self.session_factory() as db:
            db.execute(delete(CrawlOutputFileRecord).where(CrawlOutputFileRecord.crawl_id.in_(crawl_ids)))
            db.commit()

    def delete_for_sessions(self, crawl_ids: list[str]) -> None:
        if not crawl_ids:
            return
        with self.session_factory() as db:
            db.execute(delete(CrawlSessionRecord).where(CrawlSessionRecord.crawl_id.in_(crawl_ids)))
            db.commit()

    def scan_output_dir(self, crawl_id: str, output_dir: Path, ext: str = "md") -> list[dict]:
        if not output_dir.exists() or not output_dir.is_dir():
            self.replace_for_crawl(crawl_id, [])
            return []

        entries: list[dict] = []
        suffixes = {"md", "json"} if ext == "md" else {ext, "json"}
        paths: list[Path] = []
        for suffix in suffixes:
            paths.extend(output_dir.glob(f"*.{suffix}"))

        for path in sorted(paths, key=lambda item: (self._chapter_number_from_filename(item.name), item.name)):
            role = "chapter" if "_chapter_" in path.name else "combined"
            entries.append({
                "filename": path.name,
                "file_path": str(path),
                "file_ext": path.suffix.lstrip(".").lower(),
                "file_role": role,
                "chapter_number": self._chapter_number_from_filename(path.name),
                "size_bytes": path.stat().st_size if path.exists() else 0,
            })
        self.replace_for_crawl(crawl_id, entries)
        return entries

    @staticmethod
    def _dict_to_row(crawl_id: str, entry: dict) -> CrawlOutputFileRecord:
        filename = entry.get("filename", "")
        file_path = entry.get("file_path", "")
        return CrawlOutputFileRecord(
            file_id=f"{crawl_id}:{filename}",
            crawl_id=crawl_id,
            filename=filename,
            file_path=file_path,
            file_ext=entry.get("file_ext", ""),
            file_role=entry.get("file_role", "chapter"),
            chapter_number=entry.get("chapter_number", 0),
            size_bytes=entry.get("size_bytes", 0),
            raw=entry,
        )

    @staticmethod
    def _chapter_number_from_filename(name: str) -> int:
        import re

        m = re.search(r"_chapter_(\d+)", name)
        return int(m.group(1)) if m else 0
