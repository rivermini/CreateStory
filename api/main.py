"""FastAPIServer — API Gateway entry point."""

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

from api.routes import auto_audio, bedread, crawl, results, settings, sites, drive_sync, tts

app = FastAPI(
    title="FastAPIServer — API Gateway",
    description=(
        "Single entry point for the CreateStory frontend. "
        "Routes requests to downstream microservices: NovelCrawler (scraping), "
        "BedReadVoices (TTS), and BedReadDriveSync (Drive sync). "
        "Orchestrates the auto-audio workflow."
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

app.include_router(settings.router)
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
            "BedReadDriveSync": "http://localhost:8003",
        },
    }
