"""Credential proxy; Google Drive credentials are owned by DriveSync."""

from __future__ import annotations

from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse

from api.auth import require_active_user, require_operator
from api.middleware import MAX_REQUEST_BODY_BYTES, get_shared_http_client

router = APIRouter(tags=["Drive Sync"])
_UPLOAD_CHUNK_BYTES = 1024 * 1024


def _drive_url() -> str:
    import os

    return os.environ.get("SERVICE_URLS_BedReadDriveSync", "http://localhost:8003").rstrip("/")


@router.post("/credentials/upload")
async def upload_credentials(
    client: Annotated[httpx.AsyncClient, Depends(get_shared_http_client)],
    _operator=Depends(require_operator),
    file: UploadFile = File(...),
) -> JSONResponse:
    if not file.filename or not file.filename.lower().endswith(".json"):
        raise HTTPException(status_code=400, detail="Only .json files are allowed.")
    chunks: list[bytes] = []
    total = 0
    while chunk := await file.read(_UPLOAD_CHUNK_BYTES):
        total += len(chunk)
        if total > MAX_REQUEST_BODY_BYTES:
            raise HTTPException(status_code=413, detail="Uploaded file exceeds the size limit.")
        chunks.append(chunk)
    try:
        response = await client.post(
            f"{_drive_url()}/api/drive-sync/credentials/upload",
            files={
                "file": (
                    file.filename,
                    b"".join(chunks),
                    file.content_type or "application/json",
                )
            },
            timeout=60.0,
        )
    except httpx.RequestError as exc:
        raise HTTPException(status_code=503, detail="Drive Sync service is unavailable.") from exc
    try:
        content = response.json()
    except ValueError:
        content = {"detail": response.text or "Invalid Drive Sync response."}
    return JSONResponse(status_code=response.status_code, content=content)


@router.get("/credentials/exists")
async def check_credentials_exists(
    filename: str,
    client: Annotated[httpx.AsyncClient, Depends(get_shared_http_client)],
    _user=Depends(require_active_user),
) -> JSONResponse:
    try:
        response = await client.get(
            f"{_drive_url()}/api/drive-sync/credentials/exists",
            params={"filename": filename},
            timeout=30.0,
        )
    except httpx.RequestError as exc:
        raise HTTPException(status_code=503, detail="Drive Sync service is unavailable.") from exc
    try:
        content = response.json()
    except ValueError:
        content = {"detail": response.text or "Invalid Drive Sync response."}
    return JSONResponse(status_code=response.status_code, content=content)
