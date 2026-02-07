import pytest
from django.db import IntegrityError

from apps.analysis.models import AnalyzedListing, APIUsageLog, UserFeedback


@pytest.fixture
def sample_listing(db):
    return AnalyzedListing.objects.create(
        url_hash="a" * 64,
        content_hash="b" * 64,
        platform="naukri",
        job_title="Senior Python Developer",
        company_name="Acme Corp",
        ghost_score=72,
        category_scores={
            "ghost_signals": 85,
            "scam_signals": 40,
            "toxic_culture": 90,
            "market_reality": 55,
        },
        red_flags=[
            {
                "category": "ghost_signals",
                "signal": "Posting is 45 days old",
                "severity": "high",
                "explanation": "Jobs open for 30+ days are often ghost jobs.",
            }
        ],
        recommendation="likely_fake",
        ai_model_used="gpt-4o-mini",
        tokens_used=150,
        response_ms=2500,
    )


class TestAnalyzedListing:
    def test_create(self, sample_listing):
        assert sample_listing.pk is not None
        assert sample_listing.ghost_score == 72
        assert sample_listing.recommendation == "likely_fake"
        assert sample_listing.job_title == "Senior Python Developer"
        assert sample_listing.platform == "naukri"

    def test_str(self, sample_listing):
        assert str(sample_listing) == "Senior Python Developer @ Acme Corp (score: 72)"

    def test_url_hash_unique(self, sample_listing, db):
        with pytest.raises(IntegrityError):
            AnalyzedListing.objects.create(
                url_hash="a" * 64,
                content_hash="c" * 64,
                job_title="Another Job",
                company_name="Other Corp",
                ghost_score=30,
                category_scores={},
                red_flags=[],
                recommendation="apply_confidently",
                ai_model_used="gpt-4o-mini",
            )

    def test_category_scores_jsonb(self, sample_listing):
        assert sample_listing.category_scores["ghost_signals"] == 85
        assert sample_listing.category_scores["toxic_culture"] == 90

    def test_recommendation_choices(self):
        choices = AnalyzedListing.Recommendation
        assert choices.APPLY_CONFIDENTLY == "apply_confidently"
        assert choices.APPLY_WITH_CAUTION == "apply_with_caution"
        assert choices.LIKELY_FAKE == "likely_fake"


class TestUserFeedback:
    def test_create(self, sample_listing, db):
        feedback = UserFeedback.objects.create(
            analysis=sample_listing,
            feedback_type="confirmed_fake",
            device_hash="d" * 64,
        )
        assert feedback.pk is not None
        assert feedback.analysis == sample_listing
        assert feedback.feedback_type == "confirmed_fake"

    def test_fk_relationship(self, sample_listing, db):
        UserFeedback.objects.create(
            analysis=sample_listing,
            feedback_type="confirmed_real",
            device_hash="e" * 64,
        )
        assert sample_listing.feedback.count() == 1

    def test_str(self, sample_listing, db):
        feedback = UserFeedback.objects.create(
            analysis=sample_listing,
            feedback_type="confirmed_fake",
            device_hash="f" * 64,
        )
        assert "confirmed_fake" in str(feedback)


class TestAPIUsageLog:
    def test_create(self, db):
        log = APIUsageLog.objects.create(
            device_hash="g" * 64,
            ip_address="192.168.1.1",
            endpoint="/api/v1/analyze",
            was_cached=False,
            response_ms=3000,
        )
        assert log.pk is not None
        assert log.ip_address == "192.168.1.1"
        assert log.was_cached is False

    def test_str(self, db):
        log = APIUsageLog.objects.create(
            device_hash="h" * 64,
            ip_address="10.0.0.1",
            endpoint="/api/v1/health",
            was_cached=True,
            response_ms=50,
        )
        assert "/api/v1/health" in str(log)
