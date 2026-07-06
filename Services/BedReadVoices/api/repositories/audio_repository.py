"""PostgreSQL repositories for BedRead and generated audio metadata."""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

from sqlalchemy import delete, func, select

from api.db import SessionLocal
from api.models.db_models import BedReadAudioJobRecord, GeneratedAudioFileRecord


class BedReadJobRepository:
    def __init__(self, session_factory=SessionLocal) -> None:
        self.session_factory = session_factory

    def load_jobs(self) -> list[dict]:
        with self.session_factory() as db:
            rows = db.scalars(select(BedReadAudioJobRecord).order_by(BedReadAudioJobRecord.started_at.desc().nullslast())).all()
            return [self._row_to_dict(row) for row in rows]

    def has_jobs(self) -> bool:
        with self.session_factory() as db:
            return bool(db.scalar(select(func.count()).select_from(BedReadAudioJobRecord)))

    def save_jobs(self, entries: list[dict]) -> None:
        with self.session_factory() as db:
            for entry in entries:
                db.merge(self._dict_to_row(entry))
            db.commit()

    def import_existing_file(self, jobs_file: Path) -> None:
        if not jobs_file.exists() or self.has_jobs():
            return
        raw = json.loads(jobs_file.read_text(encoding="utf-8"))
        if isinstance(raw, list):
            for entry in raw:
                if isinstance(entry, dict) and not entry.get("output_dir") and entry.get("batch_id"):
                    entry["output_dir"] = str(jobs_file.parent / entry["batch_id"])
            self.save_jobs(raw)

    @staticmethod
    def _dict_to_row(entry: dict) -> BedReadAudioJobRecord:
        zip_path = entry.get("zip_path") or ""
        output_dir = entry.get("output_dir") or ""
        return BedReadAudioJobRecord(
            batch_id=entry.get("batch_id", ""),
            created_by_user_id=entry.get("created_by_user_id"),
            story_id=entry.get("story_id", ""),
            story_title=entry.get("story_title", ""),
            voice=entry.get("voice", "af_sarah"),
            lang=entry.get("lang", "en-us"),
            speed=entry.get("speed", 1.0),
            format=entry.get("format", "wav"),
            status=entry.get("status", "pending"),
            progress_pct=entry.get("progress_pct", 0),
            output_dir=output_dir,
            started_at=entry.get("started_at"),
            processing_started_at=entry.get("processing_started_at"),
            finished_at=entry.get("finished_at"),
            error=entry.get("error", ""),
            queue_position=entry.get("queue_position", 0),
            zip_path=zip_path,
            from_auto_mode=entry.get("from_auto_mode", False),
            chapters=entry.get("chapters", []),
            raw=entry,
        )

    @staticmethod
    def _row_to_dict(row: BedReadAudioJobRecord) -> dict:
        data = dict(row.raw or {})
        data.update({
            "batch_id": row.batch_id,
            "created_by_user_id": row.created_by_user_id,
            "story_id": row.story_id,
            "story_title": row.story_title,
            "voice": row.voice,
            "lang": row.lang,
            "speed": row.speed,
            "format": row.format,
            "status": row.status,
            "progress_pct": row.progress_pct,
            "output_dir": row.output_dir or None,
            "started_at": row.started_at,
            "processing_started_at": row.processing_started_at,
            "finished_at": row.finished_at,
            "error": row.error,
            "chapters": row.chapters or [],
            "queue_position": row.queue_position,
            "zip_path": row.zip_path or None,
            "from_auto_mode": row.from_auto_mode,
        })
        return data


