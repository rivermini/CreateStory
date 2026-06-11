"""Drive sync routes package — composed from submodules."""

from fastapi import APIRouter

from api.routes.drive_sync import config, folders, uploadability, history, jobs, dashboard, cover_update, metadata_update

router = APIRouter(prefix="/api/drive-sync", tags=["Drive Sync"])
router.include_router(config.router)
router.include_router(folders.router)
router.include_router(uploadability.router)
router.include_router(history.router)
router.include_router(jobs.router)
router.include_router(dashboard.router)
router.include_router(cover_update.router)
router.include_router(metadata_update.router)
