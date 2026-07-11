from pathlib import Path

from api.dev_reset import _clear_directory, clear_owned_runtime_data


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


def test_reset_clears_only_crawl_results_and_preserves_cookies(tmp_path: Path) -> None:
    session = _FakeSession()
    output = tmp_path / "crawl"
    (output / "job-1").mkdir(parents=True)
    (output / "job-1" / "chapter.md").write_text("chapter", encoding="utf-8")
    (output / ".gitkeep").write_text("", encoding="utf-8")

    result = clear_owned_runtime_data(lambda: session, [output], tmp_path)

    assert session.tables == ["crawl_output_files", "crawl_sessions"]
    assert session.committed is True
    assert not (output / "job-1").exists()
    assert (output / ".gitkeep").exists()
    assert result["cleared_tables"] == session.tables
    assert not any("cookies" in table for table in result["cleared_tables"])


def test_reset_refuses_directory_outside_service_root(tmp_path: Path) -> None:
    service_root = tmp_path / "service"
    service_root.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    marker = outside / "keep.txt"
    marker.write_text("keep", encoding="utf-8")

    assert _clear_directory(outside, service_root) == []
    assert marker.exists()
