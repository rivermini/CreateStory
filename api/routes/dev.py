"""Development maintenance endpoints."""

from __future__ import annotations

from api.service_client import service_async_client

import logging
import os
import shutil
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from api.auth import require_admin
from api.db import get_db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/dev", tags=["Development"])

CONFIRMATION_TEXT = "CLEAR_BACKEND_DATA"
SERVICES_ROOT = Path(__file__).resolve().parents[3]

RUNTIME_TABLES = [
    "refresh_tokens",
    "app_settings",
    "external_credentials",
    "shared_json_documents",
    "crawl_output_files",
    "crawl_sessions",
    "generated_audio_files",
    "bedread_audio_jobs",
    "auto_audio_sessions",
    "auto_audio_completed_stories",
    "drive_sync_history",
    "drive_sync_jobs",
    "drive_sync_status",
]

RUNTIME_DIRECTORIES = [
    SERVICES_ROOT / "NovelCrawler" / "output" / "crawl",
    SERVICES_ROOT / "BedReadVoices" / "output" / "bedread",
    SERVICES_ROOT / "BedReadVoices" / "output" / "tts",
    SERVICES_ROOT / "AutoAudio" / "output" / "auto_audio_logs",
]

LOG_FILES = [
    SERVICES_ROOT / "shared_data" / "logs" / "novel_crawler.log",
    SERVICES_ROOT / "shared_data" / "logs" / "fastapi_gateway.log",
    SERVICES_ROOT / "shared_data" / "logs" / "bedread_voices.log",
    SERVICES_ROOT / "shared_data" / "logs" / "bedread_drive_sync.log",
    SERVICES_ROOT / "shared_data" / "logs" / "auto_audio.log",
]

RUNTIME_INDEX_FILES = [
]

RUNTIME_FILES_TO_DELETE = [
    SERVICES_ROOT / "FastAPIServer" / "data" / "sync_jobs.lock",
    SERVICES_ROOT / "FastAPIServer" / "data" / "sync_jobs.json",
    SERVICES_ROOT / "FastAPIServer" / "data" / "user_settings.json",
    SERVICES_ROOT / "FastAPIServer" / "data" / "drive_sync_config.json",
    SERVICES_ROOT / "FastAPIServer" / "data" / "credentials" / "google-service-account.json",
    SERVICES_ROOT / "NovelCrawler" / "api" / "data" / "crawl_sessions.json",
    SERVICES_ROOT / "BedReadVoices" / "output" / "bedread" / "jobs.json",
    SERVICES_ROOT / "AutoAudio" / "output" / "auto_audio_logs" / "sessions.json",
]

RESET_TARGETS = [
    ("NovelCrawler", "http://localhost:8002"),
    ("BedReadVoices", "http://localhost:8001"),
    ("BedReadDriveSync", "http://localhost:8003"),
    ("AutoAudio", "http://localhost:8004"),
]


class ClearBackendDataRequest(BaseModel):
    confirmation: str = Field(..., description=f"Must be {CONFIRMATION_TEXT!r}.")


class ClearBackendDataResponse(BaseModel):
    cleared_tables: list[str]
    deleted_paths: list[str]
    cleared_logs: list[str]
    reset_files: list[str]
    reset_services: list[str]
    skipped_paths: list[str]


def _assert_inside_services(path: Path) -> Path:
    resolved = path.resolve()
    services_root = SERVICES_ROOT.resolve()
    if services_root != resolved and services_root not in resolved.parents:
        raise ValueError(f"Refusing to touch path outside Services: {resolved}")
    return resolved


def _clear_directory_contents(path: Path) -> tuple[list[str], list[str]]:
    deleted: list[str] = []
    skipped: list[str] = []
    try:
        resolved = _assert_inside_services(path)
    except ValueError as exc:
        logger.warning("Refusing to clear runtime dir %s: %s", path, exc)
        skipped.append(str(path))
        return deleted, skipped
    # Nothing to clear if the directory isn't present. Do NOT create it: in the
    # containerized deployment these constants point at sibling services that
    # live in other containers, so the path is absent and not writable here
    # (creating it raises PermissionError). Those services wipe their own state
    # via /api/dev/reset-state instead.
    if not resolved.exists():
        return deleted, skipped
    if not resolved.is_dir():
        skipped.append(str(resolved))
        return deleted, skipped

    try:
        children = list(resolved.iterdir())
    except OSError as exc:
        logger.warning("Failed to list runtime dir %s: %s", resolved, exc)
        skipped.append(str(resolved))
        return deleted, skipped

    for child in children:
        try:
            child = _assert_inside_services(child)
            if child.name == ".gitkeep":
                continue
            if child.is_dir():
                shutil.rmtree(child)
            else:
                child.unlink()
            deleted.append(str(child))
        except Exception as exc:
            logger.warning("Failed to delete runtime path %s: %s", child, exc)
            skipped.append(str(child))
    return deleted, skipped


