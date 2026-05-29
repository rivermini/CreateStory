"""Credential file upload for Drive Sync — saves to FastAPIServer/credentials/ and forwards to BedReadDriveSync."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import JSONResponse

router = APIRouter(tags=["Drive Sync"])

# Absolute path to project root (parent of FastAPIServer/)
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
_FASTAPI_CREDENTIALS_DIR = _PROJECT_ROOT / "FastAPIServer" / "credentials"
_BEDREAD_CREDENTIALS_DIR = _PROJECT_ROOT / "FastAPIServer" / "credentials"

# Fixed filename — must match BedReadDriveSync .env: GOOGLE_SERVICE_ACCOUNT_JSON=credentials/google-service-account.json
_FIXED_CREDENTIALS_FILENAME = "google-service-account.json"


def _get_creds_dir() -> Path:
    path = _FASTAPI_CREDENTIALS_DIR
    path.mkdir(parents=True, exist_ok=True)
    return path


@router.post("/credentials/upload")
async def upload_credentials(file: UploadFile = File(...)) -> JSONResponse:
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided.")

    if not file.filename.endswith(".json"):
        raise HTTPException(status_code=400, detail="Only .json files are allowed.")

    creds_dir = _get_creds_dir()
    dest_path = creds_dir / _FIXED_CREDENTIALS_FILENAME

    try:
        contents = await file.read()
        dest_path.write_bytes(contents)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to write file: {exc}") from exc

    # Mirror to BedReadDriveSync's credentials/ directory if it shares the filesystem
    try:
        _BEDREAD_CREDENTIALS_DIR.mkdir(parents=True, exist_ok=True)
        (_BEDREAD_CREDENTIALS_DIR / _FIXED_CREDENTIALS_FILENAME).write_bytes(contents)
    except Exception:
        pass  # Non-critical — services may not be co-located

    return JSONResponse(content={
        "success": True,
        "filename": _FIXED_CREDENTIALS_FILENAME,
        "path": f"credentials/{_FIXED_CREDENTIALS_FILENAME}",
    })


@router.get("/credentials/exists")
async def check_credentials_exists(filename: str) -> JSONResponse:
    creds_dir = _get_creds_dir()
    # Always check the fixed filename regardless of what was passed
    check_name = _FIXED_CREDENTIALS_FILENAME if filename else _FIXED_CREDENTIALS_FILENAME
    exists = (creds_dir / check_name).is_file()
    return JSONResponse(content={"exists": exists, "filename": check_name})
