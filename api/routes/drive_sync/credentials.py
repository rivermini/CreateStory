"""Credential upload for Drive Sync, backed by PostgreSQL."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from api.auth import require_active_user, require_admin
from api.db import get_db
from api.repositories.shared_state import DRIVE_CREDENTIAL_NAME, SharedStateRepository

router = APIRouter(tags=["Drive Sync"])

_FIXED_CREDENTIALS_FILENAME = "google-service-account.json"


@router.post("/credentials/upload")
async def upload_credentials(
    db: Annotated[Session, Depends(get_db)],
    _admin=Depends(require_admin),
    file: UploadFile = File(...),
) -> JSONResponse:
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided.")

    if not file.filename.endswith(".json"):
        raise HTTPException(status_code=400, detail="Only .json files are allowed.")

    try:
        contents = await file.read()
        SharedStateRepository(db).upsert_credential(
            DRIVE_CREDENTIAL_NAME,
            _FIXED_CREDENTIALS_FILENAME,
            contents,
            file.content_type or "application/json",
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to save credentials: {exc}") from exc

    return JSONResponse(content={
        "success": True,
        "filename": _FIXED_CREDENTIALS_FILENAME,
        "path": f"db://external_credentials/{_FIXED_CREDENTIALS_FILENAME}",
    })


@router.get("/credentials/exists")
async def check_credentials_exists(
    filename: str,
    db: Annotated[Session, Depends(get_db)],
    _user=Depends(require_active_user),
) -> JSONResponse:
    stored = SharedStateRepository(db).get_credential(DRIVE_CREDENTIAL_NAME)
    if stored is not None:
        return JSONResponse(content={"exists": True, "filename": _FIXED_CREDENTIALS_FILENAME})
    return JSONResponse(content={"exists": False, "filename": _FIXED_CREDENTIALS_FILENAME})
