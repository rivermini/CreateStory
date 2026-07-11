"""Private APIs used only by trusted CreateStory services."""

from __future__ import annotations

import os
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, HTTPException

from api.internal_auth import require_internal_service
from api.middleware import get_shared_http_client

router = APIRouter(
    prefix="/internal/v1",
    tags=["Internal"],
    dependencies=[Depends(require_internal_service)],
    include_in_schema=False,
)


@router.get("/bedread/external-api-config")
async def get_bedread_external_api_config(
    client: Annotated[httpx.AsyncClient, Depends(get_shared_http_client)],
) -> dict[str, str | None]:
    drive_url = os.environ.get(
        "SERVICE_URLS_BedReadDriveSync",
        "http://localhost:8003",
    ).rstrip("/")
    try:
        response = await client.get(
            f"{drive_url}/internal/v1/external-api-config",
            timeout=10.0,
        )
        response.raise_for_status()
        config = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(
            status_code=503,
            detail="Drive Sync configuration service is unavailable.",
        ) from exc
    return {
        "external_api_base_url": config.get("external_api_base_url", ""),
        "external_api_token": config.get("external_api_token", ""),
        "external_api_user_id": config.get("external_api_user_id"),
    }
