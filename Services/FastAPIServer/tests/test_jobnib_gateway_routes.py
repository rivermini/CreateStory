import pytest
from fastapi import HTTPException
from fastapi.routing import APIRoute

from api.routes.crawl import _pairing_bearer, browser_capture_router, router as crawl_router
from api.routes.downloads import _worker_url
from api.routes.results import router as results_router


def test_all_jobnib_gateway_routes_are_registered() -> None:
    routes = {
        (method, route.path)
        for route in [*crawl_router.routes, *browser_capture_router.routes, *results_router.routes]
        if isinstance(route, APIRoute)
        for method in route.methods
    }

    expected = {
        ("POST", "/api/crawl/jobnib-cookies"),
        ("POST", "/api/crawl/jobnib-cookies/status"),
        ("POST", "/api/crawl/jobnib-batch/start"),
        ("GET", "/api/crawl/jobnib-companion/manifest"),
        ("GET", "/api/crawl/jobnib-companion/download/windows-x64"),
        ("GET", "/api/crawl/jobnib-batch"),
        ("GET", "/api/crawl/jobnib-batch/catalog/export"),
        ("GET", "/api/crawl/jobnib-batch/{batch_id}/catalog/export"),
        ("POST", "/api/crawl/jobnib-batch/catalog/import"),
        ("GET", "/api/crawl/jobnib-batch/{batch_id}"),
        ("POST", "/api/crawl/jobnib-batch/{batch_id}/crawl"),
        ("POST", "/api/crawl/jobnib-batch/{batch_id}/pause"),
        ("POST", "/api/crawl/jobnib-batch/{batch_id}/retry-failed"),
        ("POST", "/api/crawl/jobnib-batch/{batch_id}/retry-session"),
        ("POST", "/api/crawl/jobnib-batch/{batch_id}/browser-capture/pair"),
        ("GET", "/api/crawl/jobnib-batch/{batch_id}/browser-capture/{pairing_id}/status"),
        ("GET", "/api/crawl/jobnib-batch/{batch_id}/browser-capture/{pairing_id}/next"),
        ("POST", "/api/crawl/jobnib-batch/{batch_id}/browser-capture/{pairing_id}/submit"),
        ("POST", "/api/crawl/jobnib-batch/{batch_id}/browser-capture/{pairing_id}/report"),
        ("POST", "/api/crawl/jobnib-batch/{batch_id}/browser-capture/{pairing_id}/close"),
        ("GET", "/api/crawl/jobnib-batch/{batch_id}/rows"),
        ("GET", "/api/crawl/jobnib-batch/{batch_id}/logs"),
        ("DELETE", "/api/crawl/jobnib-batch/{batch_id}"),
        ("GET", "/api/results/jobnib-batch/{batch_id}/download"),
    }

    assert expected <= routes


def test_companion_download_ticket_targets_novelcrawler(monkeypatch) -> None:
    monkeypatch.setenv("SERVICE_URLS_NovelCrawler", "http://crawler:8002")
    assert _worker_url("/api/crawl/jobnib-companion/download/windows-x64") == (
        "http://crawler:8002/api/crawl/jobnib-companion/download/windows-x64"
    )
    assert _worker_url("/api/results/download-all") == "http://crawler:8002/api/results/download-all"
    assert _worker_url("/api/results/jobnib-batch/deadbeef/download") == (
        "http://crawler:8002/api/results/jobnib-batch/deadbeef/download"
    )


def test_companion_bearer_requires_a_high_entropy_urlsafe_token() -> None:
    token = "a" * 43
    assert _pairing_bearer(f"Bearer {token}") == token

    for value in (None, "", "Bearer short", "Basic " + token, "Bearer bad token value"):
        with pytest.raises(HTTPException) as exc_info:
            _pairing_bearer(value)
        assert exc_info.value.status_code == 401
