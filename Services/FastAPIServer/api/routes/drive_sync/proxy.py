"""Shared proxy helpers for gateway-to-DriveSync calls."""

from __future__ import annotations

import json
import os
from typing import Any

from fastapi.responses import JSONResponse

from api.proxy import json_proxy


def drive_sync_url() -> str:
    """Return the configured BedReadDriveSync base URL."""
    override = os.environ.get("SERVICE_URLS_BedReadDriveSync")
    if override:
        return override.rstrip("/")

    try:
        service_urls = json.loads(os.environ.get("SERVICE_URLS", "{}"))
        if isinstance(service_urls, dict) and service_urls.get("BedReadDriveSync"):
            return str(service_urls["BedReadDriveSync"]).rstrip("/")
    except Exception:
        pass

    return "http://localhost:8003"


async def drive_get(
    path: str,
    *,
    params: dict[str, Any] | None = None,
    timeout: float = 60.0,
) -> JSONResponse:
    return await json_proxy(
        "GET",
        f"{drive_sync_url()}{path}",
        params=params or {},
        timeout=timeout,
    )


async def drive_post(
    path: str,
    *,
    json_body: Any = None,
    params: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
    timeout: float = 60.0,
) -> JSONResponse:
    return await json_proxy(
        "POST",
        f"{drive_sync_url()}{path}",
        params=params or {},
        json_body=json_body or {},
        headers=headers or {},
        timeout=timeout,
    )


async def drive_put(
    path: str,
    *,
    json_body: Any = None,
    headers: dict[str, str] | None = None,
    timeout: float = 60.0,
) -> JSONResponse:
    return await json_proxy(
        "PUT",
        f"{drive_sync_url()}{path}",
        json_body=json_body or {},
        headers=headers or {},
        timeout=timeout,
    )


async def drive_patch(
    path: str,
    *,
    json_body: Any = None,
    timeout: float = 60.0,
) -> JSONResponse:
    return await json_proxy(
        "PATCH",
        f"{drive_sync_url()}{path}",
        json_body=json_body or {},
        timeout=timeout,
    )


async def drive_delete(path: str, *, timeout: float = 60.0) -> JSONResponse:
    return await json_proxy("DELETE", f"{drive_sync_url()}{path}", timeout=timeout)
