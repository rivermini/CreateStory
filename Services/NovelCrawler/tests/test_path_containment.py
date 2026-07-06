from __future__ import annotations

from pathlib import Path
from unittest.mock import Mock

import pytest

from api.services.file_service import CrawlPathError, FileService


def _service(root: Path) -> FileService:
    service = FileService.__new__(FileService)
    service._project_root = root
    service._crawl_root = root.resolve()
    service._output_repo = Mock()
    return service


@pytest.mark.parametrize(
    "crawl_id",
    ["../outside", "1234567", "123456789", "GGGGGGGG", "/absolute", "%2e%2e"],
)
def test_rejects_invalid_crawl_ids(tmp_path: Path, crawl_id: str) -> None:
    with pytest.raises(CrawlPathError):
        _service(tmp_path).get_output_dir(crawl_id)


@pytest.mark.parametrize(
    "filename",
    ["../sentinel.txt", "/absolute.txt", r"..\\sentinel.txt", "sub/file.txt", ""],
)
def test_rejects_traversal_and_absolute_files(tmp_path: Path, filename: str) -> None:
    crawl_dir = tmp_path / "deadbeef"
    crawl_dir.mkdir()
    with pytest.raises(CrawlPathError):
        _service(tmp_path).get_output_file("deadbeef", filename)


def test_rejects_symlink_escape(tmp_path: Path) -> None:
    crawl_dir = tmp_path / "deadbeef"
    crawl_dir.mkdir()
    sentinel = tmp_path.parent / "sentinel.txt"
    sentinel.write_text("do not touch", encoding="utf-8")
    link = crawl_dir / "chapter.md"
    try:
        link.symlink_to(sentinel)
    except OSError:
        pytest.skip("Symlink creation is unavailable on this platform.")

    with pytest.raises(CrawlPathError):
        _service(tmp_path).get_output_file("deadbeef", "chapter.md")
    assert sentinel.read_text(encoding="utf-8") == "do not touch"
