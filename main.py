"""AutoAudio FastAPI application entry point."""

import logging
import sys
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(name)s | %(levelname)s | %(message)s")
logger = logging.getLogger("api.main")

from dotenv import load_dotenv

_project_root = Path(__file__).parent.parent.resolve()
load_dotenv(_project_root / ".env")

if str(_project_root) not in sys.path:
    sys.path.insert(0, str(_project_root))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes import auto_audio

app = FastAPI(
    title="AutoAudio API",
    description=(
        "Auto-audio orchestration microservice. "
        "Discovers stories with missing audio and auto-generates TTS via BedReadVoices, "
        "then uploads compressed audio back to the main backend."
    ),
    version="1.0.0",
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
