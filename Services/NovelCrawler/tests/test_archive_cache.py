from __future__ import annotations

import json
import sys
import types
import zipfile
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routes.results import router as results_router
from api.services.archive_cache import get_or_build_cached_zip


def test_cached_zip_is_reused_until_an_export_file_changes(tmp_path) -> None:
    source = tmp_path / "story.md"
    source.write_text("chapter one", encoding="utf-8")
    cache_dir = tmp_path / ".archives"

    archive = get_or_build_cached_zip([(source, "Adventure/story.md")], cache_dir, "batch", compression_level=1)
    first_manifest = json.loads((cache_dir / "batch.manifest.json").read_text(encoding="utf-8"))
    first_bytes = archive.read_bytes()

    reused = get_or_build_cached_zip([(source, "Adventure/story.md")], cache_dir, "batch", compression_level=1)

    assert reused == archive
    assert reused.read_bytes() == first_bytes
    assert json.loads((cache_dir / "batch.manifest.json").read_text(encoding="utf-8")) == first_manifest

    source.write_text("chapter one updated", encoding="utf-8")
    rebuilt = get_or_build_cached_zip([(source, "Adventure/story.md")], cache_dir, "batch", compression_level=1)
    second_manifest = json.loads((cache_dir / "batch.manifest.json").read_text(encoding="utf-8"))

    assert second_manifest["signature"] != first_manifest["signature"]
    with zipfile.ZipFile(rebuilt) as zipped:
        assert zipped.read("Adventure/story.md").decode("utf-8") == "chapter one updated"


def test_cached_zip_uses_zip64_and_fast_deflate(tmp_path) -> None:
    first = tmp_path / "one.md"
    second = tmp_path / "info.json"
    first.write_text("story text " * 100, encoding="utf-8")
    second.write_text('{"title":"Story"}', encoding="utf-8")

    archive = get_or_build_cached_zip(
        [(first, "Action/one.md"), (second, "Action/info.json")],
        tmp_path / ".archives",
        "full-export",
        compression_level=1,
    )

    with zipfile.ZipFile(archive) as zipped:
        assert sorted(zipped.namelist()) == ["Action/info.json", "Action/one.md"]


def test_inkitt_cached_archive_supports_http_range(monkeypatch, tmp_path) -> None:
    output_dir = tmp_path / "batch"
    story_dir = output_dir / "Adventure" / "story"
    story_dir.mkdir(parents=True)
    markdown = story_dir / "story.md"
    markdown.write_text("chapter content " * 200, encoding="utf-8")

    class FakeService:
        @staticmethod
        def require_owner(**_kwargs) -> None:
            return None

        @staticmethod
        def get_download_files(_batch_id, run_id=None):
            return SimpleNamespace(output_dir=str(output_dir)), [
                (markdown, "Adventure/story/story.md"),
            ]

    fake_service_module = types.ModuleType("api.services.inkitt_batch_service")
    fake_service_module.get_inkitt_batch_service = lambda: FakeService()
    monkeypatch.setitem(sys.modules, "api.services.inkitt_batch_service", fake_service_module)
    app = FastAPI()
    app.include_router(results_router)
    client = TestClient(app)

    initial = client.get("/api/results/inkitt-batch/abc123ef/download")
    partial = client.get(
        "/api/results/inkitt-batch/abc123ef/download",
        headers={"Range": "bytes=10-29"},
    )

    assert initial.status_code == 200
    assert initial.headers["accept-ranges"] == "bytes"
    assert partial.status_code == 206
    assert partial.headers["content-range"].startswith("bytes 10-29/")
    assert len(partial.content) == 20
