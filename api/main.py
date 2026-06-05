"""FastAPI application entry point for BedReadDriveSync."""

import logging
import sys
from pathlib import Path
from contextlib import asynccontextmanager

logging.basicConfig(level=logging.INFO, format="%(name)s | %(levelname)s | %(message)s")
logging.getLogger("api.services.drive_service").setLevel(logging.INFO)

logger = logging.getLogger("api.main")

from dotenv import load_dotenv

_project_root = Path(__file__).parent.parent.resolve()
load_dotenv(_project_root / ".env")

if str(_project_root) not in sys.path:
    sys.path.insert(0, str(_project_root))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.db import init_db
from api.routes.drive_sync import router as drive_sync_router
from api.repositories.drive_sync_repository import DriveSyncRepository
from api.services.drive_service._paths import _HISTORY_FILE, _JOBS_FILE, _STATUS_FILE


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("BedReadDriveSync startup: initializing database...")
    init_db()
    DriveSyncRepository().import_existing_files(_HISTORY_FILE, _JOBS_FILE, _STATUS_FILE)
    logger.info("BedReadDriveSync startup: database ready.")
    yield

app = FastAPI(
    title="BedReadDriveSync",
    description="Google Drive folder sync + Main BE API sync service.",
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

app.include_router(drive_sync_router)


@app.get("/", tags=["Health"])
def root() -> dict:
    return {"status": "ok", "service": "BedReadDriveSync", "version": "1.0.0"}


@app.get("/api", tags=["Health"])
def api_info() -> dict:
    return {
        "title": "BedReadDriveSync",
        "version": "1.0.0",
        "features": ["drive-sync"],
        "docs_url": "/docs",
        "redoc_url": "/redoc",
    }
