"""DB-backed helpers for WebNovel cookies used by the crawler."""

from __future__ import annotations

import json
import re
import time
from typing import Any, Optional

from bs4 import BeautifulSoup


def load_webnovel_cookies() -> tuple[list[dict[str, Any]], Optional[str]]:
    """Return valid WebNovel cookies and their saved User-Agent."""
    try:
        from api.db import SessionLocal
        from api.repositories.webnovel_cookie_repository import WebNovelCookieRepository

        db = SessionLocal()
        try:
            repo = WebNovelCookieRepository(db)
            rows = repo.get_valid()
            user_agent = repo.get_user_agent()
            cookies = [
                {
                    "name": row.name,
                    "value": row.value,
                    "domain": row.domain,
                    "path": row.path,
                }
                for row in rows
            ]
            return cookies, user_agent
        finally:
            db.close()
    except Exception:
        return [], None


def update_webnovel_cookies(raw_input: str, user_agent: str | None = None) -> dict[str, Any]:
    """Parse pasted WebNovel cookies and persist them to the database."""
    cookies = _parse_cookie_input(raw_input)
    if not cookies:
        raise ValueError("No valid WebNovel cookies were found.")

    from api.db import SessionLocal
    from api.repositories.webnovel_cookie_repository import WebNovelCookieRepository

    db = SessionLocal()
    try:
        repo = WebNovelCookieRepository(db)
        count = repo.save_cookies(cookies, user_agent=user_agent)
    finally:
        db.close()

    return {
        "updated": True,
        "cookie_count": count,
        "has_cf_clearance": any(cookie["name"].lower() == "cf_clearance" for cookie in cookies),
        "has_user_agent": bool(user_agent),
    }


def check_webnovel_cookies(story_url: str | None = None) -> dict[str, Any]:
    """Check whether saved WebNovel cookies clear Cloudflare for a page."""
    cookies, user_agent = load_webnovel_cookies()
    cookie_count = len(cookies)
    if cookie_count == 0:
        return _status(False, "missing", "No saved WebNovel cookies found.", 0)
    if not user_agent:
        return _status(
            False,
            "missing_user_agent",
            "WebNovel cookies are saved, but the matching browser User-Agent is missing.",
            cookie_count,
        )

    test_url = _test_url_for_story(story_url)
    try:
        from spiders.webnovel import WebNovelHttpClient, is_cloudflare_challenge

        client = WebNovelHttpClient(cookies=cookies, user_agent=user_agent, load_db_cookies=False)
        response = client.get(test_url)
    except Exception as exc:
        return _status(False, "request_failed", f"Could not test WebNovel cookies: {exc}", cookie_count, test_url)

    html = response.text
    if is_cloudflare_challenge(response.status_code, html):
        return _status(
            False,
            "cloudflare",
            "WebNovel returned a Cloudflare challenge. Refresh cf_clearance and User-Agent in Settings.",
            cookie_count,
            test_url,
        )
    if response.status_code == 404:
        return _status(
            False,
            "not_found",
            "This WebNovel story or chapter was not found (HTTP 404). Please verify the URL.",
            cookie_count,
            test_url,
        )
    if response.status_code != 200:
        return _status(
            False,
            "http_error",
            f"WebNovel returned HTTP {response.status_code} while testing cookies.",
            cookie_count,
            test_url,
        )

    soup = BeautifulSoup(html, "html.parser")
    if soup.select(".cha-words p"):
        word_count = sum(len(p.get_text(" ", strip=True).split()) for p in soup.select(".cha-words p"))
        if word_count >= 80:
            return _status(True, "ok", "Saved WebNovel cookies can read this chapter.", cookie_count, test_url)

    if soup.select("a[href*='/book/'][href*='_']"):
        return _status(True, "ok", "Saved WebNovel cookies can read WebNovel pages.", cookie_count, test_url)

    if story_url:
        return _status(
            None,
            "inconclusive",
            "WebNovel responded, but this page did not expose enough chapter or catalog content to prove the cookies.",
            cookie_count,
            test_url,
        )

    return _status(True, "ok", "Saved WebNovel cookies are present and WebNovel responded.", cookie_count, test_url)


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
    if story_url:
        return story_url
    return "https://www.webnovel.com/"


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
        cookies.append(_normalize_cookie(name, str(value), item))

    return _dedupe_cookies(cookies)


def _parse_cookie_header(header: str) -> list[dict[str, Any]]:
    text = re.sub(r"^\s*cookie\s*:\s*", "", header.strip(), flags=re.IGNORECASE)
    parsed: list[dict[str, Any]] = []
    for part in text.split(";"):
        if "=" not in part:
            continue
        name, value = part.split("=", 1)
        name = name.strip()
        value = value.strip()
        if not name:
            continue
        parsed.append(_normalize_cookie(name, value, {}))
    return _dedupe_cookies(parsed)


def _dedupe_cookies(cookies: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_key: dict[tuple[str, str, str], dict[str, Any]] = {}
    for cookie in cookies:
        key = (cookie["name"], cookie.get("domain", ".webnovel.com"), cookie.get("path", "/"))
        by_key[key] = cookie
    return list(by_key.values())


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


def _normalize_domain(domain: Any) -> str:
    if isinstance(domain, str) and "webnovel.com" in domain.lower():
        return domain.strip()
    return ".webnovel.com"


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
