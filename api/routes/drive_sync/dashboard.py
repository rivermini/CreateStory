"""Dashboard analytics endpoints for drive sync."""

import asyncio
import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from api.services.drive_service import get_drive_sync_service


logger = logging.getLogger(__name__)

router = APIRouter(tags=["Drive Sync"])


class StoriesNeedingUpdateResponse(BaseModel):
    success: bool
    message: str
    data: Optional[dict] = None


# GET /api/drive-sync/dashboard/stories-needing-update
@router.get("/dashboard/stories-needing-update", response_model=StoriesNeedingUpdateResponse, tags=["Drive Sync"])
async def get_stories_needing_update(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
) -> StoriesNeedingUpdateResponse:
    """
    Fetch stories that users have fully read, proxied from the main BE dashboard API.
    Uses the main BE credentials stored in the drive-sync config.
    Optionally accepts startDate and endDate query params (ISO format: YYYY-MM-DD).
    """
    service = get_drive_sync_service()
    if service.get_config() is None:
        raise HTTPException(
            status_code=400,
            detail="Drive sync not configured. POST /api/drive-sync/config first.",
        )

    try:
        result = await asyncio.to_thread(
            service.get_stories_needing_update,
            start_date=start_date,
            end_date=end_date,
        )
        inner = result.get("data") or {}
        stories = inner.get("data") if isinstance(inner, dict) else inner
        return StoriesNeedingUpdateResponse(
            success=result.get("success", False),
            message=result.get("message", ""),
            data={"data": stories},
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.exception("Failed to fetch stories needing update")
        raise HTTPException(status_code=500, detail="Failed to fetch stories needing update.")
