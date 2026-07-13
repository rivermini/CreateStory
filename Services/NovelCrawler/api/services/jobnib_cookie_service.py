"""Persist and validate Jobnib cookies captured from an operator browser."""

from __future__ import annotations

import json
import re
import time
import urllib.parse
from typing import Any

import requests

from utils.proxy import requests_proxies

DEFAULT_JOBNIB_URL = "https://jobnib.com/book"
DEFAULT_JOBNIB_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/149.0.0.0 Safari/537.36"
)


def update_jobnib_cookies(raw_input: str, user_agent: str | None = None) -> dict[str, Any]:
    _reject_explicitly_unverified_collector(raw_input)
    cookies = parse_jobnib_cookie_input(raw_input)
    if not cookies:
        raise ValueError("No valid Jobnib cookies were found.")
    from api.db import SessionLocal
    from api.repositories.jobnib_cookie_repository import JobnibCookieRepository

    db = SessionLocal()
    try:
        count = JobnibCookieRepository(db).save_cookies(cookies, (user_agent or "").strip() or None)
    finally:
        db.close()
    return {
        "updated": True,
        "cookie_count": count,
        "has_cf_clearance": any(cookie["name"].lower() == "cf_clearance" for cookie in cookies),
    }


def _reject_explicitly_unverified_collector(raw_input: str) -> None:
    try:
        payload = json.loads((raw_input or "").strip())
    except (json.JSONDecodeError, TypeError):
        return
    if isinstance(payload, dict) and payload.get("reader_verified") is False:
        state = payload.get("reader_state") if isinstance(payload.get("reader_state"), dict) else {}
        unlocked = int(state.get("unlocked_segments") or 0)
        raise ValueError(
            f"This Jobnib collector file is not verified ({unlocked}/2 chapter segments unlocked). "
            "Open both chapter parts in the collector Chrome window and collect again."
        )


def load_jobnib_cookies() -> tuple[list[dict[str, Any]], str | None]:
    try:
        from api.db import SessionLocal
        from api.repositories.jobnib_cookie_repository import JobnibCookieRepository

        db = SessionLocal()
        try:
            repo = JobnibCookieRepository(db)
            rows = repo.get_valid()
            user_agent = repo.get_user_agent()
        finally:
            db.close()
        return [
            {"name": row.name, "value": row.value, "domain": row.domain, "path": row.path}
            for row in rows
        ], user_agent
    except Exception:
        return [], None


def persist_jobnib_cookies(cookies: list[dict[str, Any]], user_agent: str | None = None) -> int:
    parsed = []
    for item in cookies or []:
        if not isinstance(item, dict) or not item.get("name") or item.get("value") is None:
            continue
        parsed.append(_normalize_cookie(str(item["name"]), str(item["value"]), item))
    parsed = _dedupe(parsed)
    if not parsed:
        return 0
    from api.db import SessionLocal
    from api.repositories.jobnib_cookie_repository import JobnibCookieRepository

    db = SessionLocal()
    try:
        return JobnibCookieRepository(db).save_cookies(parsed, (user_agent or "").strip() or None)
    finally:
        db.close()


def check_jobnib_cookies(story_url: str | None = None) -> dict[str, Any]:
    test_url = normalize_jobnib_url(story_url or DEFAULT_JOBNIB_URL)
    cookies, user_agent = load_jobnib_cookies()
    if not cookies:
        return _status(False, "missing", "No saved Jobnib cookies found.", 0, test_url)

    session = requests.Session()
    session.headers.update(jobnib_headers(user_agent))
    proxies = requests_proxies("jobnib")
    if proxies:
        session.proxies.update(proxies)
    for cookie in cookies:
        session.cookies.set(cookie["name"], cookie["value"], domain=cookie["domain"], path=cookie["path"])
    try:
        response = session.get(test_url, timeout=30)
    except Exception as exc:
        return _status(False, "request_failed", f"Could not test Jobnib cookies: {exc}", len(cookies), test_url)
    if response.status_code in {403, 503} or is_jobnib_challenge(response.text):
        return _status(
            False,
            "cloudflare",
            "Jobnib still returned a Cloudflare challenge. Refresh cookies from the same VPN/IP and User-Agent.",
            len(cookies),
            test_url,
        )
    if response.status_code != 200:
        return _status(False, "http_error", f"Jobnib returned HTTP {response.status_code}.", len(cookies), test_url)
    if "jobnib.com" not in response.text.lower() and "/book/" not in response.text.lower():
        return _status(False, "unexpected", "Jobnib responded, but the expected page markers were missing.", len(cookies), test_url)
    return _status(
        True,
        "ok",
        "Saved Jobnib cookies can access the selected page shell. Full chapter unlock still requires the collector to report reader_verified=true.",
        len(cookies),
        test_url,
    )


