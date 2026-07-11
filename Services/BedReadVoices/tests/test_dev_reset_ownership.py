import os
from pathlib import Path

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


def test_reset_clears_only_voice_runtime_data_and_output(tmp_path: Path) -> None:
    session = _FakeSession()
    bedread = tmp_path / "bedread"
    tts = tmp_path / "tts"
    (bedread / "batch-1").mkdir(parents=True)
    (bedread / "batch-1" / "story.zip").write_bytes(b"zip")
    tts.mkdir()
    (tts / "audio.wav").write_bytes(b"wav")

    result = clear_owned_runtime_data(lambda: session, [bedread, tts], tmp_path)

    assert session.tables == [
        "generated_audio_files",
        "bedread_audio_jobs",
        "app_settings",
    ]
    assert session.committed is True
    assert list(bedread.iterdir()) == []
    assert list(tts.iterdir()) == []
    assert result["cleared_tables"] == session.tables