class GeneratedAudioRepository:
    def __init__(self, session_factory=SessionLocal) -> None:
        self.session_factory = session_factory

    def load_jobs(self) -> list[dict]:
        with self.session_factory() as db:
            rows = db.scalars(select(GeneratedAudioFileRecord).order_by(GeneratedAudioFileRecord.updated_at.desc())).all()
            return [self._row_to_dict(row) for row in rows]

    def save_job(self, entry: dict) -> None:
        with self.session_factory() as db:
            db.merge(self._dict_to_row(entry))
            db.commit()

    def import_existing_output_dir(self, output_base: Path) -> None:
        if not output_base.exists():
            return

        existing_ids = self._existing_job_ids()
        for job_dir in output_base.iterdir():
            if not job_dir.is_dir() or job_dir.name in existing_ids:
                continue

            files = [path for path in job_dir.iterdir() if path.is_file()]
            if not files:
                continue

            final_files = [
                path
                for path in files
                if not path.name.startswith("chunk_") and path.suffix.lower() in {".wav", ".mp3"}
            ]
            chunk_files = [path for path in files if path.name.startswith("chunk_")]
            if final_files:
                output_file = max(final_files, key=lambda path: path.stat().st_mtime)
                status = "completed"
                progress_pct = 100
            else:
                output_file = None
                status = "interrupted"
                progress_pct = 0

            newest = max(files, key=lambda path: path.stat().st_mtime)
            entry = {
                "job_id": job_dir.name,
                "status": status,
                "voice": "unknown",
                "lang": "",
                "speed": 1.0,
                "format": output_file.suffix.lstrip(".").lower() if output_file else "",
                "output_dir": str(job_dir),
                "output_filename": output_file.name if output_file else "",
                "output_path": str(output_file) if output_file else "",
                "file_size_bytes": output_file.stat().st_size if output_file else 0,
                "chunks_total": len(chunk_files),
                "chunks_done": len(chunk_files),
                "progress_pct": progress_pct,
                "started_at": None,
                "finished_at": datetime.fromtimestamp(newest.stat().st_mtime).strftime("%Y-%m-%d %H:%M:%S"),
                "error": "" if output_file else "Only partial chunk files were found on disk",
                "text": "",
            }
            self.save_job(entry)

    def _existing_job_ids(self) -> set[str]:
        with self.session_factory() as db:
            return set(db.scalars(select(GeneratedAudioFileRecord.job_id)).all())

    @staticmethod
    def _dict_to_row(entry: dict) -> GeneratedAudioFileRecord:
        output_dir = entry.get("output_dir") or ""
        output_filename = entry.get("output_filename") or ""
        output_path = entry.get("output_path")
        if not output_path and output_dir and output_filename:
            output_path = str(Path(output_dir) / output_filename)
        file_size = entry.get("file_size_bytes")
        if file_size is None and output_path:
            path = Path(output_path)
            file_size = path.stat().st_size if path.exists() else 0

        return GeneratedAudioFileRecord(
            job_id=entry.get("job_id", ""),
            created_by_user_id=entry.get("created_by_user_id"),
            status=entry.get("status", "queued"),
            voice=entry.get("voice", "af_sarah"),
            lang=entry.get("lang", "en-us"),
            speed=entry.get("speed", 1.0),
            format=entry.get("format", "wav"),
            output_dir=output_dir,
            output_filename=output_filename,
            output_path=output_path or "",
            file_size_bytes=file_size or 0,
            chunks_total=entry.get("chunks_total", 0),
            chunks_done=entry.get("chunks_done", 0),
            progress_pct=entry.get("progress_pct", 0),
            started_at=entry.get("started_at"),
            finished_at=entry.get("finished_at"),
            error=entry.get("error", ""),
            text=entry.get("text", ""),
            raw=entry,
        )

    @staticmethod
    def _row_to_dict(row: GeneratedAudioFileRecord) -> dict:
        data = dict(row.raw or {})
        data.update({
            "job_id": row.job_id,
            "created_by_user_id": row.created_by_user_id,
            "status": row.status,
            "voice": row.voice,
            "lang": row.lang,
            "speed": row.speed,
            "format": row.format,
            "output_dir": row.output_dir,
            "output_filename": row.output_filename,
            "output_path": row.output_path,
            "file_size_bytes": row.file_size_bytes,
            "chunks_total": row.chunks_total,
            "chunks_done": row.chunks_done,
            "progress_pct": row.progress_pct,
            "started_at": row.started_at,
            "finished_at": row.finished_at,
            "error": row.error,
            "text": row.text,
        })
        return data
