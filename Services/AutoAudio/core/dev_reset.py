"""Development-only cleanup for AutoAudio-owned runtime data."""

from __future__ import annotations

import shutil
from pathlib import Path
from typing import Callable, Iterable

from sqlalchemy import delete

from core.config import _AUTO_AUDIO_LOGS_DIR_NAME, _OUTPUT_BASE_NAME
from core.db import SessionLocal
from core.db_models import AppSetting, AutoAudioCompletedStoriesRecord, AutoAudioSessionRecord


OWNED_RUNTIME_MODELS = (
    AutoAudioSessionRecord,
    AutoAudioCompletedStoriesRecord,
    AppSetting,
)

_PROJECT_ROOT = Path(__file__).parent.parent.resolve()
RUNTIME_DIRECTORIES = (
    _PROJECT_ROOT / _OUTPUT_BASE_NAME / _AUTO_AUDIO_LOGS_DIR_NAME,
)


def _clear_directory(root: Path, containment_root: Path) -> list[str]:
    root = root.resolve()
    containment_root = containment_root.resolve()
    if root != containment_root and containment_root not in root.parents:
        return []
    if not root.exists() or not root.is_dir():
        return []

    deleted: list[str] = []
    for child in root.iterdir():
        if child.name == ".gitkeep":
            continue
        resolved = child.resolve()
        if root not in resolved.parents:
            continue
        if child.is_symlink() or child.is_file():
            child.unlink()
        elif child.is_dir():
            shutil.rmtree(child)
        deleted.append(str(child))
    return deleted


def clear_owned_runtime_data(
    session_factory: Callable = SessionLocal,
    runtime_directories: Iterable[Path] = RUNTIME_DIRECTORIES,
    containment_root: Path = _PROJECT_ROOT,
) -> dict[str, list[str]]:
    """Clear AutoAudio sessions, completed-story sets, settings, and legacy logs."""
    cleared_tables: list[str] = []
    with session_factory() as db:
        for model in OWNED_RUNTIME_MODELS:
            db.execute(delete(model))
            cleared_tables.append(model.__tablename__)
        db.commit()

    deleted_paths: list[str] = []
    for directory in runtime_directories:
        deleted_paths.extend(_clear_directory(Path(directory), containment_root))
    return {"cleared_tables": cleared_tables, "deleted_paths": deleted_paths}
