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
from typing import Any, Optional

import requests


def flaresolverr_url() -> str:
    return os.getenv("FLARESOLVERR_URL", "").strip()


def is_configured() -> bool:
    return bool(flaresolverr_url())


def solve(
    url: str,
    max_timeout_ms: int = 75000,
    cookies: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Ask FlareSolverr to fetch ``url``, solving any Cloudflare challenge.

    Returns ``{"html", "cookies": {name: value}, "raw_cookies": [...], "user_agent"}``.
    Raises RuntimeError on failure or if FlareSolverr is not configured.
    """
    endpoint = flaresolverr_url()
    if not endpoint:
        raise RuntimeError("FLARESOLVERR_URL is not configured.")

    payload: dict[str, Any] = {"cmd": "request.get", "url": url, "maxTimeout": int(max_timeout_ms)}
    if cookies:
        payload["cookies"] = cookies
    resp = requests.post(endpoint, json=payload, timeout=(max_timeout_ms / 1000) + 20)
    resp.raise_for_status()
    data = resp.json()

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
