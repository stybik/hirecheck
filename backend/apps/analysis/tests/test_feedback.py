"""Integration tests for POST /api/v1/feedback/ endpoint."""

import hashlib
import hmac
import json
import time
import uuid

from django.test import Client, override_settings

from apps.analysis.models import AnalyzedListing, UserFeedback

HMAC_SECRET = "test-hmac-secret-for-feedback-tests"


def _create_listing(**overrides):
    """Create an AnalyzedListing for FK reference in feedback tests."""
    defaults = {
        "url_hash": hashlib.sha256(uuid.uuid4().hex.encode()).hexdigest(),
        "content_hash": hashlib.sha256(b"test-content").hexdigest(),
        "platform": "naukri",
        "job_title": "Software Engineer",
        "company_name": "Test Corp",
        "ghost_score": 45,
        "category_scores": {
            "ghost_signals": 50,
            "scam_signals": 30,
            "toxic_culture": 40,
            "market_reality": 60,
        },
        "red_flags": [],
        "recommendation": "apply_with_caution",
        "signals_checked": 10,
        "ai_model_used": "gemini-2.5-flash",
        "tokens_used": 200,
        "response_ms": 500,
    }
    defaults.update(overrides)
    return AnalyzedListing.objects.create(**defaults)


def _sign_and_post(client: Client, url: str, body: dict):
    """Sign request body with HMAC and POST to the given URL."""
    body_json = json.dumps(body)
    body_bytes = body_json.encode("utf-8")
    timestamp = int(time.time())
    body_hash = hashlib.sha256(body_bytes).hexdigest()
    message = f"{timestamp}{body_hash}".encode()
    sig = hmac.new(HMAC_SECRET.encode("utf-8"), message, hashlib.sha256).hexdigest()
    return client.post(
        url,
        data=body_json,
        content_type="application/json",
        HTTP_X_EXTENSION_SIGNATURE=sig,
        HTTP_X_TIMESTAMP=str(timestamp),
    )


