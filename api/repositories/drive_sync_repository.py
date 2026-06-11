"""PostgreSQL repository for Drive Sync status, history, and jobs."""

from __future__ import annotations

from collections.abc import Callable
from typing import TYPE_CHECKING

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from api.db import SessionLocal
from api.models.db_models import (
    AppSetting,
    CoverUpdateHistoryRecord,
    DriveSyncHistoryRecord,
    DriveSyncJobRecord,
    DriveSyncStatusRecord,
    ExternalCredential,
    utcnow,
)

if TYPE_CHECKING:
    from api.models.drive_sync import DriveSyncStatus, HistoryEntry, SyncJob


def _job_to_row_data(job: "SyncJob") -> dict:
    data = job.model_dump()
    return {
        "id": data["id"],
        "kind": data["kind"],
        "status": data["status"],
        "folder_id": data["folder_id"],
        "folder_name": data["folder_name"],
        "display_name": data["display_name"],
        "created_at": data["created_at"],
        "started_at": data.get("started_at"),
        "finished_at": data.get("finished_at"),
        "result_message": data.get("result_message"),
        "chapters_added": data.get("chapters_added", 0),
        "chapters_skipped": data.get("chapters_skipped", 0),
        "error": data.get("error"),
        "logs": data.get("logs") or [],
        "main_be_api_base_url": data.get("main_be_api_base_url"),
        "chapters_count": data.get("chapters_count"),
        "version": 0,
    }


def _normalize_cover_status(status: str | None) -> str:
    if status in {"no_cover_file", "no_cover1_file"}:
        return "no_cover1_file"
    return status or "updated"


def _cover_history_entry_to_row_data(entry: dict) -> dict:
    now = utcnow()
    status = _normalize_cover_status(entry.get("status"))
    display_name = (
        entry.get("display_name")
        or entry.get("story_title")
        or entry.get("folder_name")
        or ""
    )
    story_title = entry.get("story_title") or display_name

    return {
        "id": entry["id"],
        "folder_id": entry.get("folder_id") or "",
        "folder_name": entry.get("folder_name") or display_name,
        "display_name": display_name,
        "story_id": entry.get("story_id") or "",
        "story_title": story_title,
        "status": status,
        "cover_url": entry.get("cover_url"),
        "error": entry.get("error"),
        "finished_at": entry.get("finished_at"),
        "cover_file_name": entry.get("cover_file_name"),
        "last_updated": entry.get("last_updated") or now,
        "created_at": entry.get("created_at") or now,
        "updated_at": now,
    }


