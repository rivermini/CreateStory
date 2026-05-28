"""Drive sync routes package — composed from submodules."""

from __future__ import annotations

from fastapi import APIRouter

from api.routes.drive_sync import config, dashboard, folders, history, jobs, uploadability

router = APIRouter(prefix="/api/drive-sync", tags=["Drive Sync"])
router.include_router(config.router)
router.include_router(folders.router)
router.include_router(uploadability.router)
router.include_router(history.router)
router.include_router(jobs.router)
router.include_router(dashboard.router)
