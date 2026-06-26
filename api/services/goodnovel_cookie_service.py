"""DB-backed helpers for GoodNovel session cookies used by the crawler.

GoodNovel authenticates the web reader with cookies (chiefly a ``TOKEN`` cookie)
scoped to ``.goodnovel.com``. Replaying a logged-in account's cookies lets the
crawler read every chapter that account can access for free — universally-free
chapters plus any the account has unlocked with bonus/earned coins.

Capture cookies from a logged-in browser (DevTools → Application → Cookies, or
copy the request ``Cookie`` header) and paste them into Settings.
"""

from __future__ import annotations

import json
import re
import time
from typing import Any, Optional


def load_goodnovel_cookies() -> tuple[dict[str, str], Optional[str]]:
    """Return ``({name: value}, user_agent)`` for the API client.

    Reads the most recent valid cookie set from the database. Returns an empty
    dict if none are saved (the crawler then runs unauthenticated).
    """
    try:
        from api.db import SessionLocal
        from api.repositories.goodnovel_cookie_repository import GoodNovelCookieRepository

        db = SessionLocal()
        try:
            repo = GoodNovelCookieRepository(db)
            rows = repo.get_valid()
            user_agent = repo.get_user_agent()
            cookies = {r.name: r.value for r in rows if r.name}
            return cookies, user_agent
        finally:
            db.close()
    except Exception:
        return {}, None


def update_goodnovel_cookies(raw_input: str, user_agent: str | None = None) -> dict[str, Any]:
    """Parse pasted cookies and persist them to the database."""
    cookies = _parse_cookie_input(raw_input)
    if not cookies:
        raise ValueError("No valid GoodNovel cookies were found.")

    from api.db import SessionLocal
    from api.repositories.goodnovel_cookie_repository import GoodNovelCookieRepository

    db = SessionLocal()
    try:
        repo = GoodNovelCookieRepository(db)
        count = repo.save_cookies(cookies, user_agent=user_agent)
    finally:
        db.close()

    return {
        "updated": True,
        "cookie_count": count,
        "has_token": any(c["name"].upper() == "TOKEN" for c in cookies),
    }


def check_goodnovel_cookies(story_url: str | None = None) -> dict[str, Any]:
    """Check saved GoodNovel cookies and report how many chapters they unlock.

    When a story URL is supplied, the story is resolved both with and without the
    saved cookies so the response can show how many *extra* chapters the login
    grants — a direct, honest signal that the cookies are working.
    """
    cookies, user_agent = load_goodnovel_cookies()
    cookie_count = len(cookies)
    if cookie_count == 0:
        return _status(False, "missing", "No saved GoodNovel cookies found.", 0)

    if not story_url:
        return _status(
            None,
            "inconclusive",
            "GoodNovel cookies are saved. Provide a story URL to verify how many chapters they unlock.",
            cookie_count,
        )

    try:
        from api.services.goodnovel_api import GoodNovelApiClient

        anon = GoodNovelApiClient(timeout=25, load_db_cookies=False)
        authed = GoodNovelApiClient(timeout=25, cookies=cookies, user_agent=user_agent)
        anon_story = anon.resolve_story(story_url)
        authed_story = authed.resolve_story(story_url)
    except Exception as exc:
        return _status(False, "request_failed", f"Could not verify GoodNovel cookies: {exc}", cookie_count, story_url)

    def readable(refs) -> int:
        return sum(1 for r in refs if not r.charge or r.unlock)

    readable_anon = readable(anon_story.chapters)
    readable_authed = readable(authed_story.chapters)
    total = len(authed_story.chapters)
    extra = max(0, readable_authed - readable_anon)

    if readable_authed > readable_anon:
        return _status(
            True,
            "ok",
            f"Logged in: {readable_authed}/{total} chapters readable "
            f"({extra} more than without cookies).",
            cookie_count,
            story_url,
            readable=readable_authed,
            readable_without_login=readable_anon,
            total=total,
            extra_unlocked=extra,
        )

    return _status(
        None,
        "no_extra",
        f"Cookies are saved but unlock no extra chapters here ({readable_authed}/{total} readable). "
        "The cookies may be logged out/expired, or this account has not unlocked paid chapters.",
        cookie_count,
        story_url,
        readable=readable_authed,
        readable_without_login=readable_anon,
        total=total,
        extra_unlocked=0,
    )


def _status(
    valid: bool | None,
    reason: str,
    message: str,
    cookie_count: int,
    tested_url: str | None = None,
    **extra: Any,
) -> dict[str, Any]:
    payload = {
        "valid": valid,
        "reason": reason,
        "message": message,
        "cookie_count": cookie_count,
        "tested_url": tested_url,
    }
    payload.update(extra)
    return payload


# -- cookie parsing (shared shape with the Inkitt/ScribbleHub cookie services) --

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
        key = (cookie["name"], cookie.get("domain", ".goodnovel.com"), cookie.get("path", "/"))
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
    if isinstance(domain, str) and "goodnovel.com" in domain.lower():
        return domain.strip()
    return ".goodnovel.com"


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
