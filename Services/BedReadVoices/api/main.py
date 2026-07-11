"""BedReadVoices FastAPI application entry point."""

from contextlib import asynccontextmanager
import logging
import os
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
from api.routes import tts, bedread
from api.service_auth import enforce_service_auth


def _require_ffmpeg_libopus() -> None:
    import subprocess

    try:
        result = subprocess.run(
            ["ffmpeg", "-version"],
            capture_output=True,
            text=True,
            timeout=10,
        )
    except FileNotFoundError as exc:
        raise RuntimeError(
            "FFmpeg is required for audio processing but was not found."
        ) from exc
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError("FFmpeg version check timed out.") from exc

    output = f"{result.stdout}\n{result.stderr}".lower()
    if result.returncode != 0 or "libopus" not in output:
        raise RuntimeError("FFmpeg with libopus support is required for audio processing.")


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    try:
        from api.services.bedread_service import get_bedread_service
        get_bedread_service()
    except Exception as exc:
        logger.warning("BedRead job metadata initialization skipped: %s", exc)

    _require_ffmpeg_libopus()
    logger.info("FFmpeg libopus support confirmed at startup.")

    yield
    logger.info("BedReadVoices shutdown: closing HTTP clients...")
    try:
        from api.services.bedread_service import get_bedread_service
        get_bedread_service()
    except Exception as exc:
        logger.warning("BedReadVoices shutdown: error closing clients: %s", exc)
    logger.info("BedReadVoices shutdown: done.")


app = FastAPI(
    title="BedReadVoices API",
    description=(
        "TTS + Audio microservice. "
        "Provides Kokoro ONNX GPU-accelerated speech synthesis, voice management, "
        "batch story audio generation, and BedRead story discovery."
    ),
    version="1.0.0",
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)
app.middleware("http")(enforce_service_auth)

ALLOWED_ORIGINS = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "http://localhost:5173,http://localhost:3000").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(tts.router)
app.include_router(bedread.router)


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
    """Reset runtime state. Only available when DEV_MODE=true."""
    if (
        os.getenv("DEV_MODE", "false").lower() not in ("true", "1")
        or os.getenv("ENVIRONMENT", "development").lower() in ("production", "prod")
    ):
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Not found")
    from api.config import reset_external_config_cache
    from api.dev_reset import clear_owned_runtime_data
    from api.services.bedread_service import get_bedread_service
    from api.services.tts_service import _default_concurrency, get_tts_service

    get_bedread_service().reset_runtime_state()
    tts_service = get_tts_service()
    tts_service.reset_runtime_state()
    globals_dict = sys.modules["api.routes.bedread"].__dict__
    globals_dict["_stories_cache"] = None
    globals_dict["_stories_cache_time"] = 0.0
    result = clear_owned_runtime_data()
    reset_external_config_cache()
    tts_service.set_concurrency(_default_concurrency())
    return {"reset": True, **result}
