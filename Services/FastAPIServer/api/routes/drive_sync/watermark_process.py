"""Authenticated gateway proxy for interactive watermark processing."""

from __future__ import annotations

from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response

from api.auth import require_operator
from api.middleware import MAX_REQUEST_BODY_BYTES, get_shared_http_client
from api.routes.drive_sync.credentials import _drive_url


router = APIRouter(tags=["Drive Sync"])
_CHUNK_BYTES = 1024 * 1024


@router.post("/watermark-process")
async def process_watermark_image(
    client: Annotated[httpx.AsyncClient, Depends(get_shared_http_client)],
    _operator=Depends(require_operator),
    file: UploadFile = File(...),
) -> Response:
    chunks: list[bytes] = []
    total = 0
    while chunk := await file.read(_CHUNK_BYTES):
        total += len(chunk)
        if total > min(MAX_REQUEST_BODY_BYTES, 25 * 1024 * 1024):
            raise HTTPException(status_code=413, detail="Image exceeds the 25 MB limit.")
        chunks.append(chunk)
    try:
        downstream = await client.post(
            f"{_drive_url()}/api/drive-sync/watermark-process",
            files={"file": (file.filename or "image", b"".join(chunks), file.content_type)},
            timeout=180.0,
        )
    except httpx.RequestError as exc:
        raise HTTPException(status_code=503, detail="Watermark processor is unavailable.") from exc
    forwarded_headers = {
        name: value
        for name, value in downstream.headers.items()
        if name.lower().startswith("x-watermark-")
    }
    forwarded_headers["Access-Control-Expose-Headers"] = ", ".join(
        sorted(name for name in forwarded_headers if name.lower().startswith("x-watermark-"))
    )
    return Response(
        content=downstream.content,
        status_code=downstream.status_code,
        media_type=downstream.headers.get("content-type", "application/octet-stream"),
        headers=forwarded_headers,
    )