def jobnib_headers(user_agent: str | None = None) -> dict[str, str]:
    return {
        "User-Agent": user_agent or DEFAULT_JOBNIB_USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://jobnib.com/",
        "Upgrade-Insecure-Requests": "1",
    }


def is_jobnib_challenge(html: str) -> bool:
    head = (html or "")[:30000].lower()
    return any(marker in head for marker in (
        "just a moment",
        "enable javascript and cookies to continue",
        "/cdn-cgi/challenge-platform/",
        "performing security verification",
        "cf-chl-",
    ))


def normalize_jobnib_url(value: str) -> str:
    parsed = urllib.parse.urlparse((value or "").strip())
    if parsed.scheme not in {"http", "https"} or parsed.hostname not in {"jobnib.com", "www.jobnib.com"}:
        raise ValueError("Use a valid jobnib.com URL.")
    return urllib.parse.urlunparse(("https", "jobnib.com", parsed.path or "/", "", parsed.query, ""))


def parse_jobnib_cookie_input(raw_input: str) -> list[dict[str, Any]]:
    text = (raw_input or "").strip()
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
            data = [{"name": key, "value": value} for key, value in data.items() if isinstance(value, (str, int, float, bool))]
    if not isinstance(data, list):
        raise ValueError("Cookie JSON must contain an array or a name/value map.")
    cookies = []
    for item in data:
        if not isinstance(item, dict) or not item.get("name") or item.get("value") is None:
            continue
        cookies.append(_normalize_cookie(str(item["name"]), str(item["value"]), item))
    return _dedupe(cookies)


def _parse_cookie_header(header: str) -> list[dict[str, Any]]:
    text = re.sub(r"^\s*cookie\s*:\s*", "", header.strip(), flags=re.IGNORECASE)
    cookies = []
    for part in text.split(";"):
        if "=" not in part:
            continue
        name, value = part.split("=", 1)
        if name.strip():
            cookies.append(_normalize_cookie(name.strip(), value.strip(), {}))
    return _dedupe(cookies)


def _normalize_cookie(name: str, value: str, source: dict[str, Any]) -> dict[str, Any]:
    domain = str(source.get("domain") or ".jobnib.com")
    if "jobnib.com" not in domain.lower():
        domain = ".jobnib.com"
    result: dict[str, Any] = {
        "name": name,
        "value": value,
        "domain": domain,
        "path": str(source.get("path") or "/"),
        "secure": bool(source.get("secure", True)),
    }
    expiry = source.get("expiry", source.get("expires", source.get("expirationDate")))
    try:
        parsed = int(float(expiry)) if expiry not in (None, "", 0) else None
    except (TypeError, ValueError):
        parsed = None
    if parsed and parsed > int(time.time()):
        result["expiry"] = parsed
    return result


def _dedupe(cookies: list[dict[str, Any]]) -> list[dict[str, Any]]:
    values = {(item["name"], item["domain"], item["path"]): item for item in cookies}
    return list(values.values())


def _status(valid: bool, reason: str, message: str, count: int, tested_url: str) -> dict[str, Any]:
    return {"valid": valid, "reason": reason, "message": message, "cookie_count": count, "tested_url": tested_url}
