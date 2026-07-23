"""DB-backed helpers for ReadNovelMtl session cookies used by the crawler.

ReadNovelMtl is behind a Cloudflare managed challenge, so the crawler replays a cookie
set (chiefly ``cf_clearance``) minted by FlareSolverr or captured from a real browser,
together with the exact User-Agent that solved the challenge.
"""

from __future__ import annotations

import json
import re
import time
from typing import Any, Optional

import requests

from utils.proxy import requests_proxies


_DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/149.0.0.0 Safari/537.36"
)
_DEFAULT_DOMAIN = ".readnovelmtl.com"


# --------------------------------------------------------------------------- #
# Public API
# --------------------------------------------------------------------------- #

def update_readnovelmtl_cookies(raw_input: str, user_agent: str | None = None) -> dict[str, Any]:
    """Parse pasted cookies and persist them (plus the matching User-Agent) to the DB."""
    cookies = _parse_cookie_input(raw_input)
    if not cookies:
        raise ValueError("No valid ReadNovelMtl cookies were found.")

    has_clearance = any(c["name"] == "cf_clearance" for c in cookies)

    from api.db import SessionLocal
    from api.repositories.readnovelmtl_cookie_repository import ReadNovelMtlCookieRepository

    db = SessionLocal()
    try:
        repo = ReadNovelMtlCookieRepository(db)
        count = repo.save_cookies(cookies, user_agent=(user_agent or "").strip() or None)
    finally:
        db.close()

    return {
        "updated": True,
        "cookie_count": count,
        "has_cf_clearance": has_clearance,
    }


def persist_solved_cookies(raw_cookies: list[dict[str, Any]], user_agent: str | None) -> int:
    """Persist cookies harvested from FlareSolverr (list of cookie dicts) to the DB."""
    parsed: list[dict[str, Any]] = []
    for cookie in raw_cookies or []:
        name = str(cookie.get("name") or "").strip()
        value = cookie.get("value")
        if not name or value is None:
            continue
        parsed.append(_normalize_cookie(name, str(value), cookie))
    parsed = _dedupe_cookies(parsed)
    if not parsed:
        return 0

    from api.db import SessionLocal
    from api.repositories.readnovelmtl_cookie_repository import ReadNovelMtlCookieRepository

    db = SessionLocal()
    try:
        return ReadNovelMtlCookieRepository(db).save_cookies(parsed, user_agent=(user_agent or "").strip() or None)
    finally:
        db.close()


def load_readnovelmtl_cookies() -> tuple[list[dict[str, Any]], Optional[str]]:
    """Return (cookies, user_agent) for the spider. cookies = non-expired rows."""
    from api.db import SessionLocal
    from api.repositories.readnovelmtl_cookie_repository import ReadNovelMtlCookieRepository

    db = SessionLocal()
    try:
        repo = ReadNovelMtlCookieRepository(db)
        rows = repo.get_valid()
        user_agent = repo.get_user_agent()
    finally:
        db.close()

    cookies = [
        {"name": r.name, "value": r.value, "domain": r.domain, "path": r.path}
        for r in rows
    ]
    return cookies, user_agent


def check_readnovelmtl_cookies(story_url: str | None = None) -> dict[str, Any]:
    """Check whether saved ReadNovelMtl cookies can read past the Cloudflare challenge.

    If FlareSolverr is configured, this is self-healing: with no/invalid cookies it
    solves the challenge, persists fresh cookies, and reports success.
    """
    test_url = story_url or "https://readnovelmtl.com/novel"

    cookies, user_agent = load_readnovelmtl_cookies()
    cookie_count = len(cookies)

    if cookie_count == 0:
        solved = _try_flaresolverr(test_url)
        if solved is not None:
            return solved
        return _status(
            False,
            "missing",
            "No saved ReadNovelMtl cookies found. Set FLARESOLVERR_URL to auto-solve, or paste a "
            "cf_clearance cookie in Settings.",
            0,
        )

    session = requests.Session()
    session.headers.update(_headers(user_agent))
    proxies = requests_proxies("readnovelmtl")
    if proxies:
        session.proxies.update(proxies)
    for cookie in cookies:
        session.cookies.set(cookie["name"], cookie["value"], domain=cookie["domain"], path=cookie["path"])

    try:
        response = session.get(test_url, timeout=30)
    except Exception as exc:
        return _status(False, "request_failed", f"Could not test ReadNovelMtl cookies: {exc}", cookie_count, test_url)

    html = response.text
    if _is_cloudflare_challenge(html) or response.status_code in (403, 503):
        solved = _try_flaresolverr(test_url)
        if solved is not None:
            return solved
        return _status(
            False,
            "cloudflare",
            "ReadNovelMtl returned a Cloudflare challenge and the saved cf_clearance is stale. Set "
            "FLARESOLVERR_URL so the crawler can auto-solve in Docker, or paste a fresh cf_clearance "
            "(matching User-Agent) in Settings.",
            cookie_count,
            test_url,
        )

    if response.status_code != 200:
        return _status(False, "http_error", f"ReadNovelMtl returned HTTP {response.status_code}.", cookie_count, test_url)

    return _status(True, "ok", "Saved ReadNovelMtl cookies cleared the Cloudflare challenge.", cookie_count, test_url)