class TestFeedbackEndpoint:
    """Tests for POST /api/v1/feedback/."""

    # -- Happy path --

    @override_settings(HMAC_SECRET_KEY=HMAC_SECRET)
    def test_confirmed_real_returns_201(self, db):
        listing = _create_listing()
        client = Client()
        body = {
            "analysis_id": str(listing.pk),
            "feedback_type": "confirmed_real",
            "device_fingerprint": "device-001",
        }
        response = _sign_and_post(client, "/api/v1/feedback/", body)
        assert response.status_code == 201

    @override_settings(HMAC_SECRET_KEY=HMAC_SECRET)
    def test_confirmed_fake_returns_201(self, db):
        listing = _create_listing()
        client = Client()
        body = {
            "analysis_id": str(listing.pk),
            "feedback_type": "confirmed_fake",
            "device_fingerprint": "device-002",
        }
        response = _sign_and_post(client, "/api/v1/feedback/", body)
        assert response.status_code == 201

    @override_settings(HMAC_SECRET_KEY=HMAC_SECRET)
    def test_feedback_stored_in_db(self, db):
        listing = _create_listing()
        client = Client()
        body = {
            "analysis_id": str(listing.pk),
            "feedback_type": "confirmed_real",
            "device_fingerprint": "device-003",
        }
        _sign_and_post(client, "/api/v1/feedback/", body)
        assert UserFeedback.objects.count() == 1
        fb = UserFeedback.objects.first()
        assert fb.feedback_type == "confirmed_real"
        assert fb.device_hash == "device-003"
        assert fb.analysis_id == listing.pk

    @override_settings(HMAC_SECRET_KEY=HMAC_SECRET)
    def test_response_has_feedback_id(self, db):
        listing = _create_listing()
        client = Client()
        body = {
            "analysis_id": str(listing.pk),
            "feedback_type": "confirmed_real",
            "device_fingerprint": "device-004",
        }
        response = _sign_and_post(client, "/api/v1/feedback/", body)
        data = json.loads(response.content)
        assert "feedback_id" in data
        assert data["analysis_id"] == str(listing.pk)
        assert data["feedback_type"] == "confirmed_real"
        assert "message" in data

    # -- Validation errors --

    @override_settings(HMAC_SECRET_KEY=HMAC_SECRET)
    def test_missing_analysis_id_returns_400(self, db):
        client = Client()
        body = {"feedback_type": "confirmed_real", "device_fingerprint": "device-005"}
        response = _sign_and_post(client, "/api/v1/feedback/", body)
        assert response.status_code == 400

    @override_settings(HMAC_SECRET_KEY=HMAC_SECRET)
    def test_missing_feedback_type_returns_400(self, db):
        listing = _create_listing()
        client = Client()
        body = {"analysis_id": str(listing.pk), "device_fingerprint": "device-006"}
        response = _sign_and_post(client, "/api/v1/feedback/", body)
        assert response.status_code == 400

    @override_settings(HMAC_SECRET_KEY=HMAC_SECRET)
    def test_invalid_feedback_type_returns_400(self, db):
        listing = _create_listing()
        client = Client()
        body = {
            "analysis_id": str(listing.pk),
            "feedback_type": "maybe_fake",
            "device_fingerprint": "device-007",
        }
        response = _sign_and_post(client, "/api/v1/feedback/", body)
        assert response.status_code == 400

    @override_settings(HMAC_SECRET_KEY=HMAC_SECRET)
    def test_missing_device_fingerprint_returns_400(self, db):
        listing = _create_listing()
        client = Client()
        body = {"analysis_id": str(listing.pk), "feedback_type": "confirmed_real"}
        response = _sign_and_post(client, "/api/v1/feedback/", body)
        assert response.status_code == 400

    # -- Not found --

    @override_settings(HMAC_SECRET_KEY=HMAC_SECRET)
    def test_nonexistent_analysis_id_returns_404(self, db):
        client = Client()
        body = {
            "analysis_id": str(uuid.uuid4()),
            "feedback_type": "confirmed_real",
            "device_fingerprint": "device-008",
        }
        response = _sign_and_post(client, "/api/v1/feedback/", body)
        assert response.status_code == 404

    @override_settings(HMAC_SECRET_KEY=HMAC_SECRET)
    def test_malformed_uuid_returns_404(self, db):
        client = Client()
        body = {
            "analysis_id": "not-a-valid-uuid",
            "feedback_type": "confirmed_real",
            "device_fingerprint": "device-009",
        }
        response = _sign_and_post(client, "/api/v1/feedback/", body)
        assert response.status_code == 404

    # -- Dedup --

    @override_settings(HMAC_SECRET_KEY=HMAC_SECRET)
    def test_duplicate_feedback_returns_409(self, db):
        listing = _create_listing()
        client = Client()
        body = {
            "analysis_id": str(listing.pk),
            "feedback_type": "confirmed_real",
            "device_fingerprint": "device-010",
        }
        _sign_and_post(client, "/api/v1/feedback/", body)
        response = _sign_and_post(client, "/api/v1/feedback/", body)
        assert response.status_code == 409
        data = json.loads(response.content)
        assert data["error"] == "duplicate"

    @override_settings(HMAC_SECRET_KEY=HMAC_SECRET)
    def test_same_device_different_analysis_returns_201(self, db):
        listing1 = _create_listing()
        listing2 = _create_listing()
        client = Client()
        body1 = {
            "analysis_id": str(listing1.pk),
            "feedback_type": "confirmed_real",
            "device_fingerprint": "device-011",
        }
        body2 = {
            "analysis_id": str(listing2.pk),
            "feedback_type": "confirmed_fake",
            "device_fingerprint": "device-011",
        }
        _sign_and_post(client, "/api/v1/feedback/", body1)
        response = _sign_and_post(client, "/api/v1/feedback/", body2)
        assert response.status_code == 201

    @override_settings(HMAC_SECRET_KEY=HMAC_SECRET)
    def test_different_device_same_analysis_returns_201(self, db):
        listing = _create_listing()
        client = Client()
        body1 = {
            "analysis_id": str(listing.pk),
            "feedback_type": "confirmed_real",
            "device_fingerprint": "device-012a",
        }
        body2 = {
            "analysis_id": str(listing.pk),
            "feedback_type": "confirmed_fake",
            "device_fingerprint": "device-012b",
        }
        _sign_and_post(client, "/api/v1/feedback/", body1)
        response = _sign_and_post(client, "/api/v1/feedback/", body2)
        assert response.status_code == 201

    # -- Auth --

    @override_settings(HMAC_SECRET_KEY=HMAC_SECRET)
    def test_missing_hmac_returns_401(self, db):
        listing = _create_listing()
        client = Client()
        body = {
            "analysis_id": str(listing.pk),
            "feedback_type": "confirmed_real",
            "device_fingerprint": "device-013",
        }
        response = client.post(
            "/api/v1/feedback/",
            data=json.dumps(body),
            content_type="application/json",
        )
        assert response.status_code == 401

    @override_settings(HMAC_SECRET_KEY=HMAC_SECRET)
    def test_get_method_returns_401(self, db):
        """GET hits HMAC middleware first (401 for missing headers)."""
        client = Client()
        response = client.get("/api/v1/feedback/")
        assert response.status_code == 401

    # -- Content-type --

    @override_settings(HMAC_SECRET_KEY=HMAC_SECRET)
    def test_non_json_content_type_returns_415(self, db):
        client = Client()
        body = "analysis_id=abc&feedback_type=confirmed_real"
        timestamp = int(time.time())
        body_hash = hashlib.sha256(body.encode()).hexdigest()
        message = f"{timestamp}{body_hash}".encode()
        sig = hmac.new(HMAC_SECRET.encode("utf-8"), message, hashlib.sha256).hexdigest()
        response = client.post(
            "/api/v1/feedback/",
            data=body,
            content_type="application/x-www-form-urlencoded",
            HTTP_X_EXTENSION_SIGNATURE=sig,
            HTTP_X_TIMESTAMP=str(timestamp),
        )
        assert response.status_code == 415

    # -- Edge: empty body --

    @override_settings(HMAC_SECRET_KEY=HMAC_SECRET)
    def test_empty_body_returns_400(self, db):
        client = Client()
        response = _sign_and_post(client, "/api/v1/feedback/", {})
        assert response.status_code == 400
