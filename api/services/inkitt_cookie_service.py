"""Helpers for updating Inkitt login cookies used by the crawler."""

from __future__ import annotations

import json
import re
import time
import urllib.parse
from pathlib import Path
from typing import Any

import requests
from bs4 import BeautifulSoup

from utils.proxy import requests_proxies


COOKIE_PATH = Path(__file__).resolve().parents[2] / "handlers" / "selenium_cookies_www_inkitt_com.json"

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/136.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.inkitt.com/",
}

_STORY_RE = re.compile(r"/stories/(\d+)")
_CHAPTER_RE = re.compile(r"/stories/(\d+)/chapters/(\d+)")


def update_inkitt_cookies(raw_input: str) -> dict[str, Any]:
    """Parse pasted cookies and save them in Selenium cookie JSON format."""
    cookies = _parse_cookie_input(raw_input)
    if not cookies:
        raise ValueError("No valid Inkitt cookies were found.")

    COOKIE_PATH.parent.mkdir(parents=True, exist_ok=True)
    COOKIE_PATH.write_text(json.dumps(cookies, indent=2), encoding="utf-8")

    return {
        "updated": True,
        "cookie_count": len(cookies),
        "path": str(COOKIE_PATH),
    }


def check_inkitt_cookies(story_url: str | None = None) -> dict[str, Any]:
    """Check whether saved Inkitt cookies can read a likely login-gated page."""
    saved = _load_saved_cookies()
    cookie_count = len(saved)
    if cookie_count == 0:
        return _status(False, "missing", "No saved Inkitt cookies found.", cookie_count)

    session = requests.Session()
    session.headers.update(_HEADERS)
    proxies = requests_proxies("inkitt")
    if proxies:
        session.proxies.update(proxies)

    for cookie in saved:
        name = cookie.get("name")
        value = cookie.get("value")
        if not name or value is None:
            continue
        session.cookies.set(
            name,
            str(value),
            domain=cookie.get("domain") or ".inkitt.com",
            path=cookie.get("path") or "/",
        )

    test_url = _test_url_for_story(story_url) if story_url else "https://www.inkitt.com/"
    try:
        response = session.get(test_url, timeout=30)
    except Exception as exc:
        return _status(
            False,
            "request_failed",
            f"Could not test Inkitt cookies: {exc}",
            cookie_count,
            test_url,
        )

    html = response.text
    if response.status_code != 200:
        return _status(
            False,
            "http_error",
            f"Inkitt returned HTTP {response.status_code} while testing cookies.",
            cookie_count,
            test_url,
        )

    if _is_blocked_response(html):
        return _status(
            False,
            "cloudflare",
            "Inkitt returned a Cloudflare challenge. Refresh cf_clearance in Settings.",
            cookie_count,
            test_url,
        )

    if _is_login_gated_response(html):
        return _status(
            False,
            "login_required",
            "Saved Inkitt cookies are present but not logged in for this story. Refresh user_credentials in Settings.",
            cookie_count,
            test_url,
        )

    if _has_chapter_content(html):
        return _status(
            True,
            "ok",
            "Saved Inkitt cookies can read this story.",
            cookie_count,
            test_url,
        )

    if story_url:
        return _status(
            None,
            "inconclusive",
            "Inkitt responded, but this page did not expose enough chapter text to prove the cookie.",
            cookie_count,
            test_url,
        )

    return _status(True, "ok", "Saved Inkitt cookies are present and Inkitt responded.", cookie_count, test_url)


def _load_saved_cookies() -> list[dict[str, Any]]:
    if not COOKIE_PATH.exists():
        return []
    try:
        raw = json.loads(COOKIE_PATH.read_text(encoding="utf-8"))
    except Exception:
        return []
    if not isinstance(raw, list):
        return []
    return [cookie for cookie in raw if isinstance(cookie, dict) and cookie.get("name") and cookie.get("value") is not None]


def _status(
    valid: bool | None,
    reason: str,
    message: str,
    cookie_count: int,
    tested_url: str | None = None,
) -> dict[str, Any]:
    return {
        "valid": valid,
        "reason": reason,
        "message": message,
        "cookie_count": cookie_count,
        "tested_url": tested_url,
    }


def _test_url_for_story(story_url: str | None) -> str:
    if not story_url:
        return "https://www.inkitt.com/"

    parsed = urllib.parse.urlparse(story_url)
    match = _CHAPTER_RE.search(parsed.path)
    if match:
        return urllib.parse.urlunparse(parsed._replace(query="", fragment=""))

    story_match = _STORY_RE.search(parsed.path)
    if not story_match:
        return story_url

    # Chapter 4 is often where Inkitt asks anonymous users to log in.
    return f"https://www.inkitt.com/stories/{story_match.group(1)}/chapters/4"