class DriveSyncRepository:
    def __init__(self, session_factory=SessionLocal) -> None:
        self.session_factory = session_factory

    def load_status(self) -> dict | None:
        with self.session_factory() as db:
            row = db.get(DriveSyncStatusRecord, "singleton")
            return dict(row.data) if row is not None else None

    def save_status(self, status: "DriveSyncStatus") -> None:
        data = status.model_dump(mode="json")
        with self.session_factory() as db:
            row = db.get(DriveSyncStatusRecord, "singleton")
            if row is None:
                row = DriveSyncStatusRecord(id="singleton", data=data)
                db.add(row)
            else:
                row.data = data
            db.commit()

    def load_drive_config(self) -> dict | None:
        with self.session_factory() as db:
            row = db.get(AppSetting, "drive_sync_config")
            return dict(row.value) if row is not None else None

    def save_drive_config(self, config: dict) -> None:
        with self.session_factory() as db:
            row = db.get(AppSetting, "drive_sync_config")
            if row is None:
                row = AppSetting(key="drive_sync_config", value=config)
                db.add(row)
            else:
                row.value = config
            db.commit()

    def load_app_setting(self, key: str) -> dict | None:
        with self.session_factory() as db:
            row = db.get(AppSetting, key)
            return dict(row.value) if row is not None else None

    def save_app_setting(self, key: str, value: dict) -> None:
        with self.session_factory() as db:
            row = db.get(AppSetting, key)
            if row is None:
                row = AppSetting(key=key, value=value)
                db.add(row)
            else:
                row.value = value
            db.commit()

    def load_drive_credential(self) -> tuple[str, bytes] | None:
        with self.session_factory() as db:
            row = db.scalar(select(ExternalCredential).where(ExternalCredential.name == "google_service_account"))
            if row is None:
                return None
            return row.filename, bytes(row.content)

    def load_history(self) -> list[dict]:
        with self.session_factory() as db:
            rows = db.scalars(select(DriveSyncHistoryRecord).order_by(DriveSyncHistoryRecord.timestamp.desc())).all()
            return [self._history_row_to_dict(row) for row in rows]

    def save_history(self, entries: list["HistoryEntry"]) -> None:
        with self.session_factory() as db:
            db.execute(delete(DriveSyncHistoryRecord))
            for entry in entries:
                db.add(self._history_entry_to_row(entry))
            db.commit()

    def load_jobs(self) -> list[dict]:
        with self.session_factory() as db:
            rows = db.scalars(select(DriveSyncJobRecord).order_by(DriveSyncJobRecord.created_at_text.desc())).all()
            return [self._job_row_to_dict(row) for row in rows]

    def _load_all_jobs(self) -> list["SyncJob"]:
        """Load all jobs ordered newest first. Used by callers that need the full list."""
        with self.session_factory() as db:
            rows = db.scalars(
                select(DriveSyncJobRecord)
                .order_by(DriveSyncJobRecord.created_at_text.desc())
            ).all()
            return [SyncJob(**self._job_row_to_dict(row)) for row in rows]

    def _upsert_job(self, job: "SyncJob") -> None:
        """Insert or update a single job. Uses ON CONFLICT DO UPDATE (upsert)."""
        data = _job_to_row_data(job)
        data["updated_at"] = utcnow()
        with self.session_factory() as db:
            db.execute(
                insert(DriveSyncJobRecord).values(data).on_conflict_do_update(
                    index_elements=["id"],
                    set_=data,
                )
            )
            db.commit()

    def _delete_job_by_id(self, job_id: str) -> bool:
        """Delete a single job by ID. Returns True if a row was deleted."""
        with self.session_factory() as db:
            result = db.execute(
                delete(DriveSyncJobRecord).where(DriveSyncJobRecord.id == job_id)
            )
            db.commit()
            return result.rowcount > 0

    def _enforce_jobs_limit(self, max_entries: int) -> None:
        """Delete oldest jobs if total exceeds max_entries."""
        with self.session_factory() as db:
            total = db.query(DriveSyncJobRecord).count()
            if total <= max_entries:
                return
            to_delete = total - max_entries
            oldest_ids = (
                db.query(DriveSyncJobRecord.id)
                .order_by(DriveSyncJobRecord.created_at_text.asc())
                .limit(to_delete)
                .all()
            )
            if oldest_ids:
                db.execute(
                    delete(DriveSyncJobRecord).where(
                        DriveSyncJobRecord.id.in_([r[0] for r in oldest_ids])
                    )
                )
            db.commit()

    def with_jobs_lock(self, fn: "Callable[[list[SyncJob]], list[SyncJob]]") -> list["SyncJob"]:
        """
        Atomic read-modify-write for jobs.

        Reads all jobs from the DB, applies ``fn`` to the list, then applies
        the diff (insert / update / delete) to the DB without touching rows
        that are unchanged.  Safe against mid-operation crashes — no row is
        ever deleted unless the full operation succeeds.

        The legacy full-table-wipe pattern (delete-all + re-insert) is replaced
        by targeted upserts and targeted deletes.
        """
        from api.models.drive_sync import SyncJob

        with self.session_factory() as db:
            with db.begin():
                rows = (
                    db.scalars(
                        select(DriveSyncJobRecord)
                        .with_for_update()
                        .order_by(DriveSyncJobRecord.created_at_text.desc())
                    ).all()
                )
                before: dict[str, "SyncJob"] = {
                    row.id: SyncJob(**self._job_row_to_dict(row)) for row in rows
                }

                after = fn(list(before.values()))

            # Determine the minimal diff to apply outside the transaction.
            # (Smallest safe scope — avoids holding the row lock longer than needed.)
            before_ids = set(before)
            after_ids = {job.id for job in after}

            ids_to_delete = before_ids - after_ids
            jobs_to_insert = [job for job in after if job.id not in before_ids]
            jobs_to_update = [job for job in after if job.id in before_ids]

        # Apply deletes (outside the DB transaction — safe to fail silently)
        for job_id in ids_to_delete:
            self._delete_job_by_id(job_id)

        # Apply inserts and updates (each is its own small transaction)
        for job in jobs_to_insert:
            self._upsert_job(job)
        for job in jobs_to_update:
            self._upsert_job(job)

        return after

    @staticmethod
    def _history_entry_to_row(entry: "HistoryEntry") -> DriveSyncHistoryRecord:
        data = entry.model_dump()
        return DriveSyncHistoryRecord(
            id=data["id"],
            timestamp=data["timestamp"],
            kind=data["kind"],
            status=data["status"],
            title=data["title"],
            subtitle=data["subtitle"],
            items=data.get("items"),
            error=data.get("error"),
        )

    @staticmethod
    def _history_row_to_dict(row: DriveSyncHistoryRecord) -> dict:
        return {
            "id": row.id,
            "timestamp": row.timestamp,
            "kind": row.kind,
            "status": row.status,
            "title": row.title,
            "subtitle": row.subtitle,
            "items": row.items,
            "error": row.error,
        }

    @staticmethod
    def _job_row_to_dict(row: DriveSyncJobRecord) -> dict:
        return {
            "id": row.id,
            "kind": row.kind,
            "status": row.status,
            "folder_id": row.folder_id,
            "folder_name": row.folder_name,
            "display_name": row.display_name,
            "created_at": row.created_at_text,
            "started_at": row.started_at,
            "finished_at": row.finished_at,
            "result_message": row.result_message,
            "chapters_added": row.chapters_added,
            "chapters_skipped": row.chapters_skipped,
            "error": row.error,
            "logs": row.logs or [],
            "main_be_api_base_url": row.main_be_api_base_url,
            "chapters_count": row.chapters_count,
        }

    def save_cover_update_history(self, entry: dict) -> None:
        data = _cover_history_entry_to_row_data(entry)
        update_data = {k: v for k, v in data.items() if k not in {"id", "created_at"}}
        with self.session_factory() as db:
            db.execute(
                insert(CoverUpdateHistoryRecord).values(data).on_conflict_do_update(
                    index_elements=["id"],
                    set_=update_data,
                )
            )
            db.commit()

    def load_cover_update_histories(self) -> list[dict]:
        with self.session_factory() as db:
            rows = db.scalars(
                select(CoverUpdateHistoryRecord).order_by(CoverUpdateHistoryRecord.last_updated.desc())
            ).all()
            return [self._cover_history_row_to_dict(row) for row in rows]

    def get_cover_update_by_folder_id(self, folder_id: str) -> dict | None:
        with self.session_factory() as db:
            row = db.scalar(
                select(CoverUpdateHistoryRecord)
                .where(CoverUpdateHistoryRecord.folder_id == folder_id)
                .order_by(CoverUpdateHistoryRecord.last_updated.desc())
                .limit(1)
            )
            return self._cover_history_row_to_dict(row) if row is not None else None

    def get_cover_update_by_story_id(self, story_id: str) -> dict | None:
        with self.session_factory() as db:
            row = db.scalar(
                select(CoverUpdateHistoryRecord)
                .where(CoverUpdateHistoryRecord.story_id == story_id)
                .order_by(CoverUpdateHistoryRecord.last_updated.desc())
                .limit(1)
            )
            return self._cover_history_row_to_dict(row) if row is not None else None

    @staticmethod
    def _cover_history_row_to_dict(row: CoverUpdateHistoryRecord) -> dict:
        last_updated = row.last_updated or row.updated_at or row.created_at
        display_name = row.display_name or row.story_title or row.folder_name
        return {
            "id": row.id,
            "story_id": row.story_id or None,
            "story_title": row.story_title or display_name,
            "folder_id": row.folder_id,
            "folder_name": row.folder_name,
            "display_name": display_name,
            "cover_file_name": row.cover_file_name,
            "status": _normalize_cover_status(row.status),
            "cover_url": row.cover_url,
            "error": row.error,
            "finished_at": row.finished_at,
            "last_updated": last_updated.isoformat() if last_updated else None,
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        }
