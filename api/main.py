"""FastAPIServer — API Gateway entry point."""

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

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.bootstrap import ensure_bootstrap_admin
from api.db import SessionLocal, init_db
from api.migration import import_existing_shared_state
from api.routes import admin, auth, auto_audio, bedread, crawl, dev, results, settings, sites, drive_sync, tts
from api.routes.drive_sync.config import _DRIVE_SYNC_CONFIG_EXAMPLE
from api.routes.settings import _SETTINGS_EXAMPLE


# CORS allowlist — comma-separated origins, defaulting to localhost dev ports.
_ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get(
        "ALLOWED_ORIGINS", "http://localhost:5173,http://localhost:3000"
    ).split(",")
    if origin.strip()
]


@asynccontextmanager
async def lifespan(app: FastAPI):
    _logger.info("FastAPIServer startup: initializing database...")
    init_db()
    with SessionLocal() as db:
        ensure_bootstrap_admin(db)
        import_existing_shared_state(db, _SETTINGS_EXAMPLE, _DRIVE_SYNC_CONFIG_EXAMPLE)
    # Pre-populate caches on startup so first user requests don't pay cold-start cost.
    _logger.info("FastAPIServer startup: warming caches...")
    from services.orchestrator.auto_audio_service import get_auto_audio_service
    try:
        _ = get_auto_audio_service().get_history()
        _logger.info("FastAPIServer startup: auto_audio history cache warmed.")
    except Exception as exc:
        _logger.warning("FastAPIServer startup: failed to warm auto_audio cache: %s", exc)
    _logger.info("FastAPIServer startup: done.")
    yield


app = FastAPI(
    title="FastAPIServer — API Gateway",
    description=(
        "Single entry point for the CreateStory frontend. "
        "Routes requests to downstream microservices: NovelCrawler (scraping), "
        "BedReadVoices (TTS), AutoAudio (auto-audio orchestration), "
        "and BedReadDriveSync (Drive sync)."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(admin.router)
app.include_router(settings.router)
app.include_router(dev.router)
app.include_router(sites.router)
app.include_router(crawl.router)
app.include_router(results.router)
app.include_router(bedread.router)
app.include_router(drive_sync.router)
app.include_router(tts.router)
app.include_router(auto_audio.router)


@app.get("/", tags=["Health"])
def root() -> dict:
    return {"status": "ok", "service": "FastAPIServer", "version": "1.0.0"}


@app.get("/api", tags=["Health"])
def api_info() -> dict:
    return {
        "title": "FastAPIServer — API Gateway",
        "version": "1.0.0",
        "features": ["crawling", "drive-sync", "tts", "bedread", "auto-audio"],
        "docs_url": "/docs",
        "redoc_url": "/redoc",
        "downstream_services": {
            "NovelCrawler": "http://localhost:8002",
            "BedReadVoices": "http://localhost:8001",
            "AutoAudio": "http://localhost:8004",
            "BedReadDriveSync": "http://localhost:8003",
        },
    }