async def _reset_worker_services() -> list[str]:
    import httpx

    reset_services: list[str] = []
    urls_raw = os.environ.get("SERVICE_URLS", "{}")
    service_urls: dict[str, str] = {}
    try:
        import json

        loaded = json.loads(urls_raw)
        if isinstance(loaded, dict):
            service_urls = {str(k): str(v) for k, v in loaded.items()}
    except Exception:
        service_urls = {}

    async with service_async_client(timeout=3.0) as client:
        for name, fallback in RESET_TARGETS:
            base = os.environ.get(f"SERVICE_URLS_{name}") or service_urls.get(name) or fallback
            url = f"{base.rstrip('/')}/api/dev/reset-state"
            try:
                resp = await client.post(url)
                if resp.status_code < 400:
                    reset_services.append(name)
                else:
                    logger.warning("Dev reset for %s returned HTTP %s.", name, resp.status_code)
            except Exception as exc:
                logger.warning("Dev reset for %s skipped: %s", name, exc)
    return reset_services


@router.post("/clear-data", response_model=ClearBackendDataResponse)
async def clear_backend_data(
    req: ClearBackendDataRequest,
    db: Annotated[Session, Depends(get_db)],
    _admin=Depends(require_admin),
) -> ClearBackendDataResponse:
    """Clear development runtime state while preserving admin/user accounts.
    Only available when DEV_MODE=true, and never when ENVIRONMENT=production."""
    if os.environ.get("ENVIRONMENT", "development").lower() in ("production", "prod"):
        raise HTTPException(status_code=404, detail="Not found")
    if os.getenv("DEV_MODE", "false").lower() not in ("true", "1"):
        raise HTTPException(status_code=404, detail="Not found")
    if req.confirmation != CONFIRMATION_TEXT:
        raise HTTPException(status_code=400, detail=f"confirmation must be {CONFIRMATION_TEXT!r}.")

    cleared_tables: list[str] = []
    for table in RUNTIME_TABLES:
        db.execute(text(f"DELETE FROM {table}"))
        cleared_tables.append(table)
    db.commit()

    deleted_paths: list[str] = []
    skipped_paths: list[str] = []
    for directory in RUNTIME_DIRECTORIES:
        deleted, skipped = _clear_directory_contents(directory)
        deleted_paths.extend(deleted)
        skipped_paths.extend(skipped)

    reset_files: list[str] = []
    for runtime_file, content in RUNTIME_INDEX_FILES:
        try:
            resolved = _assert_inside_services(runtime_file)
            resolved.parent.mkdir(parents=True, exist_ok=True)
            resolved.write_text(content, encoding="utf-8")
            reset_files.append(str(resolved))
        except Exception as exc:
            logger.warning("Failed to reset runtime file %s: %s", runtime_file, exc)
            skipped_paths.append(str(runtime_file))

    for runtime_file in RUNTIME_FILES_TO_DELETE:
        try:
            resolved = _assert_inside_services(runtime_file)
            if resolved.exists():
                resolved.unlink()
                deleted_paths.append(str(resolved))
        except Exception as exc:
            logger.warning("Failed to delete runtime file %s: %s", runtime_file, exc)
            skipped_paths.append(str(runtime_file))

    cleared_logs: list[str] = []
    for log_file in LOG_FILES:
        try:
            resolved = _assert_inside_services(log_file)
            resolved.parent.mkdir(parents=True, exist_ok=True)
            resolved.write_text("", encoding="utf-8")
            cleared_logs.append(str(resolved))
        except Exception as exc:
            logger.warning("Failed to clear log file %s: %s", log_file, exc)
            skipped_paths.append(str(log_file))

    reset_services = await _reset_worker_services()

    return ClearBackendDataResponse(
        cleared_tables=cleared_tables,
        deleted_paths=deleted_paths,
        cleared_logs=cleared_logs,
        reset_files=reset_files,
        reset_services=reset_services,
        skipped_paths=skipped_paths,
    )
