from __future__ import annotations

import json

from api.services.jobnib_companion_service import FILENAME, companion_manifest, companion_path


def test_companion_manifest_reports_unavailable_artifact(tmp_path, monkeypatch) -> None:
    missing = tmp_path / FILENAME
    monkeypatch.setenv("JOBNIB_COMPANION_PATH", str(missing))

    manifest = companion_manifest()

    assert companion_path() == missing
    assert manifest["available"] is False
    assert manifest["download_path"].endswith("/windows-x64")


def test_companion_manifest_reads_published_build_metadata(tmp_path, monkeypatch) -> None:
    executable = tmp_path / FILENAME
    executable.write_bytes(b"standalone-companion")
    executable.with_name("manifest.json").write_text(
        json.dumps({"version": "0.2.0", "sha256": "abc123"}),
        encoding="utf-8",
    )
    monkeypatch.setenv("JOBNIB_COMPANION_PATH", str(executable))

    manifest = companion_manifest()

    assert manifest["available"] is True
    assert manifest["filename"] == FILENAME
    assert manifest["version"] == "0.2.0"
    assert manifest["size"] == len(b"standalone-companion")
    assert manifest["sha256"] == "abc123"
