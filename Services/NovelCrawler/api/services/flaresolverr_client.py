"""Thin client for a FlareSolverr instance used to solve Cloudflare challenges.

FlareSolverr runs a headless Chrome and returns the solved page HTML plus the
``cf_clearance`` cookie and the (Linux) User-Agent it used. Because FlareSolverr
runs inside the same Docker network as the crawler, the cookie it mints is bound
to the crawler's own egress IP and Linux network fingerprint, so it can be
replayed with plain ``requests`` from the crawler container — no host proxy and
no manually pasted cookie required.

Enabled by setting ``FLARESOLVERR_URL`` (e.g. ``http://flaresolverr:8191/v1``).
"""

from __future__ import annotations

import os
import threading
import time
from typing import Any, Optional

import requests

# FlareSolverr runs a single headless Chrome, so concurrent solves overload it and it
# returns HTTP 500. Serialize solves process-wide (across all batch crawl workers and
# spiders in this process) so only one challenge is solved at a time.
_SOLVE_LOCK = threading.Lock()


def flaresolverr_url() -> str:
    return os.getenv("FLARESOLVERR_URL", "").strip()


def is_configured() -> bool:
    return bool(flaresolverr_url())


def solve(
    url: str,
    max_timeout_ms: int = 75000,
    cookies: list[dict[str, Any]] | None = None,
    recheck: "Optional[Any]" = None,
) -> dict[str, Any]:
    """Ask FlareSolverr to fetch ``url``, solving any Cloudflare challenge.

    Returns ``{"html", "cookies": {name: value}, "raw_cookies": [...], "user_agent"}``.
    Raises RuntimeError on failure or if FlareSolverr is not configured.

    ``recheck`` is an optional zero-arg callable run UNDER the single-browser solve lock,
    just before a solve. When several crawl workers hit a Cloudflare wall at once they all
    queue here; the first solves and refreshes cf_clearance, and the rest can reload that
    fresh cookie + retry the plain request via ``recheck`` instead of each paying for another
    ~12s solve. If ``recheck`` returns truthy HTML, that is returned with ``reused=True`` and
    no FlareSolverr call is made (prevents a thundering herd of redundant re-solves).
    """
    endpoint = flaresolverr_url()
    if not endpoint:
        raise RuntimeError("FLARESOLVERR_URL is not configured.")

    payload: dict[str, Any] = {"cmd": "request.get", "url": url, "maxTimeout": int(max_timeout_ms)}
    if cookies:
        payload["cookies"] = cookies
    # Only one solve hits FlareSolverr at a time (single browser); retry once on a
    # transient error (e.g. HTTP 500 when the browser was momentarily busy).
    data: dict[str, Any] | None = None
    with _SOLVE_LOCK:
        if recheck is not None:
            try:
                reused_html = recheck()
            except Exception:
                reused_html = None
            if reused_html:
                return {"html": reused_html, "cookies": {}, "raw_cookies": [], "user_agent": "", "status_code": 200, "reused": True}
        last_exc: Exception | None = None
        for attempt in range(2):
            try:
                resp = requests.post(endpoint, json=payload, timeout=(max_timeout_ms / 1000) + 20)
                resp.raise_for_status()
                data = resp.json()
                break
            except Exception as exc:
                last_exc = exc
                if attempt == 0:
                    time.sleep(3)
                    continue
                raise RuntimeError(f"FlareSolverr request failed: {last_exc}") from last_exc
    if data is None:
        raise RuntimeError("FlareSolverr request failed.")

    if data.get("status") != "ok":
        raise RuntimeError(f"FlareSolverr did not solve the challenge: {data.get('message')}")

    solution = data.get("solution") or {}
    raw_cookies = solution.get("cookies") or []
    cookies = {c.get("name"): c.get("value") for c in raw_cookies if c.get("name") and c.get("value") is not None}
    return {
        "html": solution.get("response", "") or "",
        "cookies": cookies,
        "raw_cookies": raw_cookies,
        "user_agent": solution.get("userAgent", "") or "",
        "status_code": solution.get("status"),
    }


def health() -> Optional[str]:
    """Return a short status string if FlareSolverr is reachable, else None."""
    endpoint = flaresolverr_url()
    if not endpoint:
        return None
    base = endpoint.rsplit("/v1", 1)[0] or endpoint
    try:
        resp = requests.get(base, timeout=10)
        if resp.status_code == 200:
            return resp.json().get("msg") or "ok"
    except Exception:
        return None
    return None
