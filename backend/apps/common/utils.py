"""Shared utility functions — hashing, rate limiting, HMAC verification."""

import hashlib
import hmac
import logging
import time

from django.conf import settings
from django.utils import timezone

logger = logging.getLogger(__name__)


def compute_url_hash(url: str) -> str:
    """SHA-256 of normalized URL (lowercase, strip trailing slash)."""
    normalized = url.lower().strip().rstrip("/")
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def compute_content_hash(job_title: str, company_name: str, description: str) -> str:
    """SHA-256 of job_title + company_name + first 500 chars of description."""
    content = f"{job_title}{company_name}{description[:500]}"
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def get_client_ip(request) -> str:
    """Extract client IP from X-Forwarded-For header or REMOTE_ADDR."""
    forwarded_for = request.META.get("HTTP_X_FORWARDED_FOR")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR", "")


def check_rate_limit(device_hash: str, ip_address: str, daily_limit: int) -> tuple[bool, int]:
    """Check if device/IP has exceeded daily analysis limit.

    Queries APIUsageLog for today's non-cached requests matching either
    device_hash OR ip_address. Returns (is_allowed, count_today).
    """
    from apps.analysis.models import APIUsageLog

    today_start = timezone.now().replace(hour=0, minute=0, second=0, microsecond=0)

    from django.db.models import Q

    count = APIUsageLog.objects.filter(
        Q(device_hash=device_hash) | Q(ip_address=ip_address),
        created_at__gte=today_start,
        endpoint="/api/v1/analyze/",
        was_cached=False,
    ).count()

    return (count < daily_limit, count)


def verify_hmac_signature(body_bytes: bytes, signature: str, timestamp_str: str) -> tuple[bool, str]:
    """Verify HMAC-SHA256 signature matching the extension's algorithm.

    Extension computes: HMAC-SHA256(secret, str(timestamp) + SHA256(body).hex())
    Returns (is_valid, error_reason).
    """
    secret = settings.HMAC_SECRET_KEY
    if not secret:
        return False, "HMAC secret not configured"

    # Validate timestamp
    try:
        timestamp = int(timestamp_str)
    except (ValueError, TypeError):
        return False, "Invalid timestamp"

    now = int(time.time())
    if abs(now - timestamp) > 300:
        return False, "Request timestamp expired"

    # Compute expected signature
    body_hash = hashlib.sha256(body_bytes).hexdigest()
    message = f"{timestamp}{body_hash}".encode()
    expected = hmac.new(secret.encode("utf-8"), message, hashlib.sha256).hexdigest()

    if not hmac.compare_digest(signature, expected):
        return False, "Invalid signature"

    return True, ""
