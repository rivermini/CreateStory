"""Drive sync routes package — composed from submodules."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status

from api.auth import get_current_user
from api.models.db_models import User
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

def require_drive_access(
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
) -> User:
    if request.method in {"POST", "PUT", "PATCH", "DELETE"} and current_user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required.")
    return current_user


router = APIRouter(prefix="/api/drive-sync", tags=["Drive Sync"], dependencies=[Depends(require_drive_access)])
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
