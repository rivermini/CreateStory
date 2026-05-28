"""Reusable Wattpad API client with retry and optional proxy support."""

from __future__ import annotations

import logging
import os
import time
from typing import Optional

import requests

logger = logging.getLogger(__name__)

_WATTPAD_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.wattpad.com/",
}


def _get_proxy() -> Optional[str]:
    return os.environ.get("WATTPAD_PROXY_URL") or None


def _build_session(proxy: Optional[str]) -> requests.Session:
    session = requests.Session()
    session.headers.update(_WATTPAD_HEADERS)
    if proxy:
        session.proxies["http"] = proxy
        session.proxies["https"] = proxy
    return session


def _is_retryable_error(exc: Exception) -> bool:
    name = type(exc).__name__
    msg = str(exc).lower()
    retryable_names = {
        "ConnectionResetError", "ConnectionError", "ConnectTimeout",
        "ReadTimeout", "Timeout", "HTTPError",
    }
    if name in retryable_names:
        return True
    if "connection" in msg and ("reset" in msg or "aborted" in msg or "refused" in msg):
        return True
    return False


def get(
    url: str,
    *,
    story_id: Optional[str] = None,
    timeout: int = 20,
    max_attempts: int = 3,
    initial_backoff: float = 1.0,
) -> requests.Response:
    proxy = _get_proxy()
    last_exc: Optional[Exception] = None

    for attempt in range(max_attempts):
        session = _build_session(proxy)
        ctx = f"[wattpad/story={story_id}]" if story_id else "[wattpad]"
        try:
            resp = session.get(url, timeout=timeout)
            if resp.status_code == 200:
                return resp
            if attempt < max_attempts - 1:
                logger.warning("%s API returned HTTP %d on attempt %d/%d — retrying ...", ctx, resp.status_code, attempt + 1, max_attempts)
            else:
                logger.warning("%s API returned HTTP %d after all retries.", ctx, resp.status_code)
                return resp
        except Exception as exc:
            last_exc = exc
            if not _is_retryable_error(exc):
                logger.warning("%s Non-retryable error on attempt %d/%d: %s", ctx, attempt + 1, max_attempts, exc)
                raise
            if attempt < max_attempts - 1:
                backoff = initial_backoff * (2 ** attempt)
                logger.warning("%s Attempt %d/%d failed (%s) — retrying in %.1fs ...", ctx, attempt + 1, max_attempts, exc, backoff)
                time.sleep(backoff)

    raise last_exc if last_exc else RuntimeError("Wattpad API request failed after retries")