def _is_blocked_response(html: str) -> bool:
    head = html[:10000]
    return (
        "Just a moment" in head
        or "Attention Required! | Cloudflare" in head
        or "/cdn-cgi/challenge-platform/" in head
    )


def _is_login_gated_response(html: str) -> bool:
    soup = BeautifulSoup(html, "html.parser")
    article = soup.select_one("article#story-text-container") or soup.select_one("article.default-style")
    if article is None:
        return False

    text = re.sub(r"\s+", " ", article.get_text(" ", strip=True)).strip().lower()
    if not text:
        return False

    login_indicators = [
        "log in to continue reading",
        "login to continue reading",
        "sign up to continue reading",
        "create an account to continue reading",
        "please log in",
        "please login",
    ]
    if any(indicator in text for indicator in login_indicators):
        return True

    return len(text.split()) < 80 and "log" in text and "read" in text


def _has_chapter_content(html: str) -> bool:
    soup = BeautifulSoup(html, "html.parser")
    article = soup.select_one("article#story-text-container") or soup.select_one("article.default-style")
    if article is None:
        return False

    paragraphs = [
        re.sub(r"\s+", " ", paragraph.get_text(" ", strip=True)).strip()
        for paragraph in article.select("p[data-content], p")
    ]
    word_count = sum(len(paragraph.split()) for paragraph in paragraphs if paragraph)
    return word_count >= 80


def _parse_cookie_input(raw_input: str) -> list[dict[str, Any]]:
    text = raw_input.strip()
    if not text:
        raise ValueError("Cookie input is empty.")

    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return _parse_cookie_header(text)

    if isinstance(data, dict):
        if isinstance(data.get("cookies"), list):
            data = data["cookies"]
        elif data.get("name") and "value" in data:
            data = [data]
        else:
            data = [
                {"name": str(name), "value": str(value)}
                for name, value in data.items()
                if isinstance(value, (str, int, float, bool))
            ]

    if not isinstance(data, list):
        raise ValueError("Cookie JSON must be an array, an object with a cookies array, or a name/value map.")

    cookies: list[dict[str, Any]] = []
    for item in data:
        if not isinstance(item, dict):
            continue

        name = str(item.get("name") or "").strip()
        value = item.get("value")
        if not name or value is None:
            continue

        cookie = _normalize_cookie(name, str(value), item)
        cookies.append(cookie)

    return _dedupe_cookies(cookies)


def _parse_cookie_header(header: str) -> list[dict[str, Any]]:
    text = re.sub(r"^\s*cookie\s*:\s*", "", header.strip(), flags=re.IGNORECASE)
    cookies: list[dict[str, Any]] = []
    for part in text.split(";"):
        if "=" not in part:
            continue
        name, value = part.split("=", 1)
        name = name.strip()
        value = _clean_cookie_value(value)
        if not name:
            continue
        cookies.append(_normalize_cookie(name, value, {}))
    return _dedupe_cookies(cookies)


def _normalize_cookie(name: str, value: str, source: dict[str, Any]) -> dict[str, Any]:
    cookie: dict[str, Any] = {
        "name": name,
        "value": value,
        "domain": _normalize_domain(source.get("domain")),
        "path": source.get("path") or "/",
        "secure": True,
    }

    for key in ("secure", "httpOnly", "sameSite"):
        if key in source and source[key] is not None:
            cookie[key] = source[key]

    expires = source.get("expiry", source.get("expires", source.get("expirationDate")))
    parsed_expires = _parse_expiry(expires)
    if parsed_expires is not None:
        cookie["expiry"] = parsed_expires

    return cookie


def _clean_cookie_value(value: str) -> str:
    return re.sub(r"\s+", "", value.strip())


def _normalize_domain(domain: Any) -> str:
    if isinstance(domain, str) and "inkitt.com" in domain.lower():
        return domain.strip()
    return ".inkitt.com"


def _parse_expiry(value: Any) -> int | None:
    if value in (None, "", 0):
        return None
    try:
        expiry = int(float(value))
    except (TypeError, ValueError):
        return None

    if expiry <= int(time.time()):
        return None
    return expiry


def _dedupe_cookies(cookies: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_key: dict[tuple[str, str, str], dict[str, Any]] = {}
    for cookie in cookies:
        key = (
            cookie["name"],
            cookie.get("domain", ".inkitt.com"),
            cookie.get("path", "/"),
        )
        by_key[key] = cookie
    return list(by_key.values())
