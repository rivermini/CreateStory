"""Validation for Google Drive / Main-BE id path params.

Drive folder ids and Main-BE story ids are URL-safe tokens (``[A-Za-z0-9_-]``).
Constraining these path params rejects query/URL-injection payloads (quotes,
slashes, spaces) at the boundary — before ``folder_id`` reaches a Drive ``q=``
string or ``story_id`` is interpolated into a Main-BE URL path — returning 422.
"""
import re

from fastapi import HTTPException, Request

_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
_ID_PATH_PARAMS = ("folder_id", "story_id", "subfolder_id")


async def validate_drive_id_path_params(request: Request) -> None:
    """Reject any folder_id/story_id/subfolder_id path param outside the safe
    id charset before it reaches a route handler."""
    for name in _ID_PATH_PARAMS:
        value = request.path_params.get(name)
        if value is not None and not _ID_RE.match(value):
            raise HTTPException(status_code=422, detail=f"Invalid {name}")
