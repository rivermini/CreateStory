"""Drive sync routes package — composed from submodules."""

from fastapi import APIRouter, Depends

from api.routes.drive_sync import (
    config,
    credentials,
    folders,
    uploadability,
    history,
    jobs,
    dashboard,
    cover_update,
    metadata_update,
    banner_update,
    intro_update,
    title_update,
)
from api.routes.drive_sync._ids import validate_drive_id_path_params

# Validate every folder_id/story_id/subfolder_id path param under this router
# against the safe id charset (defense-in-depth for the Drive q= escaping in
# _drive_api._q_id and the Main-BE URL interpolation in metadata_update).
router = APIRouter(
    prefix="/api/drive-sync",
    tags=["Drive Sync"],
    dependencies=[Depends(validate_drive_id_path_params)],
)
router.include_router(config.router)
router.include_router(credentials.router)
router.include_router(folders.router)
router.include_router(uploadability.router)
router.include_router(history.router)
router.include_router(jobs.router)
router.include_router(dashboard.router)
router.include_router(cover_update.router)
router.include_router(banner_update.router)
router.include_router(intro_update.router)
router.include_router(metadata_update.router)
router.include_router(title_update.router)
