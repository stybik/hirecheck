import time

from django.http import JsonResponse
from django.views.decorators.http import require_GET

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
                "primary": "gpt-4o-mini",
                "fallback": "gemini-1.5-flash",
            },
        }
    )
