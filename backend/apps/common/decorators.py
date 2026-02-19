"""View decorators for JSON API endpoints."""

import json
from functools import wraps

from django.http import JsonResponse
from pydantic import ValidationError


def validate_json_body(schema_class):
    """Decorator that parses and validates request JSON body against a Pydantic model.

    On success, attaches validated model instance to request.validated_data.
    On failure, returns 400/415 JsonResponse with error details.
    """

    def decorator(view_func):
        @wraps(view_func)
        def wrapper(request, *args, **kwargs):
            content_type = request.content_type or ""
            if "application/json" not in content_type:
                return JsonResponse({"error": "Content-Type must be application/json"}, status=415)

            try:
                body = json.loads(request.body)
            except (json.JSONDecodeError, ValueError) as e:
                return JsonResponse({"error": "Invalid JSON", "detail": str(e)}, status=400)

            try:
                validated = schema_class.model_validate(body)
            except ValidationError as e:
                return JsonResponse(
                    {"error": "Validation failed", "details": e.errors(include_url=False, include_context=False)},
                    status=400,
                )

            request.validated_data = validated
            return view_func(request, *args, **kwargs)

        return wrapper

    return decorator
