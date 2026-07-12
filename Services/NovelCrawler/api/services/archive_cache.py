"""Persistent, signature-validated ZIP archives for large exports."""

from __future__ import annotations

import hashlib
import json
import os
import threading
import zipfile
from pathlib import Path


_archive_locks_guard = threading.Lock()
_archive_locks: dict[str, threading.Lock] = {}
_archive_build_lock = threading.Lock()


def _archive_lock(path: Path) -> threading.Lock:
    key = str(path.resolve())
    with _archive_locks_guard:
        return _archive_locks.setdefault(key, threading.Lock())


def _files_signature(files: list[tuple[Path, str]]) -> str:
    digest = hashlib.sha256()
    for path, archive_name in sorted(files, key=lambda item: item[1]):
        stat = path.stat()
        digest.update(archive_name.replace("\\", "/").encode("utf-8"))
        digest.update(b"\0")
        digest.update(str(stat.st_size).encode("ascii"))
        digest.update(b":")
        digest.update(str(stat.st_mtime_ns).encode("ascii"))
        digest.update(b"\n")
    return digest.hexdigest()


def get_or_build_cached_zip(
    files: list[tuple[Path, str]],
    cache_dir: Path,
    cache_key: str,
    *,
    compression_level: int = 1,
) -> Path:
    """Return a current cached ZIP, rebuilding it atomically when inputs change."""
    if not files:
        raise FileNotFoundError("No export files were available for the archive.")

    cache_dir.mkdir(parents=True, exist_ok=True)
    safe_key = "".join(character for character in cache_key if character.isalnum() or character in {"-", "_"})
    if not safe_key:
        raise ValueError("Archive cache key is invalid.")
    archive_path = cache_dir / f"{safe_key}.zip"
    manifest_path = cache_dir / f"{safe_key}.manifest.json"

    with _archive_lock(archive_path):
        signature = _files_signature(files)
        if archive_path.is_file() and manifest_path.is_file():
            try:
                manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
                if manifest.get("signature") == signature:
                    return archive_path
            except (OSError, ValueError, TypeError):
                pass

        with _archive_build_lock:
            archive_tmp = archive_path.with_suffix(".zip.tmp")
            manifest_tmp = manifest_path.with_suffix(".json.tmp")
            archive_tmp.unlink(missing_ok=True)
            manifest_tmp.unlink(missing_ok=True)
            try:
                level = max(0, min(int(compression_level), 9))
                with zipfile.ZipFile(
                    archive_tmp,
                    "w",
                    zipfile.ZIP_DEFLATED,
                    allowZip64=True,
                    compresslevel=level,
                ) as archive:
                    for path, archive_name in files:
                        if path.is_file() and not path.is_symlink():
                            archive.write(path, archive_name)
                os.replace(archive_tmp, archive_path)
                manifest_tmp.write_text(
                    json.dumps({"signature": signature, "file_count": len(files)}, indent=2),
                    encoding="utf-8",
                )
                os.replace(manifest_tmp, manifest_path)
                return archive_path
            except Exception:
                archive_tmp.unlink(missing_ok=True)
                manifest_tmp.unlink(missing_ok=True)
                raise
