from unittest.mock import patch, MagicMock
import time
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from fastapi.testclient import TestClient
from api.routes.downloads import router, _tickets, _worker_url


def test_redeem_download_ticket_preserves_filename(monkeypatch) -> None:
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)

    # Mock the tickets collection
    mock_ticket = MagicMock()
    mock_ticket.upstream_url = "http://localhost:8002/api/results/123/download?filename=TestNovel.md"
    mock_ticket.user_id = "test-user"
    mock_ticket.role = "admin"
    mock_ticket.expires_at = time.monotonic() + 100

    _tickets["test-token"] = mock_ticket

    # Mock the identity setter/resetter
    monkeypatch.setattr("api.routes.downloads.set_request_identity", lambda uid, role: "identity-token")
    monkeypatch.setattr("api.routes.downloads.reset_request_identity", lambda token: None)

    # Mock streaming_proxy to return a StreamingResponse with content-disposition header
    async def mock_streaming_proxy(method, url, timeout):
        headers = {"content-disposition": 'attachment; filename="TestNovel.md"'}
        async def content_gen():
            yield b"file content"
        return StreamingResponse(content_gen(), headers=headers)

    monkeypatch.setattr("api.routes.downloads.streaming_proxy", mock_streaming_proxy)

    response = client.get("/api/download/test-token")
    assert response.status_code == 200
    assert response.headers.get("content-disposition") == 'attachment; filename="TestNovel.md"'


def test_redeem_download_ticket_preserves_filename_rfc5987(monkeypatch) -> None:
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)

    mock_ticket = MagicMock()
    mock_ticket.upstream_url = "http://localhost:8002/api/results/123/download?filename=TestNovel's.md"
    mock_ticket.user_id = "test-user"
    mock_ticket.role = "admin"
    mock_ticket.expires_at = time.monotonic() + 100

    _tickets["test-token-rfc"] = mock_ticket

    monkeypatch.setattr("api.routes.downloads.set_request_identity", lambda uid, role: "identity-token")
    monkeypatch.setattr("api.routes.downloads.reset_request_identity", lambda token: None)

    async def mock_streaming_proxy(method, url, timeout):
        headers = {"content-disposition": "attachment; filename*=utf-8''TestNovel%27s.md"}
        async def content_gen():
            yield b"file content"
        return StreamingResponse(content_gen(), headers=headers)

    monkeypatch.setattr("api.routes.downloads.streaming_proxy", mock_streaming_proxy)

    response = client.get("/api/download/test-token-rfc")
    assert response.status_code == 200
    assert response.headers.get("content-disposition") == "attachment; filename*=utf-8''TestNovel%27s.md"


def test_worker_url_allows_inkitt_batch_download_with_run_id(monkeypatch) -> None:
    monkeypatch.setenv("SERVICE_URLS_NovelCrawler", "http://novelcrawler.local")

    url = _worker_url("/api/results/inkitt-batch/abc123ef/download?run_id=feedbeef")

    assert url == "http://novelcrawler.local/api/results/inkitt-batch/abc123ef/download?run_id=feedbeef"


def test_redeem_download_ticket_sets_start_marker_cookie(monkeypatch) -> None:
    """Successful downloads set cs_download_<token>=1 so the frontend can hold
    its loading state until the (possibly slow to prepare) file starts."""
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)

    mock_ticket = MagicMock()
    mock_ticket.upstream_url = "http://localhost:8002/api/results/123/download"
    mock_ticket.user_id = "test-user"
    mock_ticket.role = "admin"
    mock_ticket.expires_at = time.monotonic() + 100

    _tickets["test-token-cookie"] = mock_ticket

    monkeypatch.setattr("api.routes.downloads.set_request_identity", lambda uid, role: "identity-token")
    monkeypatch.setattr("api.routes.downloads.reset_request_identity", lambda token: None)

    async def mock_streaming_proxy(method, url, timeout):
        async def content_gen():
            yield b"file content"
        return StreamingResponse(content_gen(), headers={"content-disposition": 'attachment; filename="x.zip"'})

    monkeypatch.setattr("api.routes.downloads.streaming_proxy", mock_streaming_proxy)

    response = client.get("/api/download/test-token-cookie")
    assert response.status_code == 200
    assert response.cookies.get("cs_download_test-token-cookie") == "1"


def test_redeem_download_ticket_sets_error_marker_cookie(monkeypatch) -> None:
    """Upstream failures set cs_download_<token>=error so the frontend can stop
    its loading state and surface the failure instead of timing out."""
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)

    mock_ticket = MagicMock()
    mock_ticket.upstream_url = "http://localhost:8002/api/results/123/download"
    mock_ticket.user_id = "test-user"
    mock_ticket.role = "admin"
    mock_ticket.expires_at = time.monotonic() + 100

    _tickets["test-token-err"] = mock_ticket

    monkeypatch.setattr("api.routes.downloads.set_request_identity", lambda uid, role: "identity-token")
    monkeypatch.setattr("api.routes.downloads.reset_request_identity", lambda token: None)

    async def mock_streaming_proxy(method, url, timeout):
        async def content_gen():
            yield b'{"detail":"no files"}'
        return StreamingResponse(content_gen(), status_code=409)

    monkeypatch.setattr("api.routes.downloads.streaming_proxy", mock_streaming_proxy)

    response = client.get("/api/download/test-token-err")
    assert response.status_code == 409
    assert response.cookies.get("cs_download_test-token-err") == "error"
    assert "content-disposition" not in response.headers
