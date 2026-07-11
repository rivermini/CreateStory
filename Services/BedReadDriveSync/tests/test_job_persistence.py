from types import SimpleNamespace

from api.models.drive_sync import JobStatus, SyncJob
from api.repositories.drive_sync_repository import DriveSyncRepository
from api.services.drive_service.drive_service import DriveSyncService


def _job_row(job_id: str, status: str) -> SimpleNamespace:
    return SimpleNamespace(
        id=job_id,
        created_by_user_id="test-user",
        kind="upload_single",
        status=status,
        folder_id=f"folder-{job_id}",
        folder_name=f"DONE_{job_id}",
        display_name=job_id,
        created_at_text="2026-07-10T00:00:00+00:00",
        started_at=None,
        finished_at=None,
        result_message=None,
        chapters_added=0,
        chapters_skipped=0,
        error=None,
        logs=[],
        main_be_api_base_url=None,
        chapters_count=None,
    )


class _ScalarResult:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows


class _FakeSession:
    def __init__(self, rows):
        self.rows = rows
        self.in_transaction = False
        self.execute_transaction_states: list[bool] = []

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def begin(self):
        session = self

        class _Transaction:
            def __enter__(self):
                session.in_transaction = True

            def __exit__(self, *_args):
                session.in_transaction = False
                return False

        return _Transaction()

    def scalars(self, _statement):
        return _ScalarResult(self.rows)

    def execute(self, _statement):
        self.execute_transaction_states.append(self.in_transaction)
        return SimpleNamespace(rowcount=1)


class _RetentionQuery:
    def __init__(self, total: int, terminal_ids: list[str]) -> None:
        self.total = total
        self.terminal_ids = terminal_ids

    def count(self) -> int:
        return self.total

    def filter(self, *_args):
        return self

    def order_by(self, *_args):
        return self

    def limit(self, _value: int):
        return self

    def all(self):
        return [(job_id,) for job_id in self.terminal_ids]


class _RetentionSession:
    def __init__(self, total: int, terminal_ids: list[str]) -> None:
        self.query_result = _RetentionQuery(total, terminal_ids)
        self.deleted_ids: list[str] = []

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def query(self, *_args):
        return self.query_result

    def execute(self, statement):
        self.deleted_ids.extend(statement.compile().params["id_1"])
        return SimpleNamespace(rowcount=len(self.deleted_ids))

    def commit(self) -> None:
        return None


def test_job_mutation_writes_only_changed_row_before_releasing_lock():
    session = _FakeSession([
        _job_row("job-a", JobStatus.QUEUED),
        _job_row("job-b", JobStatus.RUNNING),
    ])
    repo = DriveSyncRepository(session_factory=lambda: session)

    def mark_a_success(jobs: list[SyncJob]) -> list[SyncJob]:
        next(job for job in jobs if job.id == "job-a").status = JobStatus.SUCCESS
        return jobs

    result = repo.with_jobs_lock(mark_a_success)

    assert next(job for job in result if job.id == "job-a").status == JobStatus.SUCCESS
    assert next(job for job in result if job.id == "job-b").status == JobStatus.RUNNING
    assert session.execute_transaction_states == [True]


def test_history_retention_deletes_only_terminal_jobs():
    session = _RetentionSession(503, ["success-old", "error-old", "cancelled-old"])
    repo = DriveSyncRepository(session_factory=lambda: session)

    repo._enforce_jobs_limit(500)

    assert session.deleted_ids == ["success-old", "error-old", "cancelled-old"]


def test_history_retention_never_deletes_active_jobs_when_no_terminal_rows_exist():
    session = _RetentionSession(503, [])
    repo = DriveSyncRepository(session_factory=lambda: session)

    repo._enforce_jobs_limit(500)

    assert session.deleted_ids == []


def test_upload_worker_marks_unexpected_processing_exception_as_error():
    service = DriveSyncService.__new__(DriveSyncService)
    job = SyncJob(
        id="job-a",
        kind="upload_single",
        status=JobStatus.QUEUED,
        folder_id="folder-a",
        folder_name="DONE_story",
        display_name="Story",
        created_at="2026-07-10T00:00:00+00:00",
    )
    service._config = SimpleNamespace(main_be_api_base_url="https://example.test")
    service.get_job = lambda _job_id: job
    updates: list[dict] = []
    logs: list[tuple[str, str]] = []
    service.update_job = lambda _job_id, **kwargs: updates.append(kwargs) or True
    service.append_job_log = lambda _job_id, level, message: logs.append((level, message))
    service._build_drive_service = lambda: SimpleNamespace(
        files=lambda: SimpleNamespace(
            get=lambda **_kwargs: SimpleNamespace(
                execute=lambda: {"id": "folder-a", "name": "DONE_story"}
            )
        )
    )
    service._retry_drive_call = lambda call: call()
    service._process_story_folder_with_job = lambda *_args: (_ for _ in ()).throw(RuntimeError("boom"))

    service.sync_folder_as_job("job-a")

    assert updates[-1]["status"] == JobStatus.ERROR
    assert updates[-1]["finished_at"] is not None
    assert "boom" in updates[-1]["error"]
    assert logs[-1][0] == "error"
