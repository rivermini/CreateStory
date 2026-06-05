"""BedReadVoices FastAPI application entry point."""

from contextlib import asynccontextmanager
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

from api.db import init_db
from api.routes import tts, bedread, auto_audio


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    try:
        from api.services.bedread_service import get_bedread_service
        get_bedread_service()
    except Exception as exc:
        logger.warning("BedRead job metadata initialization skipped: %s", exc)
    yield


app = FastAPI(
    title="BedReadVoices API",
    description=(
        "TTS + Audio microservice. "
        "Provides Kokoro ONNX GPU-accelerated speech synthesis, voice management, "
        "batch story audio generation, and BedRead story discovery."
    ),
    version="1.0.0",
    lifespan=lifespan,
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


@app.post("/api/dev/reset-state", tags=["Development"])
def reset_runtime_state() -> dict:
    from api.services.bedread_service import get_bedread_service
    from api.services.tts_service import get_tts_service

    get_bedread_service().reset_runtime_state()
    get_tts_service().reset_runtime_state()
    globals_dict = sys.modules["api.routes.bedread"].__dict__
    globals_dict["_stories_cache"] = None
    globals_dict["_stories_cache_time"] = 0.0
    return {"reset": True}
