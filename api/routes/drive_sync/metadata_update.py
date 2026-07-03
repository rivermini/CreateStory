"""Metadata update endpoints for drive sync."""

from __future__ import annotations

import json
import logging
from typing import Any, Optional

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from api.services.drive_service import get_drive_sync_service

logger = logging.getLogger(__name__)


# -------------------------------------------------------------------------
# Pydantic models
# -------------------------------------------------------------------------


class MetadataFieldDifference(BaseModel):
    field: str
    folder_value: Any
    server_value: Any
    file_name: Optional[str] = None


class MetadataServerValues(BaseModel):
    main_category: Optional[str] = None
    sub_categories: list[str] = []
    free_chapters_count: int = 0
    push_title: Optional[str] = None
    push_content: Optional[str] = None
    synopsis: Optional[str] = None
    tags: list[str] = []


class MetadataFolderValues(BaseModel):
    main_category: Optional[str] = None
    sub_category: Optional[str] = None
    free_chapters_count: Optional[int] = None
    push_title: Optional[str] = None
    push_content: Optional[str] = None
    synopsis: Optional[str] = None
    tags: list[str] = []


class MetadataUpdateEntry(BaseModel):
    story_id: Optional[str] = None
    story_title: str
    folder_id: str
    folder_name: str
    server: MetadataServerValues
    folder_values: MetadataFolderValues
    differences: list[MetadataFieldDifference] = []
    status: str


class MetadataCheckAllResponse(BaseModel):
    can_update: list[MetadataUpdateEntry] = []
    all_match: list[MetadataUpdateEntry] = []
    no_server_match: list[MetadataUpdateEntry] = []


class MetadataUpdateRequest(BaseModel):
    differences: list[MetadataFieldDifference]


class MetadataUpdateResponse(BaseModel):
    success: bool
    message: str


class MetadataFieldDetailResponse(BaseModel):
    field: str
    file_name: Optional[str] = None
    folder_value: Any = None
    server_value: Any = None
    is_different: bool = False


# -------------------------------------------------------------------------
# Category ID → name lookup (must stay in sync with _CATEGORY_MAP)
# -------------------------------------------------------------------------

_CATEGORY_ID_TO_NAME: dict[str, str] = {
    "154971fe-7da7-41c4-91ee-b2a9613d6fa0": "Fantasy",
    "2d2614d9-2b25-4d1f-bb0a-fb333193de19": "Werewolf",
    "17c9779b-7107-4b24-a020-df735e1dd6cb": "Romance",
    "1550cd02-d20b-4fc3-9dce-6c8c5ccaba11": "Billionaire",
    "8dabb3e8-3e6c-4b20-9b48-cb7bd028cecf": "LGBTQ+",
}

_CATEGORY_NAME_TO_ID: dict[str, str] = {v.lower(): k for k, v in _CATEGORY_ID_TO_NAME.items()}


def _name_to_category_id(name: str | None) -> str | None:
    if not name:
        return None
    return _CATEGORY_NAME_TO_ID.get(name.strip().lower())


def _extract_missing_tags(error_message: str) -> list[str]:
    """Extract unknown tag names from a main-BE 'Tags do not exist: …' JSON error response."""
    try:
        body = json.loads(error_message)
        msg = body.get("message", "")
    except Exception:
        msg = error_message

    tag_part = str(msg).split("Tags do not exist:", 1)
    if len(tag_part) < 2:
        return []
    raw = tag_part[1].strip().strip('"}').strip()
    return [t.strip() for t in raw.split(",") if t.strip()]


