"""Distribution metadata for the standalone Jobnib browser companion."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any


PLATFORM = "windows-x64"
FILENAME = "CreateStory-Jobnib-Companion-win-x64.exe"
DOWNLOAD_PATH = "/api/crawl/jobnib-companion/download/windows-x64"
_PROJECT_ROOT = Path(__file__).resolve().parents[2]
_DEFAULT_PATH = _PROJECT_ROOT / "tools" / "jobnib_browser_assistant" / "dist" / FILENAME


def companion_path() -> Path:
    configured = os.getenv("JOBNIB_COMPANION_PATH", "").strip()
    if not configured:
        return _DEFAULT_PATH
    value = Path(configured).expanduser()
    return (value if value.is_absolute() else _PROJECT_ROOT / value).resolve()


def companion_manifest() -> dict[str, Any]:
    executable = companion_path()
    base: dict[str, Any] = {
        "available": executable.is_file(),
        "platform": PLATFORM,
        "filename": FILENAME,
        "download_path": DOWNLOAD_PATH,
    }
    if not executable.is_file():
        return {
            **base,
            "version": "",
            "size": 0,
            "sha256": "",
            "message": "The server administrator has not published the Windows companion yet.",
        }

    metadata_path = executable.with_name("manifest.json")
    metadata: dict[str, Any] = {}
    if metadata_path.is_file():
        try:
            parsed = json.loads(metadata_path.read_text(encoding="utf-8"))
            if isinstance(parsed, dict):
                metadata = parsed
        except (OSError, ValueError):
            metadata = {}
    return {
        **base,
        "version": str(metadata.get("version") or ""),
        "size": executable.stat().st_size,
        "sha256": str(metadata.get("sha256") or ""),
        "message": "Standalone Windows companion ready.",
    }
