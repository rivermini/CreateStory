"""Credential file upload for Drive Sync — saves to FastAPIServer/data/credentials/.

BedReadDriveSync reads from the same shared location via _SHARED_CREDENTIALS_DIR
in _paths.py, so no mirroring is needed.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import JSONResponse

router = APIRouter(tags=["Drive Sync"])

# Absolute path to FastAPIServer root.
#   credentials.py lives at: FastAPIServer/api/routes/drive_sync/credentials.py
#   __file__.resolve() gives the absolute path at runtime.
#   parents[0]=drive_sync/, [1]=routes/, [2]=api/, [3]=FastAPIServer/, [4]=Services/
# _FASTAPI_CREDS_DIR: 4 chained .parent calls = parents[3] = FastAPIServer/
#   Then / "data" / "credentials" = FastAPIServer/data/credentials
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
_FASTAPI_CREDS_DIR = _PROJECT_ROOT / "data" / "credentials"

# Fixed filename — must match BedReadDriveSync .env: GOOGLE_SERVICE_ACCOUNT_JSON=data/credentials/google-service-account.json
_FIXED_CREDENTIALS_FILENAME = "google-service-account.json"


def _get_creds_dir() -> Path:
    path = _FASTAPI_CREDS_DIR
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

    return JSONResponse(content={
        "success": True,
        "filename": _FIXED_CREDENTIALS_FILENAME,
        "path": f"data/credentials/{_FIXED_CREDENTIALS_FILENAME}",
    })


@router.get("/credentials/exists")
async def check_credentials_exists(filename: str) -> JSONResponse:
    creds_dir = _get_creds_dir()
    # Always check the fixed filename regardless of what was passed
    check_name = _FIXED_CREDENTIALS_FILENAME if filename else _FIXED_CREDENTIALS_FILENAME
    exists = (creds_dir / check_name).is_file()
    return JSONResponse(content={"exists": exists, "filename": check_name})
