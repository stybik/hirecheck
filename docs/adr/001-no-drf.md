# ADR-001: Plain Django Views Instead of DRF

## Status
Accepted

## Context
The project needs a JSON API for the Chrome extension to communicate with the backend. Django REST Framework (DRF) is the conventional choice for Django APIs.

## Decision
Use plain Django views (`JsonResponse` + `@require_GET`/`@require_POST`) with Pydantic v2 for request/response validation instead of DRF.

## Rationale
- The API surface is small (3-4 endpoints) — DRF's viewsets, routers, and serializer layer add unnecessary complexity
- Pydantic v2 is already a dependency for validating LLM responses — using it for request validation avoids two validation layers
- No need for DRF's authentication, pagination, or browsable API features
- Reduces dependency count and attack surface
- Simpler debugging — plain Django views are easier to reason about

## Consequences
- No browsable API (acceptable for an extension-only backend)
- Must manually handle content negotiation (always JSON, so trivial)
- Pydantic schemas live in `schemas.py` files instead of DRF `serializers.py`
