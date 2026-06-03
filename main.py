"""AutoAudio FastAPI application entry point."""

import logging
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

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes import auto_audio


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Pre-initialize the service at startup to avoid cold-start on first HTTP request.
    # This eagerly loads the history and instantiates downstream clients.
    _logger.info("AutoAudio startup: pre-initializing service...")
    from core.service import get_auto_audio_service
    svc = get_auto_audio_service()
    _ = svc.get_history()  # triggers _session_mgr.load_history()
    _ = svc.get_status()   # triggers downstream calls, warming up httpx connections
    _logger.info("AutoAudio startup: pre-initialization complete.")
    yield


app = FastAPI(
    title="AutoAudio API",
    description=(
        "Auto-audio orchestration microservice. "
        "Discovers stories with missing audio and auto-generates TTS via BedReadVoices, "
        "then uploads compressed audio back to the main backend."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auto_audio.router)


@app.get("/", tags=["Health"])
def root() -> dict:
    return {"status": "ok", "service": "AutoAudio API", "version": "1.0.0"}


@app.get("/api", tags=["Health"])
def api_info() -> dict:
    return {
        "title": "AutoAudio API",
        "version": "1.0.0",
        "features": ["auto-audio-orchestration"],
        "docs_url": "/docs",
        "redoc_url": "/redoc",
        "downstream_services": {
            "BedReadVoices": "http://localhost:8001",
            "BedReadDriveSync": "http://localhost:8003",
        },
    }
