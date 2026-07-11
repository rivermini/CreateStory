"""Google Drive credential endpoints owned by DriveSync."""

from __future__ import annotations

import json

from fastapi import APIRouter, File, HTTPException, UploadFile

from api.services.drive_service import get_drive_sync_service

router = APIRouter(tags=["Drive Sync"])
_MAX_CREDENTIAL_BYTES = 4 * 1024 * 1024
_FIXED_FILENAME = "google-service-account.json"


@router.post("/credentials/upload")
async def upload_credentials(file: UploadFile = File(...)) -> dict:
    if not file.filename or not file.filename.lower().endswith(".json"):
        raise HTTPException(status_code=400, detail="Only .json files are allowed.")
    content = await file.read(_MAX_CREDENTIAL_BYTES + 1)
    if len(content) > _MAX_CREDENTIAL_BYTES:
        raise HTTPException(status_code=413, detail="Credential file exceeds 4 MiB.")
    try:
        parsed = json.loads(content)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=400, detail="Credential file must contain valid JSON.") from exc
    if not isinstance(parsed, dict):
        raise HTTPException(status_code=400, detail="Credential JSON must be an object.")
    service = get_drive_sync_service()
    service._repo.save_drive_credential(
        _FIXED_FILENAME,
        content,
        file.content_type or "application/json",
    )
    service.invalidate_drive_credentials()
    return {
        "success": True,
        "filename": _FIXED_FILENAME,
        "path": f"db://external_credentials/{_FIXED_FILENAME}",
    }


@router.get("/credentials/exists")
def credentials_exist(filename: str = _FIXED_FILENAME) -> dict:
    exists = get_drive_sync_service()._repo.drive_credential_exists()
    return {"exists": exists, "filename": _FIXED_FILENAME}
