"""Interactive image watermark processing endpoint."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import Response

from api.services.drive_service import get_drive_sync_service


router = APIRouter(tags=["Drive Sync"])
_MAX_IMAGE_BYTES = 25 * 1024 * 1024
_ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp"}


@router.post("/watermark-process")
async def process_watermark_image(file: UploadFile = File(...)) -> Response:
    if file.content_type not in _ALLOWED_TYPES:
        raise HTTPException(status_code=400, detail="Only PNG, JPEG, and WebP images are supported.")
    image_bytes = await file.read(_MAX_IMAGE_BYTES + 1)
    if len(image_bytes) > _MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image exceeds the 25 MB limit.")
    if not image_bytes:
        raise HTTPException(status_code=400, detail="The uploaded image is empty.")
    result = await asyncio.to_thread(
        get_drive_sync_service()._process_watermarks_for_upload,
        image_bytes,
        file.filename or "image",
        "interactive",
    )
    region = ",".join(str(value) for value in result.region) if result.region else ""
    headers = {
        "X-Watermark-Applied": str(result.applied).lower(),
        "X-Watermark-Passes": str(result.applied_passes),
        "X-Watermark-Method": result.method,
        "X-Watermark-Stop-Reason": result.stop_reason,
        "X-Watermark-Needs-Review": str(result.needs_review).lower(),
        "X-Watermark-Processing-Ms": str(result.processing_ms),
        "X-Watermark-Region": region,
        "X-Watermark-Confidence": "" if result.confidence is None else str(result.confidence),
        "Access-Control-Expose-Headers": "X-Watermark-Applied, X-Watermark-Passes, X-Watermark-Method, X-Watermark-Stop-Reason, X-Watermark-Needs-Review, X-Watermark-Processing-Ms, X-Watermark-Region, X-Watermark-Confidence",
    }
    return Response(content=result.image_bytes, media_type=file.content_type, headers=headers)
