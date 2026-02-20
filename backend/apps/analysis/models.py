import uuid

from django.db import models


class AnalyzedListing(models.Model):
    """Cached AI analysis result for a job listing."""

    class Recommendation(models.TextChoices):
        APPLY_CONFIDENTLY = "apply_confidently", "Apply Confidently"
        APPLY_WITH_CAUTION = "apply_with_caution", "Apply with Caution"
        LIKELY_FAKE = "likely_fake", "Likely Fake"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    url_hash = models.CharField(max_length=64, unique=True)
    content_hash = models.CharField(max_length=64, db_index=True)
    platform = models.CharField(max_length=20, default="naukri")
    job_title = models.CharField(max_length=255)
    company_name = models.CharField(max_length=255)
    ghost_score = models.IntegerField(
        help_text="Composite score 0-100, computed server-side from category weights",
    )
    category_scores = models.JSONField(
        help_text="Per-category scores: ghost_signals, scam_signals, toxic_culture, market_reality",
    )
    red_flags = models.JSONField(
        help_text="Array of {category, signal, severity, explanation}",
    )
    recommendation = models.CharField(max_length=30, choices=Recommendation.choices)
    signals_checked = models.IntegerField(default=0, help_text="Total signals evaluated by the LLM")
    ai_model_used = models.CharField(max_length=50)
    tokens_used = models.IntegerField(default=0)
    response_ms = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "analyzed_listings"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["content_hash"], name="idx_content_hash"),
            models.Index(fields=["created_at"], name="idx_created_at"),
        ]

    def __str__(self):
        return f"{self.job_title} @ {self.company_name} (score: {self.ghost_score})"


class UserFeedback(models.Model):
    """User-submitted feedback on analysis accuracy."""

    class FeedbackType(models.TextChoices):
        CONFIRMED_REAL = "confirmed_real", "Confirmed Real"
        CONFIRMED_FAKE = "confirmed_fake", "Confirmed Fake"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    analysis = models.ForeignKey(
        AnalyzedListing,
        on_delete=models.CASCADE,
        related_name="feedback",
    )
    feedback_type = models.CharField(max_length=20, choices=FeedbackType.choices)
    device_hash = models.CharField(max_length=64)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "user_feedback"
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["analysis", "device_hash"],
                name="unique_feedback_per_device",
            ),
        ]

    def __str__(self):
        return f"{self.feedback_type} for {self.analysis_id}"


class APIUsageLog(models.Model):
    """Request log for rate limiting and analytics."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    device_hash = models.CharField(max_length=64, db_index=True)
    ip_address = models.GenericIPAddressField()
    endpoint = models.CharField(max_length=50)
    was_cached = models.BooleanField(default=False)
    model_used = models.CharField(max_length=50, default="")
    tokens_used = models.IntegerField(default=0)
    response_ms = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "api_usage_logs"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["device_hash", "created_at"], name="idx_device_date"),
            models.Index(fields=["ip_address", "created_at"], name="idx_ip_date"),
        ]

    def __str__(self):
        return f"{self.endpoint} from {self.device_hash[:8]}... at {self.created_at}"
