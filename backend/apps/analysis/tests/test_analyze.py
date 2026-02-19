"""Integration tests for POST /api/v1/analyze/ endpoint."""

import hashlib
import hmac
import json
import time
from unittest.mock import patch

from django.test import Client, override_settings

from apps.analysis.models import AnalyzedListing, APIUsageLog
from apps.analysis.schemas import CategoryScores, LLMResponse, RedFlag
from apps.analysis.services.ai_analyzer import AnalysisUnavailableError

HMAC_SECRET = "test-hmac-secret-for-analyze-tests"


def _make_valid_body() -> dict:
    return {
        "url": "https://www.naukri.com/job-listings-senior-python-developer-12345",
        "job_title": "Senior Python Developer",
        "company_name": "Acme Corp",
        "description": "We are looking for a senior Python developer to join our dynamic team.",
        "requirements": "5+ years Python experience",
        "salary_text": "15-25 LPA",
        "posting_date": "2026-01-15",
        "source": "dom_extraction",
        "device_fingerprint": "test-device-uuid-0001",
    }


def _sign_and_post(client: Client, body: dict) -> object:
    """Sign request body with HMAC and POST to analyze endpoint."""
    body_json = json.dumps(body)
    body_bytes = body_json.encode("utf-8")
    timestamp = int(time.time())
    body_hash = hashlib.sha256(body_bytes).hexdigest()
    message = f"{timestamp}{body_hash}".encode()
    sig = hmac.new(HMAC_SECRET.encode("utf-8"), message, hashlib.sha256).hexdigest()
    return client.post(
        "/api/v1/analyze/",
        data=body_json,
        content_type="application/json",
        HTTP_X_EXTENSION_SIGNATURE=sig,
        HTTP_X_TIMESTAMP=str(timestamp),
    )


MOCK_LLM_RESPONSE = LLMResponse(
    category_scores=CategoryScores(ghost_signals=70, scam_signals=50, toxic_culture=40, market_reality=60),
    red_flags=[
        RedFlag(
            category="ghost_signals",
            signal="Posting is 90 days old",
            severity="high",
            explanation="Jobs open for 90+ days are almost always ghost jobs kept open for pipeline building.",
        ),
        RedFlag(
            category="toxic_culture",
            signal="Uses 'dynamic team' language",
            severity="medium",
            explanation="Vague team descriptions often mask disorganized management or high turnover.",
        ),
    ],
    recommendation="apply_with_caution",
    signals_checked=12,
)


