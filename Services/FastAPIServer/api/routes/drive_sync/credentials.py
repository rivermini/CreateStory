"""Credential upload for Drive Sync, backed by PostgreSQL."""

from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from api.auth import require_active_user, require_operator
from api.db import get_db
from api.middleware import MAX_REQUEST_BODY_BYTES
from api.repositories.shared_state import DRIVE_CREDENTIAL_NAME, SharedStateRepository

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Drive Sync"])

_FIXED_CREDENTIALS_FILENAME = "google-service-account.json"
_UPLOAD_CHUNK_BYTES = 1024 * 1024


@router.post("/credentials/upload")
async def upload_credentials(
    db: Annotated[Session, Depends(get_db)],
    _operator=Depends(require_operator),
    file: UploadFile = File(...),
) -> JSONResponse:
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided.")

    if not file.filename.endswith(".json"):
        raise HTTPException(status_code=400, detail="Only .json files are allowed.")

    # Streamed size cap: read in bounded chunks so a chunked upload without a
    # Content-Length header cannot bypass the gateway body limit (L9).
    contents = b""
    while chunk := await file.read(_UPLOAD_CHUNK_BYTES):
        contents += chunk
        if len(contents) > MAX_REQUEST_BODY_BYTES:
            raise HTTPException(status_code=413, detail="Uploaded file exceeds the size limit.")

    try:
        SharedStateRepository(db).upsert_credential(
            DRIVE_CREDENTIAL_NAME,
            _FIXED_CREDENTIALS_FILENAME,
            contents,
            file.content_type or "application/json",
        )
    except Exception as exc:
        logger.exception("Failed to save Drive credentials")
        raise HTTPException(status_code=500, detail="Failed to save credentials.") from exc

    return JSONResponse(content={
        "success": True,
        "filename": _FIXED_CREDENTIALS_FILENAME,
        "path": f"db://external_credentials/{_FIXED_CREDENTIALS_FILENAME}",
    })


@router.get("/credentials/exists")
def check_credentials_exists(
    filename: str,
    db: Annotated[Session, Depends(get_db)],
    _user=Depends(require_active_user),
) -> JSONResponse:
    stored = SharedStateRepository(db).get_credential(DRIVE_CREDENTIAL_NAME)
    if stored is not None:
        return JSONResponse(content={"exists": True, "filename": _FIXED_CREDENTIALS_FILENAME})
    return JSONResponse(content={"exists": False, "filename": _FIXED_CREDENTIALS_FILENAME})
