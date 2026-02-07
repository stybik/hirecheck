import json

from django.test import Client


class TestHealthEndpoint:
    def test_returns_200(self, db):
        client = Client()
        response = client.get("/api/v1/health/")
        assert response.status_code == 200

    def test_response_shape(self, db):
        client = Client()
        response = client.get("/api/v1/health/")
        data = json.loads(response.content)
        assert data["status"] == "healthy"
        assert data["version"] == "0.1.0"
        assert "uptime_seconds" in data
        assert isinstance(data["uptime_seconds"], int)

    def test_model_info(self, db):
        client = Client()
        response = client.get("/api/v1/health/")
        data = json.loads(response.content)
        assert data["models"]["primary"] == "gemini-2.5-flash"
        assert data["models"]["fallback"] == "gpt-4o-mini"

    def test_only_get_allowed(self, db):
        client = Client()
        response = client.post("/api/v1/health/")
        assert response.status_code == 405
