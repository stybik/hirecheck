"""Tests for HMAC signature verification and middleware."""

import hashlib
import hmac
import json
import time

from django.test import Client, override_settings

from apps.common.utils import verify_hmac_signature

HMAC_SECRET = "test-hmac-secret-for-unit-tests!!"


def _make_valid_sig(body_bytes: bytes, secret: str, timestamp: int | None = None) -> tuple[str, str]:
    """Compute a valid HMAC signature matching the extension's algorithm."""
    if timestamp is None:
        timestamp = int(time.time())
    body_hash = hashlib.sha256(body_bytes).hexdigest()
    message = f"{timestamp}{body_hash}".encode()
    sig = hmac.new(secret.encode("utf-8"), message, hashlib.sha256).hexdigest()
    return sig, str(timestamp)


class TestVerifyHmacSignature:
    @override_settings(HMAC_SECRET_KEY=HMAC_SECRET)
    def test_valid_signature(self):
        body = json.dumps({"url": "https://naukri.com/job/123"}).encode()
        sig, ts = _make_valid_sig(body, HMAC_SECRET)
        valid, reason = verify_hmac_signature(body, sig, ts)
        assert valid is True
        assert reason == ""

    @override_settings(HMAC_SECRET_KEY=HMAC_SECRET)
    def test_tampered_body(self):
        body = json.dumps({"url": "https://naukri.com/job/123"}).encode()
        sig, ts = _make_valid_sig(body, HMAC_SECRET)
        tampered = json.dumps({"url": "https://evil.com"}).encode()
        valid, reason = verify_hmac_signature(tampered, sig, ts)
        assert valid is False
        assert "Invalid signature" in reason

    @override_settings(HMAC_SECRET_KEY=HMAC_SECRET)
    def test_expired_timestamp(self):
        body = b'{"url": "https://naukri.com/job/1"}'
        old_ts = int(time.time()) - 400
        sig, ts = _make_valid_sig(body, HMAC_SECRET, timestamp=old_ts)
        valid, reason = verify_hmac_signature(body, sig, ts)
        assert valid is False
        assert "expired" in reason

    @override_settings(HMAC_SECRET_KEY="")
    def test_missing_secret(self):
        valid, reason = verify_hmac_signature(b"body", "sig", "12345")
        assert valid is False
        assert "not configured" in reason

    @override_settings(HMAC_SECRET_KEY=HMAC_SECRET)
    def test_invalid_timestamp_string(self):
        valid, reason = verify_hmac_signature(b"body", "sig", "not-a-number")
        assert valid is False
        assert "Invalid" in reason

    @override_settings(HMAC_SECRET_KEY=HMAC_SECRET)
    def test_future_timestamp_within_window(self):
        body = b'{"url": "https://naukri.com/job/2"}'
        future_ts = int(time.time()) + 30
        sig, ts = _make_valid_sig(body, HMAC_SECRET, timestamp=future_ts)
        valid, reason = verify_hmac_signature(body, sig, ts)
        assert valid is True

    @override_settings(HMAC_SECRET_KEY=HMAC_SECRET)
    def test_wrong_secret(self):
        body = json.dumps({"test": True}).encode()
        sig, ts = _make_valid_sig(body, "wrong-secret-key-not-matching")
        valid, reason = verify_hmac_signature(body, sig, ts)
        assert valid is False
        assert "Invalid signature" in reason


class TestHMACMiddleware:
    """Integration tests for HMAC middleware via Django test client."""

    @override_settings(HMAC_SECRET_KEY=HMAC_SECRET)
    def test_health_endpoint_skips_hmac(self, db):
        client = Client()
        response = client.get("/api/v1/health/")
        assert response.status_code == 200

    @override_settings(HMAC_SECRET_KEY=HMAC_SECRET)
    def test_missing_hmac_headers_returns_401(self, db):
        client = Client()
        response = client.post(
            "/api/v1/analyze/",
            data=json.dumps({"url": "test"}),
            content_type="application/json",
        )
        assert response.status_code == 401
        data = json.loads(response.content)
        assert data["error"] == "missing_signature"

    @override_settings(HMAC_SECRET_KEY=HMAC_SECRET)
    def test_bad_signature_returns_403(self, db):
        client = Client()
        response = client.post(
            "/api/v1/analyze/",
            data=json.dumps({"url": "test"}),
            content_type="application/json",
            HTTP_X_EXTENSION_SIGNATURE="badhex",
            HTTP_X_TIMESTAMP=str(int(time.time())),
        )
        assert response.status_code == 403
        data = json.loads(response.content)
        assert data["error"] == "invalid_signature"

    @override_settings(HMAC_SECRET_KEY=HMAC_SECRET)
    def test_valid_signature_passes_through(self, db):
        """With valid HMAC, request reaches the view (may get 400 for bad body, but not 401/403)."""
        client = Client()
        body = json.dumps({"url": "test"})
        sig, ts = _make_valid_sig(body.encode(), HMAC_SECRET)
        response = client.post(
            "/api/v1/analyze/",
            data=body,
            content_type="application/json",
            HTTP_X_EXTENSION_SIGNATURE=sig,
            HTTP_X_TIMESTAMP=ts,
        )
        # Should pass HMAC (not 401/403) but may fail validation (400)
        assert response.status_code in (200, 400)
