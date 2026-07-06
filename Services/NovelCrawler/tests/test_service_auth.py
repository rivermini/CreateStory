from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from api.service_auth import enforce_service_auth


def _app() -> FastAPI:
    app = FastAPI()
    app.middleware("http")(enforce_service_auth)

    @app.get("/")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/protected")
    def protected(request: Request) -> dict[str, str | None]:
        return {
            "user_id": getattr(request.state, "create_story_user_id", None),
            "role": getattr(request.state, "create_story_role", None),
        }

    return app


def test_service_auth_rejects_missing_token(monkeypatch):
    monkeypatch.setenv("INTERNAL_SERVICE_TOKEN", "ci-service-token")
    client = TestClient(_app())

    assert client.get("/").status_code == 200
    response = client.get("/protected")

    assert response.status_code == 401


def test_service_auth_accepts_internal_token_and_identity(monkeypatch):
    monkeypatch.setenv("INTERNAL_SERVICE_TOKEN", "ci-service-token")
    client = TestClient(_app())

    response = client.get(
        "/protected",
        headers={
            "Authorization": "Bearer ci-service-token",
            "X-CreateStory-User-Id": "user-123",
            "X-CreateStory-Role": "operator",
        },
    )

    assert response.status_code == 200
    assert response.json() == {"user_id": "user-123", "role": "operator"}


def test_require_roles():
    from fastapi import HTTPException
    import pytest
    from api.service_auth import require_admin_identity, require_operator_identity

    class DummyState:
        def __init__(self, role):
            self.create_story_role = role

    class DummyRequest:
        def __init__(self, role):
            self.state = DummyState(role)

    # Test require_admin_identity
    require_admin_identity(DummyRequest("admin"))  # Should not raise

    with pytest.raises(HTTPException) as exc:
        require_admin_identity(DummyRequest("operator"))
    assert exc.value.status_code == 403

    # Test require_operator_identity
    require_operator_identity(DummyRequest("admin"))  # Should not raise
    require_operator_identity(DummyRequest("operator"))  # Should not raise

    with pytest.raises(HTTPException) as exc:
        require_operator_identity(DummyRequest("user"))
    assert exc.value.status_code == 403

