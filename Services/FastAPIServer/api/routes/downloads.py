"""Short-lived download tickets."""

from __future__ import annotations

import os
import re
import secrets
import time
from dataclasses import dataclass
from threading import Lock
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

from api.auth import require_active_user
from api.models.db_models import User
from api.proxy import streaming_proxy
from api.service_client import reset_request_identity, set_request_identity

router = APIRouter(tags=["Downloads"])
_TICKET_TTL_SECONDS = 60
_tickets_lock = Lock()
_tickets: dict[str, "DownloadTicket"] = {}

_RESULT_DOWNLOAD = re.compile(
    r"^/api/results/(?:download-all|download-all-combined|download-combined-all|"
    r"goodnovel-batch/[0-9a-f]{8}/download|"
    r"inkitt-batch/[0-9a-f]{8}/download|"
    r"[0-9a-f]{8}/(?:download|download-all))$"
)
_BEDREAD_DOWNLOAD = re.compile(r"^/api/bedread/jobs/[0-9a-f]{8}/(?:download|zip)$")
_TTS_DOWNLOAD = re.compile(r"^/api/tts/jobs/[0-9a-f-]+/audio$")


@dataclass(frozen=True)
class DownloadTicket:
    upstream_url: str
    user_id: str
    role: str
    expires_at: float


class DownloadTicketRequest(BaseModel):
    path: str


class DownloadTicketResponse(BaseModel):
    ticket: str
    download_url: str
    expires_in: int


def _worker_url(path_with_query: str) -> str:
    parsed = urlsplit(path_with_query)
    if parsed.scheme or parsed.netloc or not parsed.path.startswith("/"):
        raise HTTPException(status_code=422, detail="Download path must be a local API path.")

    if _RESULT_DOWNLOAD.fullmatch(parsed.path):
        base = os.getenv("SERVICE_URLS_NovelCrawler", "http://localhost:8002").rstrip("/")
    elif _BEDREAD_DOWNLOAD.fullmatch(parsed.path) or _TTS_DOWNLOAD.fullmatch(parsed.path):
        base = os.getenv("SERVICE_URLS_BedReadVoices", "http://localhost:8001").rstrip("/")
    else:
        raise HTTPException(status_code=422, detail="Path is not an approved download endpoint.")

    suffix = parsed.path
    if parsed.query:
        suffix += f"?{parsed.query}"
    return f"{base}{suffix}"


@router.post("/api/download-ticket", response_model=DownloadTicketResponse)
def create_download_ticket(
    body: DownloadTicketRequest,
    user: User = Depends(require_active_user),
) -> DownloadTicketResponse:
    now = time.monotonic()
    token = secrets.token_urlsafe(32)
    ticket = DownloadTicket(
        upstream_url=_worker_url(body.path),
        user_id=str(user.id),
        role=user.role,
        expires_at=now + _TICKET_TTL_SECONDS,
    )
    with _tickets_lock:
        for existing, value in list(_tickets.items()):
            if value.expires_at <= now:
                _tickets.pop(existing, None)
        _tickets[token] = ticket
    return DownloadTicketResponse(
        ticket=token,
        download_url=f"/api/download/{token}",
        expires_in=_TICKET_TTL_SECONDS,
    )


@router.get("/api/download/{token}", response_model=None)
async def redeem_download_ticket(token: str) -> StreamingResponse | JSONResponse:
    with _tickets_lock:
        ticket = _tickets.get(token, None)  # multi-use within its TTL to support download managers (e.g. IDM)
    if ticket is None or ticket.expires_at <= time.monotonic():
        raise HTTPException(status_code=404, detail="Download ticket is invalid or expired.")

    identity_token = set_request_identity(ticket.user_id, ticket.role)
    try:
        response = await streaming_proxy("GET", ticket.upstream_url, timeout=300.0)
    finally:
        reset_request_identity(identity_token)

    if response.status_code < 400:
        orig_disposition = response.headers.get("content-disposition")
        if orig_disposition:
            if "filename" in orig_disposition:
                if not orig_disposition.strip().lower().startswith("attachment"):
                    response.headers["Content-Disposition"] = orig_disposition.replace("inline", "attachment")
                else:
                    response.headers["Content-Disposition"] = orig_disposition
            else:
                response.headers["Content-Disposition"] = "attachment"
        else:
            response.headers["Content-Disposition"] = "attachment"
    else:
        # Prevent downloading error responses (like 404 or 401) as files
        response.headers.pop("Content-Disposition", None)
        response.headers.pop("content-disposition", None)

    response.headers["Cache-Control"] = "no-store"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response
