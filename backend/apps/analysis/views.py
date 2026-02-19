import logging
import time

from django.conf import settings
from django.core.cache import cache
from django.db import IntegrityError
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_POST

from apps.analysis.models import AnalyzedListing, APIUsageLog
from apps.analysis.schemas import AnalyzeRequest
from apps.analysis.services.ai_analyzer import AnalysisUnavailableError, analyze_job_listing
from apps.analysis.services.scoring import compute_ghost_score, score_to_recommendation
from apps.common.decorators import validate_json_body
from apps.common.utils import check_rate_limit, compute_content_hash, compute_url_hash, get_client_ip

logger = logging.getLogger(__name__)

START_TIME = time.time()


@require_GET
def health_check(request):
    """GET /api/v1/health/ — Service health for uptime monitoring (PRD R16)."""
    uptime_seconds = int(time.time() - START_TIME)
    return JsonResponse(
        {
            "status": "healthy",
            "version": "0.1.0",
            "uptime_seconds": uptime_seconds,
            "models": {
                "primary": "gemini-2.5-flash",
                "fallback": "gpt-4o-mini",
            },
        }
    )


@csrf_exempt
@require_POST
@validate_json_body(AnalyzeRequest)
def analyze(request):
    """POST /api/v1/analyze/ — Core analysis endpoint.

    HMAC validation handled by middleware upstream.
    Flow: rate limit → cache check → AI analysis → server-side scoring → persist → respond.
    """
    t_start = time.time()
    data: AnalyzeRequest = request.validated_data
    ip_address = get_client_ip(request)

    # 1. Rate limit check
    is_allowed, count_today = check_rate_limit(
        device_hash=data.device_fingerprint,
        ip_address=ip_address,
        daily_limit=settings.DAILY_ANALYSIS_LIMIT,
    )
    if not is_allowed:
        return JsonResponse(
            {
                "error": "rate_limit_exceeded",
                "message": "Daily analysis limit reached",
                "analyses_today": count_today,
                "daily_limit": settings.DAILY_ANALYSIS_LIMIT,
                "reset_at": _next_midnight_iso(),
            },
            status=429,
        )

    # 2. Dual-layer cache / DB lookup
    content_hash = compute_content_hash(data.job_title, data.company_name, data.description)
    url_hash = compute_url_hash(data.url) if data.url else f"manual:{content_hash}"

    cached_listing = _lookup_cached(url_hash, content_hash)
    if cached_listing is not None:
        response_ms = int((time.time() - t_start) * 1000)
        _log_request(
            data.device_fingerprint,
            ip_address,
            was_cached=True,
            response_ms=response_ms,
            model_used=cached_listing.ai_model_used,
            tokens_used=0,
        )
        return JsonResponse(_format_response(cached_listing, was_cached=True, count_today=count_today))

    # 3. AI analysis
    try:
        llm_response, model_used, tokens_used = analyze_job_listing(data.model_dump())
    except AnalysisUnavailableError:
        return JsonResponse(
            {
                "error": "analysis_unavailable",
                "message": "Unable to analyze this listing right now. Please try again in a few minutes.",
            },
            status=503,
        )

    # 4. Server-side scoring (never trust LLM arithmetic)
    category_scores_dict = llm_response.category_scores.model_dump()
    ghost_score = compute_ghost_score(category_scores_dict)
    recommendation = score_to_recommendation(ghost_score)

    # 5. Persist to DB (handle race condition: concurrent request may have inserted same url_hash)
    response_ms = int((time.time() - t_start) * 1000)
    try:
        listing = AnalyzedListing.objects.create(
            url_hash=url_hash,
            content_hash=content_hash,
            platform="naukri",
            job_title=data.job_title,
            company_name=data.company_name,
            ghost_score=ghost_score,
            category_scores=category_scores_dict,
            red_flags=[flag.model_dump() for flag in llm_response.red_flags],
            recommendation=recommendation,
            signals_checked=llm_response.signals_checked,
            ai_model_used=model_used,
            tokens_used=tokens_used,
            response_ms=response_ms,
        )
    except IntegrityError:
        # Concurrent request already inserted — fetch and return the existing record
        listing = AnalyzedListing.objects.filter(url_hash=url_hash).first()
        if listing is None:
            listing = AnalyzedListing.objects.filter(content_hash=content_hash).first()
        if listing is None:
            logger.error("IntegrityError but no existing listing found for url_hash=%s", url_hash[:16])
            return JsonResponse(
                {"error": "analysis_unavailable", "message": "Please try again in a moment."},
                status=503,
            )
        _log_request(
            data.device_fingerprint,
            ip_address,
            was_cached=True,
            response_ms=response_ms,
            model_used=model_used,
            tokens_used=tokens_used,
        )
        return JsonResponse(_format_response(listing, was_cached=True, count_today=count_today))

    # 6. Set both cache keys (24h TTL)
    _set_cache(url_hash, content_hash, listing)

    # 7. Log usage
    _log_request(
        data.device_fingerprint,
        ip_address,
        was_cached=False,
        response_ms=response_ms,
        model_used=model_used,
        tokens_used=tokens_used,
    )

    return JsonResponse(_format_response(listing, was_cached=False, count_today=count_today + 1))


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------

