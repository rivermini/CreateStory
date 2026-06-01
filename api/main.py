"""BedReadVoices FastAPI application entry point."""

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

from api.routes import tts, bedread, auto_audio

app = FastAPI(
    title="BedReadVoices API",
    description=(
        "TTS + Audio microservice. "
        "Provides Kokoro ONNX GPU-accelerated speech synthesis, voice management, "
        "batch story audio generation, and BedRead story discovery."
    ),
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(tts.router)
app.include_router(bedread.router)
app.include_router(auto_audio.router)


@app.get("/", tags=["Health"])
def root() -> dict:
    return {"status": "ok", "service": "BedReadVoices API", "version": "1.0.0"}


@app.get("/api", tags=["Health"])
def api_info() -> dict:
    return {
        "title": "BedReadVoices API",
        "version": "1.0.0",
        "features": ["tts", "bedread"],
        "docs_url": "/docs",
        "redoc_url": "/redoc",
    }
