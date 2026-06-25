"""Drive sync routes package — composed from submodules."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from api.auth import require_active_user
from api.routes.drive_sync import (
    config,
    dashboard,
    folders,
    history,
    jobs,
    uploadability,
    credentials,
    cover_update,
    metadata_update,
    banner_update,
    intro_update,
    title_update,
)

router = APIRouter(prefix="/api/drive-sync", tags=["Drive Sync"], dependencies=[Depends(require_active_user)])
router.include_router(config.router)
router.include_router(folders.router)
router.include_router(uploadability.router)
router.include_router(history.router)
router.include_router(jobs.router)
router.include_router(dashboard.router)
router.include_router(credentials.router)
router.include_router(cover_update.router)
router.include_router(banner_update.router)
router.include_router(intro_update.router)
router.include_router(metadata_update.router)
router.include_router(title_update.router)