def _build_put_payload(differences: list[dict]) -> dict:
    """Build a single PUT body from a list of field differences."""
    payload: dict[str, Any] = {}

    for diff in differences:
        field = diff.get("field")
        fv = diff.get("folder_value")

        if field == "category":
            main_cat_name = fv.get("main_category") if isinstance(fv, dict) else None
            sub_cat_name = fv.get("sub_category") if isinstance(fv, dict) else None
            main_cat_id = _name_to_category_id(main_cat_name)
            if main_cat_id:
                payload["mainCategoryId"] = main_cat_id
            sub_cat_ids: list[str] = []
            if sub_cat_name:
                sub_id = _name_to_category_id(sub_cat_name)
                if sub_id:
                    sub_cat_ids.append(sub_id)
            if sub_cat_ids:
                payload["subCategoryIds"] = sub_cat_ids

        elif field == "free_chapters_count":
            payload["freeChaptersCount"] = int(fv) if fv is not None else 0

        elif field == "push":
            title = fv.get("title") if isinstance(fv, dict) else None
            content = fv.get("content") if isinstance(fv, dict) else None
            payload["notificationConfig"] = {
                "title": title or "",
                "content": content or "",
            }

        elif field == "synopsis":
            payload["synopsis"] = str(fv) if fv is not None else ""

        elif field == "tags":
            if isinstance(fv, list):
                payload["tags"] = fv

    return payload


# -------------------------------------------------------------------------
# Router
# -------------------------------------------------------------------------

router = APIRouter(prefix="/metadata-update", tags=["Drive Sync"])


@router.get("/check-all", response_model=MetadataCheckAllResponse, tags=["Drive Sync"])
async def check_all() -> MetadataCheckAllResponse:
    """
    Scan all DONE_/EXTENDED_ folders and return metadata comparison for each.
    - can_update: folder has a matching story with at least one different field
    - all_match: folder has a matching story with identical metadata
    - no_server_match: no matching story on the server
    """
    import asyncio

    service = get_drive_sync_service()
    if service.get_config() is None:
        raise HTTPException(status_code=400, detail="Drive sync not configured.")

    try:
        result = await asyncio.to_thread(service.check_extended_folders_for_metadata)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.exception("Metadata check failed")
        raise HTTPException(status_code=500, detail="Metadata check failed.")

    def _make_entry(d: dict) -> MetadataUpdateEntry:
        server_data = d.get("server", {})
        folder_data = d.get("folder_values", {})

        server_model = MetadataServerValues(
            main_category=server_data.get("main_category"),
            sub_categories=server_data.get("sub_categories") or [],
            free_chapters_count=server_data.get("free_chapters_count") or 0,
            push_title=server_data.get("push_title"),
            push_content=server_data.get("push_content"),
            synopsis=server_data.get("synopsis"),
            tags=server_data.get("tags") or [],
        )

        folder_model = MetadataFolderValues(
            main_category=folder_data.get("main_category"),
            sub_category=folder_data.get("sub_category"),
            free_chapters_count=folder_data.get("free_chapters_count"),
            push_title=folder_data.get("push_title"),
            push_content=folder_data.get("push_content"),
            synopsis=folder_data.get("synopsis"),
            tags=folder_data.get("tags") or [],
        )

        diffs = [
            MetadataFieldDifference(
                field=dd.get("field", ""),
                file_name=dd.get("file_name"),
                folder_value=dd.get("folder_value"),
                server_value=dd.get("server_value"),
            )
            for dd in d.get("differences", [])
        ]

        return MetadataUpdateEntry(
            story_id=d.get("story_id"),
            story_title=d.get("story_title", ""),
            folder_id=d.get("folder_id", ""),
            folder_name=d.get("folder_name", ""),
            server=server_model,
            folder_values=folder_model,
            differences=diffs,
            status=d.get("status", "unknown"),
        )

    return MetadataCheckAllResponse(
        can_update=[_make_entry(e) for e in result.get("can_update", [])],
        all_match=[_make_entry(e) for e in result.get("all_match", [])],
        no_server_match=[_make_entry(e) for e in result.get("no_server_match", [])],
    )


