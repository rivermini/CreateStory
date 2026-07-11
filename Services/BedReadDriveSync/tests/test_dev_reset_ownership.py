import os

os.environ.setdefault("DATABASE_URL", "postgresql+psycopg://test:test@localhost/test")

from api.dev_reset import clear_owned_runtime_data


class _FakeSession:
    def __init__(self) -> None:
        self.tables: list[str] = []
        self.committed = False

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def execute(self, statement):
        self.tables.append(statement.table.name)

    def commit(self) -> None:
        self.committed = True


def test_reset_clears_entire_drive_owned_runtime_domain() -> None:
    session = _FakeSession()

    result = clear_owned_runtime_data(lambda: session)

    assert session.tables == [
        "drive_sync_jobs",
        "drive_sync_history",
        "cover_update_histories",
        "banner_update_histories",
        "intro_update_histories",
        "drive_sync_status",
        "app_settings",
        "external_credentials",
    ]
    assert session.committed is True
    assert result == {"cleared_tables": session.tables, "deleted_paths": []}
