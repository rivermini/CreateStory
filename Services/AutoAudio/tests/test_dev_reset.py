import os
from pathlib import Path

from fastapi.testclient import TestClient

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("INTERNAL_SERVICE_TOKEN", "ci-service-token")


def test_dev_reset_hidden_when_dev_mode_disabled(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "sqlite:///:memory:")
    monkeypatch.setenv("INTERNAL_SERVICE_TOKEN", "ci-service-token")
    monkeypatch.delenv("DEV_MODE", raising=False)

    from main import app

    response = TestClient(app).post(
        "/api/dev/reset-state",
        headers={"Authorization": "Bearer ci-service-token"},
    )

    assert response.status_code == 404


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


def test_reset_clears_only_auto_audio_owned_data_and_logs(tmp_path: Path):
    from core.dev_reset import clear_owned_runtime_data

    session = _FakeSession()
    logs = tmp_path / "auto_audio_logs"
    logs.mkdir()
    (logs / "sessions.json").write_text("[]", encoding="utf-8")

    result = clear_owned_runtime_data(lambda: session, [logs], tmp_path)

    assert session.tables == [
        "auto_audio_sessions",
        "auto_audio_completed_stories",
        "app_settings",
    ]
    assert session.committed is True
    assert list(logs.iterdir()) == []
    assert result["cleared_tables"] == session.tables
