"""FastAPI application entry point for BedReadDriveSync."""

import logging
import os
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
from api.service_auth import enforce_service_auth


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("BedReadDriveSync startup: initializing database...")
    init_db()
    logger.info("BedReadDriveSync startup: database ready.")
    # Any job still QUEUED/RUNNING at startup is orphaned — its daemon worker
    # thread did not survive the previous process. Mark them ERROR so they don't
    # show as "Running" forever in the UI.
    try:
        from api.services.drive_service import get_drive_sync_service
        service = get_drive_sync_service()
        reconciled = service.reconcile_interrupted_jobs()
        if reconciled:
            logger.warning("BedReadDriveSync startup: reconciled %d interrupted job(s).", reconciled)
        workers = service.start_job_dispatcher()
        logger.info("BedReadDriveSync startup: dispatcher running with %d worker(s).", workers)
    except Exception as exc:
        logger.warning("BedReadDriveSync startup: job reconciliation failed: %s", exc)
    yield
    logger.info("BedReadDriveSync shutdown: closing HTTP clients...")
    try:
        from api.services.drive_service import get_drive_sync_service
        svc = get_drive_sync_service()
        svc.stop_job_dispatcher()
        svc.close_http_clients()
    except Exception as exc:
        logger.warning("BedReadDriveSync shutdown: error closing clients: %s", exc)
    logger.info("BedReadDriveSync shutdown: done.")

app = FastAPI(
    title="BedReadDriveSync",
    description="Google Drive folder sync + Main BE API sync service.",
    version="1.0.0",
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)
app.middleware("http")(enforce_service_auth)

_allow_origins = os.getenv("CORS_ALLOW_ORIGINS", "http://localhost:5173,http://localhost:3000")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in _allow_origins.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(drive_sync_router)


@app.get("/internal/v1/external-api-config", tags=["Internal"])
def external_api_config() -> dict[str, str | None]:
    """Return DriveSync-owned external API config to trusted worker services."""
    from fastapi import HTTPException
    from api.services.drive_service import get_drive_sync_service

    config = get_drive_sync_service().get_config()
    if config is None:
        raise HTTPException(status_code=404, detail="Drive sync is not configured.")
    return {
        "external_api_base_url": config.main_be_api_base_url,
        "external_api_token": config.main_be_bearer_token or "",
        "external_api_user_id": config.main_be_user_id,
    }


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


@app.post("/api/dev/reset-state", tags=["Development"])
def reset_runtime_state() -> dict:
    """Reset runtime state. Only available when DEV_MODE=true."""
    if (
        os.getenv("DEV_MODE", "false").lower() not in ("true", "1")
        or os.getenv("ENVIRONMENT", "development").lower() in ("production", "prod")
    ):
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Not found")
    from api.dev_reset import clear_owned_runtime_data
    from api.services.drive_service import get_drive_sync_service

    service = get_drive_sync_service()
    service.stop_job_dispatcher()
    try:
        service.reset_runtime_state()
        result = clear_owned_runtime_data()
    finally:
        service.start_job_dispatcher()
    return {"reset": True, **result}
