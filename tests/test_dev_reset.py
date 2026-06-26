from fastapi.testclient import TestClient


def test_dev_reset_hidden_when_dev_mode_disabled(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "sqlite:///:memory:")
    monkeypatch.setenv("INTERNAL_SERVICE_TOKEN", "ci-service-token")
    monkeypatch.delenv("DEV_MODE", raising=False)

    from main import app

    response = TestClient(app).post(
        "/api/dev/reset-state",
        headers={"Authorization": "Bearer ci-service-token"},
    )

    assert response.status_code == 404
