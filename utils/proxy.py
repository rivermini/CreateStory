"""Proxy configuration helpers for crawler egress traffic."""

from __future__ import annotations

import os
from typing import Optional


def get_proxy_url(site: str | None = None) -> Optional[str]:
    """Return the configured proxy URL for a site, if any.

    CRAWLER_PROXY_URL is the global setting. Site-specific variables are kept as
    backward-compatible overrides, for example WATTPAD_PROXY_URL.
    """
    if site:
        key = f"{site.upper()}_PROXY_URL"
        value = os.environ.get(key)
        if value:
            return value
    return os.environ.get("CRAWLER_PROXY_URL") or None


def requests_proxies(site: str | None = None) -> dict[str, str] | None:
    proxy = get_proxy_url(site)
    if not proxy:
        return None
    return {"http": proxy, "https": proxy}
