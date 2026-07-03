"""Drive sync routes package — composed from submodules."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status

from api.auth import enforce_job_rate, get_current_user
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

# Diagnostic GET endpoints that expose full Drive listings — operator/admin only.
_DRIVE_DEBUG_SUFFIXES = ("/folders/all", "/chapter-breakdown")


def require_drive_access(
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
) -> User:
    is_write = request.method in {"POST", "PUT", "PATCH", "DELETE"}
    is_debug_listing = any(request.url.path.endswith(s) for s in _DRIVE_DEBUG_SUFFIXES)
    if (is_write or is_debug_listing) and current_user.role not in {"operator", "admin"}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Operator or admin role required.")
    if is_write:
        # Rate-limit the Google-API-costly drive-sync writes (L4).
        enforce_job_rate(str(current_user.id))
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