@router.post("/update-metadata/{folder_id}/{story_id}", response_model=MetadataUpdateResponse, tags=["Drive Sync"])
async def update_metadata(folder_id: str, story_id: str, body: MetadataUpdateRequest) -> MetadataUpdateResponse:
    """
    PUT story metadata fields to the main BE.
    The body contains the differences to apply; this endpoint resolves them into a
    single PUT request to /api/v1/story/{story_id}.
    If the main BE rejects unknown tags, those tags are stripped and the request is retried.
    """
    service = get_drive_sync_service()
    config = service.get_config()
    if config is None:
        return MetadataUpdateResponse(success=False, message="Drive sync not configured.")

    if not body.differences:
        return MetadataUpdateResponse(success=True, message="No differences to update.")

    requested_fields = [d.field for d in body.differences]
    try:
        payload = service.build_metadata_update_payload_from_folder(folder_id, requested_fields)
    except Exception as exc:
        logger.warning("Failed to build metadata update payload for folder %s: %s", folder_id, exc)
        payload = _build_put_payload([d.model_dump() for d in body.differences])

    if not payload:
        return MetadataUpdateResponse(success=True, message="No differences to update.")

    url = f"{config.main_be_api_base_url.rstrip('/')}/api/v1/story/{story_id}"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {config.main_be_bearer_token}",
        "x-user-id": config.main_be_user_id or "",
    }

    try:
        with service._main_be_client(timeout=120.0) as client:
            resp = client.put(url, content=service._json_body(payload), headers=headers)
            if resp.status_code in (200, 201):
                logger.info("Metadata update success for story %s: %s", story_id, list(payload.keys()))
                return MetadataUpdateResponse(success=True, message=f"Metadata updated: {', '.join(payload.keys())}.")

            if resp.status_code == 400:
                error_body = resp.text[:500]
                if "Tags do not exist:" in error_body or "tags do not exist" in error_body.lower():
                    missing = _extract_missing_tags(error_body)
                    logger.info("Tags not found on main BE for story %s: %s — retrying without tags.", story_id, missing)

                    if "tags" not in payload:
                        return MetadataUpdateResponse(success=False, message=f"HTTP 400: {error_body}")

                    payload = {k: v for k, v in payload.items() if k != "tags"}
                    resp = client.put(url, content=service._json_body(payload), headers=headers)
                    if resp.status_code in (200, 201):
                        logger.info("Metadata update (tags-fallback) success for story %s.", story_id)
                        return MetadataUpdateResponse(
                            success=True,
                            message=f"Metadata updated (tags skipped: {', '.join(missing)}): {', '.join(payload.keys())}.",
                        )
                    return MetadataUpdateResponse(success=False, message=f"HTTP {resp.status_code}: {resp.text[:300]}")

            detail = resp.text[:300]
            logger.warning("Metadata update failed for %s HTTP %d: %s", story_id, resp.status_code, detail)
            return MetadataUpdateResponse(success=False, message=f"HTTP {resp.status_code}: {detail}")
    except httpx.HTTPStatusError as exc:
        logger.warning("Metadata update HTTP error for %s: %s", story_id, exc)
        return MetadataUpdateResponse(success=False, message=f"HTTP error: {exc.response.status_code}")
    except Exception as exc:
        logger.error("Metadata update exception for %s: %s", story_id, exc)
        return MetadataUpdateResponse(success=False, message=str(exc))


@router.get(
    "/difference/{folder_id}/{story_id}/{field}",
    response_model=MetadataFieldDetailResponse,
    tags=["Drive Sync"],
)
async def get_metadata_difference_detail(folder_id: str, story_id: str, field: str) -> MetadataFieldDetailResponse:
    """Load folder/server values for one metadata field on demand."""
    import asyncio

    service = get_drive_sync_service()
    if service.get_config() is None:
        raise HTTPException(status_code=400, detail="Drive sync not configured.")

    try:
        detail = await asyncio.to_thread(
            service.get_metadata_field_difference_detail,
            folder_id,
            story_id,
            field,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.exception("Metadata detail failed")
        raise HTTPException(status_code=500, detail="Metadata detail failed.")

    return MetadataFieldDetailResponse(
        field=detail.get("field", field),
        file_name=detail.get("file_name"),
        folder_value=detail.get("folder_value"),
        server_value=detail.get("server_value"),
        is_different=bool(detail.get("is_different")),
    )


@router.get("/check-updated", response_model=MetadataCheckAllResponse, tags=["Drive Sync"])
async def check_updated() -> MetadataCheckAllResponse:
    """Return empty response for now — history tracking out of scope for v1."""
    return MetadataCheckAllResponse(can_update=[], all_match=[], no_server_match=[])