def _try_flaresolverr(test_url: str) -> dict[str, Any] | None:
    """Solve via FlareSolverr, persist the cookies, and return an 'ok' status. None if unavailable."""
    try:
        from api.services.flaresolverr_client import is_configured, solve
    except Exception:
        return None
    if not is_configured():
        return None

    try:
        result = solve(test_url)
    except Exception as exc:
        return _status(False, "flaresolverr_failed", f"FlareSolverr could not solve the challenge: {exc}", 0, test_url)

    if _is_cloudflare_challenge(result.get("html", "")):
        return _status(False, "flaresolverr_failed", "FlareSolverr ran but the challenge did not clear.", 0, test_url)

    count = persist_solved_cookies(result.get("raw_cookies") or [], result.get("user_agent"))
    return _status(
        True,
        "ok",
        f"Solved the Cloudflare challenge via FlareSolverr and saved {count} fresh cookie(s).",
        count,
        test_url,
    )


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #

def _headers(user_agent: str | None) -> dict[str, str]:
    return {
        "User-Agent": user_agent or _DEFAULT_USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://readnovelmtl.com/",
        "Upgrade-Insecure-Requests": "1",
    }


def _status(valid: bool | None, reason: str, message: str, cookie_count: int, tested_url: str | None = None) -> dict[str, Any]:
    return {
        "valid": valid,
        "reason": reason,
        "message": message,
        "cookie_count": cookie_count,
        "tested_url": tested_url,
    }


def _is_cloudflare_challenge(html: str) -> bool:
    head = html[:20000]
    # Positive content markers -> a real ReadNovelMtl page, not a challenge.
    if 'id="content"' in html or "/novel/" in html or "text-secondary" in html:
        return False
    return (
        "Just a moment" in head
        or "Enable JavaScript and cookies to continue" in head
        or "cf_chl" in head
        or "/cdn-cgi/challenge-platform/" in head
        or "Attention Required! | Cloudflare" in head
    )


def _parse_cookie_input(raw_input: str) -> list[dict[str, Any]]:
    text = (raw_input or "").strip()
    if not text:
        raise ValueError("Cookie input is empty.")

    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        cookies = _parse_cookie_header(text)
        if not cookies:
            token = re.sub(r"\s+", "", text)
            if token:
                cookies = [_normalize_cookie("cf_clearance", token, {})]
        return cookies

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
        value = re.sub(r"\s+", "", value.strip())
        if not name:
            continue
        parsed.append(_normalize_cookie(name, value, {}))
    return _dedupe_cookies(parsed)


def _dedupe_cookies(cookies: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_key: dict[tuple[str, str, str], dict[str, Any]] = {}
    for cookie in cookies:
        key = (cookie["name"], cookie.get("domain", _DEFAULT_DOMAIN), cookie.get("path", "/"))
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
    expires = source.get("expiry", source.get("expires", source.get("expirationDate")))
    parsed_expires = _parse_expiry(expires)
    if parsed_expires is not None:
        cookie["expiry"] = parsed_expires
    return cookie


def _normalize_domain(domain: Any) -> str:
    if isinstance(domain, str) and "readnovelmtl.com" in domain.lower():
        return domain.strip()
    return _DEFAULT_DOMAIN


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
