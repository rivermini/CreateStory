"""Resolve Wattpad URLs to canonical story URLs and titles via scraping."""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Optional

import requests

from utils.proxy import requests_proxies

logger = logging.getLogger(__name__)


@dataclass
class WattpadStoryInfo:
    story_id: str
    story_title: str
    detected_url: str


def resolve_wattpad_url(url: str) -> Optional[WattpadStoryInfo]:
    if "wattpad.com" not in url.lower():
        return None

    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    }

    try:
        resp = requests.get(
            url,
            headers=headers,
            timeout=15,
            allow_redirects=True,
            proxies=requests_proxies("wattpad"),
        )
        final_url = resp.url
    except requests.RequestException as exc:
        logger.warning("Wattpad: request failed for %s: %s", url, exc)
        return None

    if "wattpad.com" not in final_url.lower():
        return None

    story_id = _extract_story_id(final_url)
    if not story_id:
        logger.warning("Wattpad: could not extract story ID from %s", final_url)
        return None

    title = _extract_title(resp.text)

    return WattpadStoryInfo(
        story_id=story_id,
        story_title=title or story_id,
        detected_url=final_url,
    )


def _extract_story_id(url: str) -> Optional[str]:
    match = re.search(r"wattpad\.com/(?:story/)?(\d+)", url)
    if match:
        return match.group(1)
    match = re.search(r"wattpad\.com/(\d+)-", url)
    if match:
        return match.group(1)
    return None


def _extract_title(html: str) -> Optional[str]:
    m = re.search(r'<script[^>]+type="application/ld\+json"[^>]*>(.*?)</script>', html, re.DOTALL)
    if m:
        try:
            import json
            data = json.loads(m.group(1))
            if isinstance(data, dict):
                name = data.get("name") or data.get("headline")
                if name:
                    return name
        except Exception:
            pass

    m = re.search(r'<meta[^>]+property="og:title"[^>]+content="([^"]+)"', html)
    if m:
        return m.group(1)

    m = re.search(r"<title>([^<]+)</title>", html)
    if m:
        title = m.group(1).strip()
        title = re.sub(r"\s*[-|]\s*Wattpad\s*$", "", title, flags=re.IGNORECASE)
        return title

    return None
