"""Custom middleware for the HireCheck API."""

import logging

from django.http import JsonResponse

from apps.common.utils import verify_hmac_signature

logger = logging.getLogger(__name__)

# Paths that skip HMAC validation
HMAC_EXEMPT_PATHS = {
    "/api/v1/health/",
}


class HMACValidationMiddleware:
    """Validate HMAC-SHA256 signatures on API requests.

    Skips validation for non-API paths and exempt endpoints (health).
    Returns 401 for missing headers, 403 for invalid signatures.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        # Skip non-API paths and exempt endpoints
        if not request.path.startswith("/api/v1/") or request.path in HMAC_EXEMPT_PATHS:
            return self.get_response(request)

        # Extract HMAC headers
        signature = request.META.get("HTTP_X_EXTENSION_SIGNATURE")
        timestamp = request.META.get("HTTP_X_TIMESTAMP")

        if not signature or not timestamp:
            return JsonResponse({"error": "missing_signature"}, status=401)

        # Read raw body for HMAC verification
        body_bytes = request.body

        is_valid, reason = verify_hmac_signature(body_bytes, signature, timestamp)
        if not is_valid:
            logger.warning("HMAC validation failed: %s (path=%s)", reason, request.path)
            return JsonResponse({"error": "invalid_signature"}, status=403)

        return self.get_response(request)