CACHE_TTL = 24 * 60 * 60  # 24 hours


def _lookup_cached(url_hash: str, content_hash: str) -> AnalyzedListing | None:
    """Two-tier cache lookup: URL hash → content hash, with DB fallback."""
    # Tier 1: URL hash
    pk = cache.get(f"url:{url_hash}")
    if pk:
        try:
            return AnalyzedListing.objects.get(pk=pk)
        except AnalyzedListing.DoesNotExist:
            cache.delete(f"url:{url_hash}")

    listing = AnalyzedListing.objects.filter(url_hash=url_hash).first()
    if listing:
        _set_cache(url_hash, content_hash, listing)
        return listing

    # Tier 2: Content hash (catches reposted jobs at different URLs)
    pk = cache.get(f"content:{content_hash}")
    if pk:
        try:
            return AnalyzedListing.objects.get(pk=pk)
        except AnalyzedListing.DoesNotExist:
            cache.delete(f"content:{content_hash}")

    listing = AnalyzedListing.objects.filter(content_hash=content_hash).first()
    if listing:
        cache.set(f"content:{content_hash}", str(listing.pk), CACHE_TTL)
        return listing

    return None


def _set_cache(url_hash: str, content_hash: str, listing: AnalyzedListing) -> None:
    """Store both cache keys pointing to the listing's PK."""
    pk_str = str(listing.pk)
    cache.set(f"url:{url_hash}", pk_str, CACHE_TTL)
    cache.set(f"content:{content_hash}", pk_str, CACHE_TTL)


def _format_response(listing: AnalyzedListing, was_cached: bool, count_today: int) -> dict:
    """Build the API response dict."""
    return {
        "analysis_id": str(listing.pk),
        "ghost_score": listing.ghost_score,
        "category_scores": listing.category_scores,
        "red_flags": listing.red_flags,
        "recommendation": listing.recommendation,
        "signals_checked": listing.signals_checked,
        "was_cached": was_cached,
        "model_used": listing.ai_model_used,
        "analyzed_at": listing.created_at.isoformat(),
        "analyses_today": count_today,
        "daily_limit": settings.DAILY_ANALYSIS_LIMIT,
    }


def _log_request(
    device_hash: str,
    ip_address: str,
    was_cached: bool,
    response_ms: int,
    model_used: str = "",
    tokens_used: int = 0,
) -> None:
    """Insert APIUsageLog row. Best-effort — never let logging crash the response."""
    try:
        APIUsageLog.objects.create(
            device_hash=device_hash,
            ip_address=ip_address or "127.0.0.1",
            endpoint="/api/v1/analyze/",
            was_cached=was_cached,
            model_used=model_used,
            tokens_used=tokens_used,
            response_ms=response_ms,
        )
    except Exception:
        logger.exception("Failed to write APIUsageLog")


def _next_midnight_iso() -> str:
    """Return ISO 8601 timestamp for next midnight, for rate limit reset."""
    now = timezone.now()
    tomorrow = (now + timezone.timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return tomorrow.isoformat()