class TestAnalyzeEndpoint:
    @override_settings(HMAC_SECRET_KEY=HMAC_SECRET, DAILY_ANALYSIS_LIMIT=5)
    @patch("apps.analysis.views.analyze_job_listing", return_value=(MOCK_LLM_RESPONSE, "gemini-2.5-flash", 350))
    def test_successful_analysis(self, mock_ai, db):
        client = Client()
        response = _sign_and_post(client, _make_valid_body())
        assert response.status_code == 200
        data = json.loads(response.content)
        assert "ghost_score" in data
        assert "analysis_id" in data
        assert data["was_cached"] is False
        assert data["model_used"] == "gemini-2.5-flash"
        assert data["recommendation"] in ("apply_confidently", "apply_with_caution", "likely_fake")

    @override_settings(HMAC_SECRET_KEY=HMAC_SECRET, DAILY_ANALYSIS_LIMIT=5)
    @patch("apps.analysis.views.analyze_job_listing", return_value=(MOCK_LLM_RESPONSE, "gemini-2.5-flash", 350))
    def test_ghost_score_computed_server_side(self, mock_ai, db):
        client = Client()
        response = _sign_and_post(client, _make_valid_body())
        data = json.loads(response.content)
        # 70*0.30 + 50*0.25 + 40*0.20 + 60*0.25 = 21 + 12.5 + 8 + 15 = 56.5 → round(56.5) = 56 (banker's rounding)
        assert data["ghost_score"] == 56
        assert data["recommendation"] == "apply_with_caution"

    @override_settings(HMAC_SECRET_KEY=HMAC_SECRET, DAILY_ANALYSIS_LIMIT=5)
    @patch("apps.analysis.views.analyze_job_listing", return_value=(MOCK_LLM_RESPONSE, "gemini-2.5-flash", 350))
    def test_response_includes_category_scores(self, mock_ai, db):
        client = Client()
        response = _sign_and_post(client, _make_valid_body())
        data = json.loads(response.content)
        assert data["category_scores"] == {
            "ghost_signals": 70,
            "scam_signals": 50,
            "toxic_culture": 40,
            "market_reality": 60,
        }

    @override_settings(HMAC_SECRET_KEY=HMAC_SECRET, DAILY_ANALYSIS_LIMIT=5)
    @patch("apps.analysis.views.analyze_job_listing", return_value=(MOCK_LLM_RESPONSE, "gemini-2.5-flash", 350))
    def test_response_includes_red_flags(self, mock_ai, db):
        client = Client()
        response = _sign_and_post(client, _make_valid_body())
        data = json.loads(response.content)
        assert len(data["red_flags"]) == 2
        assert data["red_flags"][0]["category"] == "ghost_signals"

    @override_settings(HMAC_SECRET_KEY=HMAC_SECRET, DAILY_ANALYSIS_LIMIT=5)
    @patch("apps.analysis.views.analyze_job_listing", return_value=(MOCK_LLM_RESPONSE, "gemini-2.5-flash", 350))
    def test_response_includes_signals_checked_from_llm(self, mock_ai, db):
        client = Client()
        response = _sign_and_post(client, _make_valid_body())
        data = json.loads(response.content)
        assert data["signals_checked"] == 12  # From LLM response, not len(red_flags)

    @override_settings(HMAC_SECRET_KEY=HMAC_SECRET, DAILY_ANALYSIS_LIMIT=5)
    @patch("apps.analysis.views.analyze_job_listing", return_value=(MOCK_LLM_RESPONSE, "gemini-2.5-flash", 350))
    def test_creates_analyzed_listing_in_db(self, mock_ai, db):
        client = Client()
        _sign_and_post(client, _make_valid_body())
        assert AnalyzedListing.objects.count() == 1
        listing = AnalyzedListing.objects.first()
        assert listing.ghost_score == 56
        assert listing.ai_model_used == "gemini-2.5-flash"
        assert listing.signals_checked == 12

    @override_settings(HMAC_SECRET_KEY=HMAC_SECRET, DAILY_ANALYSIS_LIMIT=5)
    @patch("apps.analysis.views.analyze_job_listing", return_value=(MOCK_LLM_RESPONSE, "gemini-2.5-flash", 350))
    def test_creates_api_usage_log(self, mock_ai, db):
        client = Client()
        _sign_and_post(client, _make_valid_body())
        assert APIUsageLog.objects.filter(endpoint="/api/v1/analyze/").count() == 1
        log = APIUsageLog.objects.first()
        assert log.was_cached is False
        assert log.model_used == "gemini-2.5-flash"
        assert log.tokens_used == 350

    @override_settings(HMAC_SECRET_KEY=HMAC_SECRET, DAILY_ANALYSIS_LIMIT=5)
    @patch("apps.analysis.views.analyze_job_listing", return_value=(MOCK_LLM_RESPONSE, "gemini-2.5-flash", 350))
    def test_second_request_same_url_returns_cached(self, mock_ai, db):
        client = Client()
        body = _make_valid_body()
        _sign_and_post(client, body)
        response2 = _sign_and_post(client, body)
        data2 = json.loads(response2.content)
        assert data2["was_cached"] is True
        assert mock_ai.call_count == 1  # AI called only once

    @override_settings(HMAC_SECRET_KEY=HMAC_SECRET, DAILY_ANALYSIS_LIMIT=5)
    @patch("apps.analysis.views.analyze_job_listing", return_value=(MOCK_LLM_RESPONSE, "gemini-2.5-flash", 350))
    def test_rate_limit_enforced(self, mock_ai, db):
        client = Client()
        # Make 5 unique requests (different URLs + descriptions to avoid cache hits)
        for i in range(5):
            body = _make_valid_body()
            body["url"] = f"https://www.naukri.com/job/unique-{i}-{time.time()}"
            body["job_title"] = f"Job Title {i}"
            body["description"] = f"Unique job description number {i} avoids content hash collision"
            _sign_and_post(client, body)

        # 6th request should be rate limited
        body = _make_valid_body()
        body["url"] = f"https://www.naukri.com/job/rate-limited-{time.time()}"
        body["job_title"] = "Rate Limited Job"
        body["description"] = "This request should be rate limited because we exceeded the daily limit"
        response = _sign_and_post(client, body)
        assert response.status_code == 429
        data = json.loads(response.content)
        assert data["error"] == "rate_limit_exceeded"

    @override_settings(HMAC_SECRET_KEY=HMAC_SECRET)
    def test_missing_hmac_returns_401(self, db):
        client = Client()
        response = client.post(
            "/api/v1/analyze/",
            data=json.dumps(_make_valid_body()),
            content_type="application/json",
        )
        assert response.status_code == 401

    @override_settings(HMAC_SECRET_KEY=HMAC_SECRET, DAILY_ANALYSIS_LIMIT=5)
    def test_invalid_body_returns_400(self, db):
        client = Client()
        body = {"url": ""}  # Missing required fields
        response = _sign_and_post(client, body)
        assert response.status_code == 400

    @override_settings(HMAC_SECRET_KEY=HMAC_SECRET, DAILY_ANALYSIS_LIMIT=5)
    def test_missing_required_fields_returns_400(self, db):
        client = Client()
        body = {"url": "https://naukri.com/job/1", "source": "dom_extraction"}
        response = _sign_and_post(client, body)
        assert response.status_code == 400
        data = json.loads(response.content)
        assert data["error"] == "Validation failed"

    @override_settings(HMAC_SECRET_KEY=HMAC_SECRET, DAILY_ANALYSIS_LIMIT=5)
    @patch("apps.analysis.views.analyze_job_listing", side_effect=AnalysisUnavailableError("test"))
    def test_ai_unavailable_returns_503(self, mock_ai, db):
        client = Client()
        response = _sign_and_post(client, _make_valid_body())
        assert response.status_code == 503
        data = json.loads(response.content)
        assert data["error"] == "analysis_unavailable"

    @override_settings(HMAC_SECRET_KEY=HMAC_SECRET)
    def test_get_method_not_allowed(self, db):
        """GET hits HMAC middleware first (401 for missing headers), which is correct behavior."""
        client = Client()
        response = client.get("/api/v1/analyze/")
        # HMAC middleware rejects before view's @require_POST can respond
        assert response.status_code == 401
