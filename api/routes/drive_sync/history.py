"""History endpoints for drive sync."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from api.models.drive_sync import (
    HistoryListResponse,
    HistoryAddResponse,
    HistoryUpdateResponse,
    HistoryDeleteResponse,
)
from api.services.drive_service import get_drive_sync_service


router = APIRouter(tags=["Drive Sync"])


# GET /api/drive-sync/history
@router.get("/history", response_model=HistoryListResponse, tags=["Drive Sync"])
async def get_history(limit: int = 200, offset: int = 0) -> HistoryListResponse:
    """Return paginated action history entries, newest first."""
    service = get_drive_sync_service()
    entries, total = service.get_history(limit=limit, offset=offset)
    return HistoryListResponse(entries=entries, total=total, limit=limit, offset=offset)


# POST /api/drive-sync/history
class HistoryAddRequest(BaseModel):
    kind: str
    status: str
    title: str
    subtitle: str
    items: Optional[list[dict]] = None
    error: Optional[str] = None
    id: Optional[str] = None


@router.post("/history", response_model=HistoryAddResponse, tags=["Drive Sync"])
async def add_history(body: HistoryAddRequest) -> HistoryAddResponse:
    """Add a new action history entry."""
    service = get_drive_sync_service()
    entry_id, timestamp = service.add_history_entry(
        kind=body.kind,
        status=body.status,
        title=body.title,
        subtitle=body.subtitle,
        items=body.items,
        error=body.error,
        entry_id=body.id,
    )
    return HistoryAddResponse(id=entry_id, timestamp=timestamp)


# PATCH /api/drive-sync/history/{entry_id}
class HistoryUpdatePatch(BaseModel):
    status: Optional[str] = None
    title: Optional[str] = None
    subtitle: Optional[str] = None
    items: Optional[list[dict]] = None
    error: Optional[str] = None


@router.patch("/history/{entry_id}", response_model=HistoryUpdateResponse, tags=["Drive Sync"])
async def update_history(entry_id: str, body: HistoryUpdatePatch) -> HistoryUpdateResponse:
    """Patch (update) an existing history entry by ID."""
    service = get_drive_sync_service()
    try:
        success = service.update_history_entry(
            entry_id=entry_id,
            status=body.status,
            title=body.title,
            subtitle=body.subtitle,
            items=body.items,
            error=body.error,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if not success:
        raise HTTPException(status_code=404, detail=f"History entry '{entry_id}' not found.")
    return HistoryUpdateResponse(id=entry_id, success=True)


# DELETE /api/drive-sync/history
class HistoryDeleteRequest(BaseModel):
    ids: list[str]


@router.delete("/history", response_model=HistoryDeleteResponse, tags=["Drive Sync"])
async def delete_history(body: HistoryDeleteRequest) -> HistoryDeleteResponse:
    """Delete one or more history entries. Empty ids = clear all."""
    service = get_drive_sync_service()
    if not body.ids:
        service.clear_history()
        return HistoryDeleteResponse(deleted_count=0)
    deleted_count = service.delete_history_entries(body.ids)
    return HistoryDeleteResponse(deleted_count=deleted_count)
