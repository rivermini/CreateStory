"""PostgreSQL repository for Drive Sync status, history, and jobs."""

from __future__ import annotations

from collections.abc import Callable
from typing import TYPE_CHECKING

from sqlalchemy import delete, func, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from api.db import SessionLocal
from api.models.db_models import (
    AppSetting,
    BannerUpdateHistoryRecord,
    CoverUpdateHistoryRecord,
    DriveSyncHistoryRecord,
    DriveSyncJobRecord,
    DriveSyncStatusRecord,
    ExternalCredential,
    IntroUpdateHistoryRecord,
    utcnow,
)
from api.service_auth import current_owner

if TYPE_CHECKING:
    from api.models.drive_sync import DriveSyncStatus, HistoryEntry, SyncJob


def _job_to_row_data(job: "SyncJob") -> dict:
    data = job.model_dump()
    return {
        "id": data["id"],
        "created_by_user_id": data.get("created_by_user_id") or current_owner(),
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
        "payload": data.get("payload") or {},
        "client_batch_id": data.get("client_batch_id"),
        "batch_item_index": data.get("batch_item_index"),
        "attempt_count": data.get("attempt_count", 0),
        "claimed_at": data.get("claimed_at"),
        "last_heartbeat_at": data.get("last_heartbeat_at"),
        "last_error": data.get("last_error"),
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
        "created_by_user_id": entry.get("created_by_user_id") or current_owner(),
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


def _normalize_banner_status(status: str | None) -> str:
    if status in {"no_banner_file", "no_banner1_file"}:
        return "no_banner1_file"
    return status or "updated"


def _banner_history_entry_to_row_data(entry: dict) -> dict:
    now = utcnow()
    status = _normalize_banner_status(entry.get("status"))
    display_name = (
        entry.get("display_name")
        or entry.get("story_title")
        or entry.get("folder_name")
        or ""
    )
    story_title = entry.get("story_title") or display_name

    return {
        "id": entry["id"],
        "created_by_user_id": entry.get("created_by_user_id") or current_owner(),
        "folder_id": entry.get("folder_id") or "",
        "folder_name": entry.get("folder_name") or display_name,
        "display_name": display_name,
        "story_id": entry.get("story_id") or "",
        "story_title": story_title,
        "status": status,
        "banner_url": entry.get("banner_url"),
        "error": entry.get("error"),
        "finished_at": entry.get("finished_at"),
        "banner_file_name": entry.get("banner_file_name"),
        "last_updated": entry.get("last_updated") or now,
        "created_at": entry.get("created_at") or now,
        "updated_at": now,
    }


def _normalize_intro_status(status: str | None) -> str:
    if status in {"no_intro_file", "no_intro1_file"}:
        return "no_intro1_file"
    return status or "updated"


def _intro_history_entry_to_row_data(entry: dict) -> dict:
    now = utcnow()
    status = _normalize_intro_status(entry.get("status"))
    display_name = (
        entry.get("display_name")
        or entry.get("story_title")
        or entry.get("folder_name")
        or ""
    )
    story_title = entry.get("story_title") or display_name

    return {
        "id": entry["id"],
        "created_by_user_id": entry.get("created_by_user_id") or current_owner(),
        "folder_id": entry.get("folder_id") or "",
        "folder_name": entry.get("folder_name") or display_name,
        "display_name": display_name,
        "story_id": entry.get("story_id") or "",
        "story_title": story_title,
        "status": status,
        "intro_url": entry.get("intro_url"),
        "error": entry.get("error"),
        "finished_at": entry.get("finished_at"),
        "intro_file_name": entry.get("intro_file_name"),
        "last_updated": entry.get("last_updated") or now,
        "created_at": entry.get("created_at") or now,
        "updated_at": now,
    }


class DriveSyncRepository:
    _QUEUE_ADMISSION_LOCK_ID = 2026071101

    def __init__(self, session_factory=SessionLocal) -> None:
        self.session_factory = session_factory

    @classmethod
    def _lock_queue_admission(cls, db: Session) -> None:
        """Serialize queue-capacity checks across single and batch requests."""
        try:
            bind = db.get_bind()
        except AttributeError:
            return
        if bind.dialect.name == "postgresql":
            db.execute(
                text("SELECT pg_advisory_xact_lock(:lock_id)"),
                {"lock_id": cls._QUEUE_ADMISSION_LOCK_ID},
            )

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

    def save_drive_credential(
        self,
        filename: str,
        content: bytes,
        content_type: str = "application/json",
    ) -> None:
        now = utcnow()
        with self.session_factory() as db:
            row = db.scalar(select(ExternalCredential).where(ExternalCredential.name == "google_service_account"))
            if row is None:
                db.add(ExternalCredential(
                    name="google_service_account",
                    filename=filename,
                    content_type=content_type,
                    content=content,
                    created_at=now,
                    updated_at=now,
                ))
            else:
                row.filename = filename
                row.content_type = content_type
                row.content = content
                row.updated_at = now
            db.commit()

    def drive_credential_exists(self) -> bool:
        with self.session_factory() as db:
            return db.scalar(
                select(func.count()).select_from(ExternalCredential).where(
                    ExternalCredential.name == "google_service_account"
                )
            ) > 0

    def load_history(self) -> list[dict]:
        with self.session_factory() as db:
            rows = db.scalars(select(DriveSyncHistoryRecord).order_by(DriveSyncHistoryRecord.timestamp.desc())).all()
            return [self._history_row_to_dict(row) for row in rows]

    def save_history(self, entries: list["HistoryEntry"]) -> None:
        with self.session_factory() as db:
            for entry in entries:
                db.merge(self._history_entry_to_row(entry))
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

    def get_job_by_id(self, job_id: str) -> "SyncJob | None":
        """Load one job without materializing the rest of the queue."""
        from api.models.drive_sync import SyncJob

        with self.session_factory() as db:
            row = db.get(DriveSyncJobRecord, job_id)
            return SyncJob(**self._job_row_to_dict(row)) if row is not None else None

    def update_job_fields(self, job_id: str, fields: dict) -> bool:
        """Update one claimed job while holding a row-level lock."""
        allowed = {
            "status",
            "started_at",
            "finished_at",
            "result_message",
            "chapters_added",
            "chapters_skipped",
            "error",
            "logs",
            "main_be_api_base_url",
            "last_heartbeat_at",
            "last_error",
        }
        updates = {key: value for key, value in fields.items() if key in allowed}
        if not updates:
            return False
        with self.session_factory() as db:
            with db.begin():
                row = db.scalar(
                    select(DriveSyncJobRecord)
                    .where(DriveSyncJobRecord.id == job_id)
                    .with_for_update()
                )
                if row is None:
                    return False
                for key, value in updates.items():
                    setattr(row, key, value)
                row.version = int(row.version or 0) + 1
                row.updated_at = utcnow()
        return True

    def append_job_log(self, job_id: str, entry: dict) -> bool:
        """Append one log entry without reading or locking unrelated jobs."""
        with self.session_factory() as db:
            with db.begin():
                row = db.scalar(
                    select(DriveSyncJobRecord)
                    .where(DriveSyncJobRecord.id == job_id)
                    .with_for_update()
                )
                if row is None:
                    return False
                logs = list(row.logs or [])
                logs.append(entry)
                row.logs = logs
                row.last_heartbeat_at = utcnow()
                row.version = int(row.version or 0) + 1
                row.updated_at = utcnow()
        return True

    def _enforce_jobs_limit(self, max_entries: int) -> None:
        """Trim only terminal history; queued/running work is never deleted."""
        with self.session_factory() as db:
            total = db.query(DriveSyncJobRecord).count()
            if total <= max_entries:
                return
            to_delete = total - max_entries
            oldest_ids = (
                db.query(DriveSyncJobRecord.id)
                .filter(DriveSyncJobRecord.status.in_(("success", "error", "cancelled")))
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

    def count_active_jobs(self, db: Session | None = None) -> int:
        def _count(session: Session) -> int:
            return int(session.scalar(
                select(func.count()).select_from(DriveSyncJobRecord).where(
                    DriveSyncJobRecord.status.in_(("queued", "running"))
                )
            ) or 0)

        if db is not None:
            return _count(db)
        with self.session_factory() as session:
            return _count(session)

    def insert_job_batch(self, jobs: list["SyncJob"], client_batch_id: str) -> tuple[list["SyncJob"], bool]:
        """Insert a batch atomically, or return the original batch on retry."""
        from api.models.drive_sync import SyncJob

        try:
            with self.session_factory() as db:
                with db.begin():
                    self._lock_queue_admission(db)
                    existing_rows = db.scalars(
                        select(DriveSyncJobRecord)
                        .where(DriveSyncJobRecord.client_batch_id == client_batch_id)
                        .order_by(DriveSyncJobRecord.batch_item_index.asc())
                        .with_for_update()
                    ).all()
                    if existing_rows:
                        return [SyncJob(**self._job_row_to_dict(row)) for row in existing_rows], False
                    if self.count_active_jobs(db) + len(jobs) > 500:
                        raise ValueError("Drive sync queue can contain at most 500 active jobs.")
                    for index, job in enumerate(jobs):
                        job.client_batch_id = client_batch_id
                        job.batch_item_index = index
                        db.execute(insert(DriveSyncJobRecord).values(_job_to_row_data(job)))
        except IntegrityError:
            # Two simultaneous retries can both observe no rows before either
            # inserts. The unique batch-item constraint chooses one winner;
            # the loser returns that committed original instead of a 500.
            with self.session_factory() as db:
                existing_rows = db.scalars(
                    select(DriveSyncJobRecord)
                    .where(DriveSyncJobRecord.client_batch_id == client_batch_id)
                    .order_by(DriveSyncJobRecord.batch_item_index.asc())
                ).all()
                if existing_rows:
                    return [SyncJob(**self._job_row_to_dict(row)) for row in existing_rows], False
            raise
        return jobs, True

    def claim_next_job(self) -> "SyncJob | None":
        """Atomically claim the oldest queued job using SKIP LOCKED."""
        from api.models.drive_sync import SyncJob

        now = utcnow()
        with self.session_factory() as db:
            with db.begin():
                row = db.scalar(
                    select(DriveSyncJobRecord)
                    .where(DriveSyncJobRecord.status == "queued")
                    .order_by(
                        DriveSyncJobRecord.created_at_text.asc(),
                        DriveSyncJobRecord.batch_item_index.asc().nulls_last(),
                        DriveSyncJobRecord.id.asc(),
                    )
                    .with_for_update(skip_locked=True)
                    .limit(1)
                )
                if row is None:
                    return None
                row.status = "running"
                row.started_at = row.started_at or now.isoformat()
                row.claimed_at = now
                row.last_heartbeat_at = now
                row.attempt_count = int(row.attempt_count or 0) + 1
                row.last_error = None
                row.version = int(row.version or 0) + 1
                db.flush()
                return SyncJob(**self._job_row_to_dict(row))

    def recover_interrupted_jobs(
        self,
        max_attempts: int = 3,
        retryable_kinds: set[str] | frozenset[str] = frozenset(),
    ) -> tuple[int, int]:
        """Requeue retry-safe interrupted jobs; fail unsafe or exhausted work."""
        now = utcnow()
        recovered = 0
        exhausted = 0
        with self.session_factory() as db:
            with db.begin():
                rows = db.scalars(
                    select(DriveSyncJobRecord)
                    .where(DriveSyncJobRecord.status == "running")
                    .with_for_update()
                ).all()
                for row in rows:
                    attempts = int(row.attempt_count or 0)
                    if row.kind in retryable_kinds and attempts < max_attempts:
                        message = "Interrupted by service restart; queued for retry."
                        row.status = "queued"
                        row.claimed_at = None
                        row.last_heartbeat_at = now
                        row.last_error = message
                        row.error = None
                        row.finished_at = None
                        recovered += 1
                    else:
                        message = (
                            "Interrupted by service restart after maximum attempts."
                            if attempts >= max_attempts
                            else "Interrupted by service restart; this operation cannot be retried safely."
                        )
                        row.status = "error"
                        row.finished_at = now.isoformat()
                        row.last_heartbeat_at = now
                        row.last_error = message
                        row.error = message
                        exhausted += 1
                    row.version = int(row.version or 0) + 1
        return recovered, exhausted

    def requeue_job(self, job_id: str, error: str, max_attempts: int = 3) -> bool:
        now = utcnow()
        with self.session_factory() as db:
            row = db.get(DriveSyncJobRecord, job_id)
            if row is None or row.status not in {"running", "error"} or int(row.attempt_count or 0) >= max_attempts:
                return False
            row.status = "queued"
            row.claimed_at = None
            row.finished_at = None
            row.error = None
            row.last_error = error
            row.last_heartbeat_at = now
            row.version = int(row.version or 0) + 1
            db.commit()
            return True

    def get_jobs_by_ids(self, ids: list[str]) -> list["SyncJob"]:
        from api.models.drive_sync import SyncJob

        if not ids:
            return []
        with self.session_factory() as db:
            rows = db.scalars(select(DriveSyncJobRecord).where(DriveSyncJobRecord.id.in_(ids))).all()
            by_id = {row.id: SyncJob(**self._job_row_to_dict(row)) for row in rows}
            return [by_id[job_id] for job_id in ids if job_id in by_id]

    def list_jobs_filtered(
        self,
        limit: int,
        offset: int,
        statuses: list[str] | None = None,
        kinds: list[str] | None = None,
    ) -> tuple[list["SyncJob"], int, dict[str, int]]:
        from api.models.drive_sync import SyncJob

        filters = []
        if statuses:
            filters.append(DriveSyncJobRecord.status.in_(statuses))
        if kinds:
            filters.append(DriveSyncJobRecord.kind.in_(kinds))
        with self.session_factory() as db:
            query = select(DriveSyncJobRecord)
            count_query = select(func.count()).select_from(DriveSyncJobRecord)
            if filters:
                query = query.where(*filters)
                count_query = count_query.where(*filters)
            rows = db.scalars(
                query.order_by(DriveSyncJobRecord.created_at_text.desc()).offset(offset).limit(limit)
            ).all()
            total = int(db.scalar(count_query) or 0)
            counts = dict(db.execute(
                select(DriveSyncJobRecord.status, func.count())
                .group_by(DriveSyncJobRecord.status)
            ).all())
        metrics = {
            "queued": int(counts.get("queued", 0)),
            "running": int(counts.get("running", 0)),
            "completed": int(counts.get("success", 0)),
            "failed": int(counts.get("error", 0)) + int(counts.get("cancelled", 0)),
        }
        return [SyncJob(**self._job_row_to_dict(row)) for row in rows], total, metrics

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
                self._lock_queue_admission(db)
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
                # The callback mutates these models in place. Keep serialized
                # snapshots so the diff can distinguish changed rows.
                before_data = {
                    job_id: job.model_dump(mode="json")
                    for job_id, job in before.items()
                }

                after = fn(list(before.values()))
                after_ids = {job.id for job in after}
                ids_to_delete = set(before) - after_ids

                if ids_to_delete:
                    db.execute(
                        delete(DriveSyncJobRecord).where(
                            DriveSyncJobRecord.id.in_(ids_to_delete)
                        )
                    )

                # Apply only changed rows while SELECT FOR UPDATE locks are
                # still held. Writing every row after releasing those locks
                # allowed concurrent log updates to restore stale statuses.
                for job in after:
                    serialized = job.model_dump(mode="json")
                    if job.id in before_data and serialized == before_data[job.id]:
                        continue

                    data = _job_to_row_data(job)
                    data["updated_at"] = utcnow()
                    update_data = {k: v for k, v in data.items() if k != "id"}
                    if job.id in before_data:
                        update_data["version"] = DriveSyncJobRecord.version + 1
                    db.execute(
                        insert(DriveSyncJobRecord).values(data).on_conflict_do_update(
                            index_elements=["id"],
                            set_=update_data,
                        )
                    )

        return after

    @staticmethod
    def _history_entry_to_row(entry: "HistoryEntry") -> DriveSyncHistoryRecord:
        data = entry.model_dump()
        return DriveSyncHistoryRecord(
            id=data["id"],
            created_by_user_id=data.get("created_by_user_id") or current_owner(),
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
            "created_by_user_id": row.created_by_user_id,
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
            "created_by_user_id": row.created_by_user_id,
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
            "payload": getattr(row, "payload", None) or {},
            "client_batch_id": getattr(row, "client_batch_id", None),
            "batch_item_index": getattr(row, "batch_item_index", None),
            "attempt_count": getattr(row, "attempt_count", 0) or 0,
            "claimed_at": getattr(row, "claimed_at", None),
            "last_heartbeat_at": getattr(row, "last_heartbeat_at", None),
            "last_error": getattr(row, "last_error", None),
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

    def delete_cover_update_history(self, history_id: str) -> None:
        with self.session_factory() as db:
            db.execute(
                delete(CoverUpdateHistoryRecord).where(CoverUpdateHistoryRecord.id == history_id)
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
            "created_by_user_id": row.created_by_user_id,
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

    def save_banner_update_history(self, entry: dict) -> None:
        data = _banner_history_entry_to_row_data(entry)
        update_data = {k: v for k, v in data.items() if k not in {"id", "created_at"}}
        with self.session_factory() as db:
            db.execute(
                insert(BannerUpdateHistoryRecord).values(data).on_conflict_do_update(
                    index_elements=["id"],
                    set_=update_data,
                )
            )
            db.commit()

    def load_banner_update_histories(self) -> list[dict]:
        with self.session_factory() as db:
            rows = db.scalars(
                select(BannerUpdateHistoryRecord).order_by(BannerUpdateHistoryRecord.last_updated.desc())
            ).all()
            return [self._banner_history_row_to_dict(row) for row in rows]

    def delete_banner_update_history(self, history_id: str) -> None:
        with self.session_factory() as db:
            db.execute(
                delete(BannerUpdateHistoryRecord).where(BannerUpdateHistoryRecord.id == history_id)
            )
            db.commit()

    def get_banner_update_by_folder_id(self, folder_id: str) -> dict | None:
        with self.session_factory() as db:
            row = db.scalar(
                select(BannerUpdateHistoryRecord)
                .where(BannerUpdateHistoryRecord.folder_id == folder_id)
                .order_by(BannerUpdateHistoryRecord.last_updated.desc())
                .limit(1)
            )
            return self._banner_history_row_to_dict(row) if row is not None else None

    def get_banner_update_by_story_id(self, story_id: str) -> dict | None:
        with self.session_factory() as db:
            row = db.scalar(
                select(BannerUpdateHistoryRecord)
                .where(BannerUpdateHistoryRecord.story_id == story_id)
                .order_by(BannerUpdateHistoryRecord.last_updated.desc())
                .limit(1)
            )
            return self._banner_history_row_to_dict(row) if row is not None else None

    @staticmethod
    def _banner_history_row_to_dict(row: BannerUpdateHistoryRecord) -> dict:
        last_updated = row.last_updated or row.updated_at or row.created_at
        display_name = row.display_name or row.story_title or row.folder_name
        return {
            "id": row.id,
            "created_by_user_id": row.created_by_user_id,
            "story_id": row.story_id or None,
            "story_title": row.story_title or display_name,
            "folder_id": row.folder_id,
            "folder_name": row.folder_name,
            "display_name": display_name,
            "banner_file_name": row.banner_file_name,
            "status": _normalize_banner_status(row.status),
            "banner_url": row.banner_url,
            "error": row.error,
            "finished_at": row.finished_at,
            "last_updated": last_updated.isoformat() if last_updated else None,
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        }

    def save_intro_update_history(self, entry: dict) -> None:
        data = _intro_history_entry_to_row_data(entry)
        update_data = {k: v for k, v in data.items() if k not in {"id", "created_at"}}
        with self.session_factory() as db:
            db.execute(
                insert(IntroUpdateHistoryRecord).values(data).on_conflict_do_update(
                    index_elements=["id"],
                    set_=update_data,
                )
            )
            db.commit()

    def load_intro_update_histories(self) -> list[dict]:
        with self.session_factory() as db:
            rows = db.scalars(
                select(IntroUpdateHistoryRecord).order_by(IntroUpdateHistoryRecord.last_updated.desc())
            ).all()
            return [self._intro_history_row_to_dict(row) for row in rows]

    def delete_intro_update_history(self, history_id: str) -> None:
        with self.session_factory() as db:
            db.execute(
                delete(IntroUpdateHistoryRecord).where(IntroUpdateHistoryRecord.id == history_id)
            )
            db.commit()

    def get_intro_update_by_folder_id(self, folder_id: str) -> dict | None:
        with self.session_factory() as db:
            row = db.scalar(
                select(IntroUpdateHistoryRecord)
                .where(IntroUpdateHistoryRecord.folder_id == folder_id)
                .order_by(IntroUpdateHistoryRecord.last_updated.desc())
                .limit(1)
            )
            return self._intro_history_row_to_dict(row) if row is not None else None

    def get_intro_update_by_story_id(self, story_id: str) -> dict | None:
        with self.session_factory() as db:
            row = db.scalar(
                select(IntroUpdateHistoryRecord)
                .where(IntroUpdateHistoryRecord.story_id == story_id)
                .order_by(IntroUpdateHistoryRecord.last_updated.desc())
                .limit(1)
            )
            return self._intro_history_row_to_dict(row) if row is not None else None

    @staticmethod
    def _intro_history_row_to_dict(row: IntroUpdateHistoryRecord) -> dict:
        last_updated = row.last_updated or row.updated_at or row.created_at
        display_name = row.display_name or row.story_title or row.folder_name
        return {
            "id": row.id,
            "created_by_user_id": row.created_by_user_id,
            "story_id": row.story_id or None,
            "story_title": row.story_title or display_name,
            "folder_id": row.folder_id,
            "folder_name": row.folder_name,
            "display_name": display_name,
            "intro_file_name": row.intro_file_name,
            "status": _normalize_intro_status(row.status),
            "intro_url": row.intro_url,
            "error": row.error,
            "finished_at": row.finished_at,
            "last_updated": last_updated.isoformat() if last_updated else None,
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        }
