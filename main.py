"""AutoAudio FastAPI application entry point."""

import logging
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(name)s | %(levelname)s | %(message)s")
_logger = logging.getLogger("api.main")

from dotenv import load_dotenv

_project_root = Path(__file__).parent.parent.resolve()
load_dotenv(_project_root / ".env")

if str(_project_root) not in sys.path:
    sys.path.insert(0, str(_project_root))

APP_TITLE = "AutoAudio API"

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes import auto_audio
from core.db import init_db


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Pre-initialize the service at startup to avoid cold-start on first HTTP request.
    # This eagerly loads the history and instantiates downstream clients.
    _logger.info("AutoAudio startup: pre-initializing service...")
    init_db()
    from core.service import get_auto_audio_service
    svc = get_auto_audio_service()
    _ = svc.get_history()  # triggers _session_mgr.load_history()
    _ = svc.get_status()   # triggers downstream calls, warming up httpx connections
    _logger.info("AutoAudio startup: pre-initialization complete.")
    yield
    _logger.info("AutoAudio shutdown: closing HTTP clients...")
    from core.service import get_auto_audio_service
    get_auto_audio_service().close()
    _logger.info("AutoAudio shutdown: removing leftover temp dirs...")
    _cleanup_leftover_temp_dirs()
    _logger.info("AutoAudio shutdown: done.")


def _cleanup_leftover_temp_dirs() -> None:
    """Remove any ``autoaudio_*`` directories left in the system temp dir.

    On a clean shutdown each in-flight batch's ``autoaudio_{batch_id}`` temp
    dir is removed by ``_finish_batch_upload``. A SIGTERM mid-pipeline skips
    that step, so this sweep on lifespan shutdown is the safety net.
    """
    import shutil
    import tempfile
    tmp_root = Path(tempfile.gettempdir())
    if not tmp_root.exists():
        return
    removed = 0
    for entry in tmp_root.iterdir():
        if entry.is_dir() and entry.name.startswith("autoaudio_"):
            try:
                shutil.rmtree(entry)
                removed += 1
            except Exception as exc:
                _logger.warning("Failed to remove leftover temp dir %s: %s", entry, exc)
    if removed:
        _logger.info("Removed %d leftover autoaudio_* temp dir(s) from %s", removed, tmp_root)


app = FastAPI(
    title=APP_TITLE,
    description=(
        "Auto-audio orchestration microservice. "
        "Discovers stories with missing audio and auto-generates TTS via BedReadVoices, "
        "then uploads compressed audio back to the main backend."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

ALLOWED_ORIGINS = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "http://localhost:5173,http://localhost:3000").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auto_audio.router)


@app.get("/", tags=["Health"])
def root() -> dict:
    return {"status": "ok", "service": APP_TITLE, "version": "1.0.0"}


@app.get("/api", tags=["Health"])
def api_info() -> dict:
    return {
        "title": APP_TITLE,
        "version": "1.0.0",
        "features": ["auto-audio-orchestration"],
        "docs_url": "/docs",
        "redoc_url": "/redoc",
        "downstream_services": {
            "BedReadVoices": "http://localhost:8001",
            "BedReadDriveSync": "http://localhost:8003",
        },
    }


@app.post("/api/dev/reset-state", tags=["Development"])
def reset_runtime_state() -> dict:
    from core.service import get_auto_audio_service

    get_auto_audio_service().reset_runtime_state()
    return {"reset": True}
