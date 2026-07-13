from __future__ import annotations

from api.services.jobnib_cookie_service import (
    is_jobnib_challenge,
    normalize_jobnib_url,
    parse_jobnib_cookie_input,
    update_jobnib_cookies,
)


def test_raw_cookie_header_and_selenium_json_are_supported() -> None:
    header = parse_jobnib_cookie_input("Cookie: cf_clearance=abc; PHPSESSID=xyz")
    exported = parse_jobnib_cookie_input('[{"name":"cf_clearance","value":"abc","domain":".jobnib.com"}]')

    assert {item["name"] for item in header} == {"cf_clearance", "PHPSESSID"}
    assert exported[0]["domain"] == ".jobnib.com"


def test_jobnib_session_helpers_reject_foreign_domains_and_detect_challenges() -> None:
    assert normalize_jobnib_url("https://www.jobnib.com/book/story") == "https://jobnib.com/book/story"
    assert is_jobnib_challenge('<script src="/cdn-cgi/challenge-platform/test"></script>')
    try:
        normalize_jobnib_url("https://example.com/book/story")
    except ValueError:
        pass
    else:
        raise AssertionError("Foreign domains must be rejected")


def test_unverified_collector_file_is_rejected_before_database_access() -> None:
    payload = '{"cookies":[{"name":"cf_clearance","value":"abc"}],"reader_verified":false,"reader_state":{"unlocked_segments":0}}'

    try:
        update_jobnib_cookies(payload, "Browser UA")
    except ValueError as exc:
        assert "0/2 chapter segments unlocked" in str(exc)
    else:
        raise AssertionError("An explicitly unverified collector file must not be saved")
