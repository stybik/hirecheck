# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

HireCheck is a Chrome extension + Django backend that detects ghost jobs, scam listings, and toxic workplace signals on Naukri.com using AI analysis (Gemini 2.5 Flash primary, GPT-4o-mini fallback). Phase 1 MVP targeting Naukri.com only.

## Commands

```bash
make setup              # Install deps (uv sync), copy .env.example → .env
make run                # Django dev server at localhost:8000
make test               # Run all tests (pytest)
make lint               # Ruff linter check
make format             # Ruff auto-format
make migrate            # Apply Django migrations
make makemigrations     # Generate migrations from model changes
make shell              # Django interactive shell
make createcachetable   # Create DB cache table (dev uses DB cache)
```

### Running a single test
```bash
uv run pytest backend/apps/analysis/tests/test_health.py::TestHealthEndpoint::test_returns_200 -v
uv run pytest -k test_returns_200
```

### uv is the package manager
All Python commands go through `uv run`. The virtual environment at `.venv/` is managed automatically. PATH may need `$HOME/.local/bin` and `/opt/homebrew/opt/postgresql@16/bin` on macOS.

## Architecture

**Monorepo**: `backend/` (Django API) + `extension/` (Chrome Manifest V3)

### Backend (Django 5.x — NO DRF)

- **No Django REST Framework**. API uses plain `JsonResponse` + `@require_GET`/`@require_POST` decorators.
- **Pydantic v2** replaces DRF serializers. Validation models go in `schemas.py` (not `serializers.py`).
- All endpoints under `/api/v1/` via `apps.analysis.urls`.
- Split settings selected by `DJANGO_ENV` env var (default: `development`):
  - `config/settings/base.py` — shared (reads `.env` via django-environ)
  - `config/settings/development.py` — DEBUG=True, DB cache, debug toolbar, permissive CORS
  - `config/settings/test.py` — SQLite in-memory (CI overrides via `TEST_DATABASE_URL`)
  - `config/settings/production.py` — Redis cache, HTTPS headers, CORS locked to chrome-extension://

### Data Models (apps/analysis/models.py)

- `AnalyzedListing` — cached AI analysis with dual-key dedup (url_hash unique, content_hash indexed), JSONB for category_scores and red_flags, TextChoices for recommendation
- `UserFeedback` — FK to AnalyzedListing, confirmed_real/confirmed_fake
- `APIUsageLog` — rate limiting via composite indexes on (device_hash, created_at) and (ip_address, created_at)

All models use UUID primary keys and explicit `db_table` names.

### Chrome Extension (extension/)

- Manifest V3 with `activeTab` + `storage` permissions, host_permissions for `naukri.com`
- Content script injects "Analyze" button on job listing pages, extracts data via 3-tier CSS selector fallback
- Service worker handles HMAC-SHA256 signing (Web Crypto API), API calls, and local history (chrome.storage.local, last 50)
- HMAC auth: `X-Extension-Signature` + `X-Timestamp` headers on every request

## Key Gotchas

- `django-environ`'s `env.read_env()` populates `os.environ` — `.env` values leak into test settings. Tests use `TEST_DATABASE_URL` (not `DATABASE_URL`) to avoid this.
- Django CSRF middleware is `CsrfViewMiddleware`, not `CsrfMiddleware`.
- Ruff excludes migration files: `exclude = ["backend/apps/*/migrations/*.py"]` in pyproject.toml.
- `uv run` must execute from project root (where `pyproject.toml` lives) or from `backend/`.
- pytest pythonpath is set to `["backend"]` so imports use `from apps.analysis.models import ...`.

## Linting

Ruff with `line-length = 120`, target Python 3.12. Rules: E, F, I, N, W, UP, B, SIM, DJ. isort knows `apps` and `config` as first-party.

## Testing

pytest-django with `DJANGO_SETTINGS_MODULE = "config.settings.test"`. Tests use `db` fixture from pytest-django. Class-based test organization with `@pytest.fixture` for model factories.
