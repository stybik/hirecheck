# HireCheck - Project Setup Plan (Week 1 Foundation)

## Context
Setting up a monorepo for "HireCheck — Job Listing Lie Detector", a Chrome extension + Django backend that detects ghost jobs and scam listings on Naukri.com using AI analysis (GPT-4o-mini / Gemini 1.5 Flash). Phase 1 MVP, solo developer with Claude Code assistance.

## Choices Made
- **Package manager**: uv (auto-manages `.venv/` virtual environment)
- **Python**: 3.12
- **Repo**: Monorepo (`backend/` + `extension/`), remote: `git@github.com:stybik/hirecheck.git`
- **Local dev**: Native (no Docker)
- **API framework**: Plain Django + Pydantic v2 (no DRF)
- **Virtual env**: uv creates `.venv/` automatically; use `uv run <cmd>` to execute within it

---

## Why No DRF

With only 3 endpoints (health, analyze, feedback), DRF adds unnecessary complexity. Instead:
- **Request validation** → Pydantic v2 models (already needed for LLM response parsing)
- **Response serialization** → `django.http.JsonResponse` or custom `json_response()` helper
- **CORS** → `django-cors-headers` (works independently of DRF)
- **Rate limiting** → Custom middleware (was planned anyway)
- **Error handling** → Simple decorator or middleware

This removes `djangorestframework` from deps entirely and eliminates `serializers.py` files.

---

## Directory Structure

```
hirecheck/                               # remote: git@github.com:stybik/hirecheck.git
├── .github/workflows/ci.yml
├── backend/
│   ├── config/
│   │   ├── __init__.py
│   │   ├── settings/
│   │   │   ├── __init__.py              # env selector (DJANGO_ENV)
│   │   │   ├── base.py                  # shared settings + django-environ
│   │   │   ├── development.py           # DEBUG=True, DB cache, debug-toolbar
│   │   │   ├── production.py            # Redis cache, CORS locked, HTTPS
│   │   │   └── test.py                  # SQLite in-memory (respects DATABASE_URL if set)
│   │   ├── urls.py
│   │   ├── wsgi.py
│   │   └── asgi.py
│   ├── apps/
│   │   ├── analysis/                    # Core app
│   │   │   ├── models.py               # AnalyzedListing, UserFeedback, APIUsageLog
│   │   │   ├── views.py                # /api/v1/health endpoint (plain Django views)
│   │   │   ├── urls.py
│   │   │   ├── schemas.py              # Pydantic models for request/response validation
│   │   │   ├── admin.py
│   │   │   ├── apps.py
│   │   │   ├── migrations/
│   │   │   └── tests/
│   │   │       ├── test_models.py
│   │   │       └── test_health.py
│   │   └── common/                      # Shared utilities
│   │       ├── middleware.py            # HMAC validation stub
│   │       ├── decorators.py            # @require_json, @validate_body helpers
│   │       └── utils.py
│   ├── manage.py
│   └── conftest.py
├── extension/
│   ├── manifest.json                    # Manifest V3
│   ├── background/service-worker.js     # HMAC signing + API calls skeleton
│   ├── content/content.js               # Button injection skeleton
│   ├── content/content.css
│   ├── popup/popup.html
│   ├── popup/popup.js
│   ├── popup/popup.css
│   ├── lib/hmac.js                      # HMAC-SHA256 signing module (Web Crypto API)
│   └── icons/                           # Placeholder PNGs (16/48/128)
├── .env.example
├── .gitignore
├── .python-version                      # 3.12
├── pyproject.toml                       # uv project, all deps, ruff + pytest config
├── Makefile                             # setup, migrate, run, test, lint, format
└── README.md
```

**Key differences from previous plan:**
- No `serializers.py` — replaced by `schemas.py` (Pydantic models)
- Added `decorators.py` in common/ for JSON view helpers
- No `djangorestframework` in deps

---

## Implementation Steps (in order)

### Step 1: Git init + link remote + root files
- `git init` in current directory (`/Users/bikram/Drive/Projects/hirecheck/`)
- `git remote add origin git@github.com:stybik/hirecheck.git`
- `git fetch origin` (pull any existing content from remote)
- Create `.gitignore` (comprehensive: .env, .venv/, __pycache__, .DS_Store, db.sqlite3, etc.)
- Create `.python-version` → `3.12`
- Create `.env.example` with all env vars (Django, DB, AI keys, HMAC, Sentry)
- **Verify**: `git remote -v` shows `git@github.com:stybik/hirecheck.git`, `git status` shows untracked files

### Step 2: uv project + dependencies
- Create `pyproject.toml` with:
  - **Core deps**: django>=5.1, django-environ, django-cors-headers, psycopg[binary]>=3.2, pydantic>=2.9, sentry-sdk[django], openai, google-generativeai, gunicorn
  - **Dev deps**: pytest, pytest-django, pytest-cov, ruff, pre-commit, django-debug-toolbar, factory-boy
  - **Tool config**: ruff (py312, line-length 120, DJ rules), pytest (DJANGO_SETTINGS_MODULE, pythonpath)
- Run `uv sync --group dev` → creates `.venv/` automatically with Python 3.12
- **Verify**: `uv run python -c "import django; print(django.VERSION)"` works

### Step 3: Django project scaffold
- `cd backend && uv run django-admin startproject config .`
- Replace generated `config/settings.py` with `config/settings/` directory
- Create split settings: `__init__.py` (env selector), `base.py`, `development.py`, `production.py`, `test.py`
- Key settings in `base.py`: django-environ for .env loading, INSTALLED_APPS (corsheaders, apps.analysis, apps.common — NO rest_framework), TIME_ZONE=Asia/Kolkata
- Update `config/urls.py` to include `api/v1/` routes
- **Verify**: `uv run python manage.py check` passes

### Step 4: Analysis app + models
- Create analysis app with all 3 models from PRD:
  - `AnalyzedListing`: UUID PK, url_hash (unique indexed), content_hash (indexed), JSONB fields for category_scores and red_flags, TextChoices for recommendation
  - `UserFeedback`: UUID PK, FK to AnalyzedListing, TextChoices for feedback_type
  - `APIUsageLog`: UUID PK, composite indexes on (device_hash, created_at) and (ip_address, created_at)
- Create health endpoint view using plain Django (`JsonResponse`)
- Create Pydantic schemas stub in `schemas.py`
- Create JSON view helpers in `common/decorators.py`
- Create HMAC middleware stub in `common/middleware.py`
- **Verify**: `uv run python manage.py check` passes

### Step 5: Database + migrations
- Ensure local PostgreSQL has `hirecheck` database and user
- Copy `.env.example` → `.env` with local values
- `uv run python manage.py makemigrations analysis`
- `uv run python manage.py migrate`
- `uv run python manage.py createcachetable` (dev DB cache)
- **Verify**: tables created — analyzed_listings, user_feedback, api_usage_logs

### Step 6: Tests
- Create `backend/conftest.py`
- Write model tests (creation, uniqueness constraints, FK relationships)
- Write health endpoint test (status 200, correct response shape) using Django's `TestClient`
- **Verify**: `uv run pytest` all green

### Step 7: Chrome extension skeleton
- Create `extension/manifest.json` (Manifest V3, permissions: activeTab + storage, host_permissions: naukri.com)
- Create `extension/lib/hmac.js` (HMAC-SHA256 via Web Crypto API)
- Create `extension/background/service-worker.js` (message listener scaffold)
- Create `extension/content/content.js` (floating button injection on Naukri job pages)
- Create `extension/content/content.css` (button styling)
- Create `extension/popup/` (popup.html, popup.js, popup.css — shell UI with manual paste textarea)
- Generate placeholder icons (16/48/128 px)
- **Verify**: Load unpacked in Chrome, extension loads without errors

### Step 8: CI/CD pipeline
- Create `.github/workflows/ci.yml`:
  - `lint` job: ruff check + format check
  - `test` job: pytest with PostgreSQL 16 service container + coverage
  - `extension-lint` job: validate manifest.json
- **Verify**: YAML is valid

### Step 9: Makefile + README
- Create `Makefile` with targets: setup, migrate, makemigrations, run, test, lint, format, shell
- Create `README.md` with prerequisites, setup instructions, dev workflow
- **Verify**: `make test` passes, `make run` starts server, `curl localhost:8000/api/v1/health/` returns JSON

### Step 10: Initial git commit + push
- Stage all files, verify no secrets via `.gitignore`
- Commit: "feat: initial project setup — Django backend, Chrome extension skeleton, CI/CD"
- Push to `git@github.com:stybik/hirecheck.git`

---

## Key Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| django | >=5.1 | Web framework |
| django-environ | >=0.11 | .env loading |
| django-cors-headers | >=4.4 | CORS (R18) |
| psycopg[binary] | >=3.2 | PostgreSQL adapter (v3) |
| pydantic | >=2.9 | Request/response validation + LLM output parsing |
| sentry-sdk[django] | >=2.17 | Error tracking |
| openai | >=1.50 | GPT-4o-mini |
| google-generativeai | >=0.8 | Gemini 1.5 Flash |
| gunicorn | >=23.0 | Production WSGI |
| ruff | >=0.8 | Linter + formatter |
| pytest + pytest-django | >=8.3 | Testing |

**Removed**: `djangorestframework` — replaced by plain Django views + Pydantic

---

## Virtual Environment Details

uv handles the virtual environment automatically:
- `uv sync` → creates `.venv/` in project root with Python 3.12
- `uv run <command>` → executes within the venv (no manual activation needed)
- `source .venv/bin/activate` → optional manual activation if preferred
- `.venv/` is in `.gitignore` — never committed

---

## Plain Django API Pattern (replacing DRF)

### View pattern:
```python
import json
from django.http import JsonResponse
from django.views.decorators.http import require_GET

@require_GET
def health_check(request):
    return JsonResponse({
        "status": "healthy",
        "version": "0.1.0",
    })
```

### Request validation pattern (Week 2):
```python
from pydantic import BaseModel, ValidationError

class AnalyzeRequest(BaseModel):
    url: str | None = None
    job_title: str
    company_name: str
    description: str
    # ... etc

def analyze(request):
    try:
        data = AnalyzeRequest.model_validate_json(request.body)
    except ValidationError as e:
        return JsonResponse({"errors": e.errors()}, status=400)
    # ... process
```

---

## Django Settings Architecture

**Approach: Split settings directory with `django-environ`**

### `backend/config/settings/__init__.py`
Reads `DJANGO_ENV` env var (defaults to `"development"`) and imports the corresponding module.

### `backend/config/settings/base.py`
- `environ.Env()` with typed defaults
- `env.read_env()` for `.env` file
- SECRET_KEY, HMAC_SECRET_KEY, OPENAI_API_KEY, GEMINI_API_KEY from env
- INSTALLED_APPS: corsheaders, apps.analysis, apps.common (NO rest_framework)
- MIDDLEWARE: CorsMiddleware included
- TIME_ZONE = "Asia/Kolkata", USE_TZ = True
- DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
- Sentry init (only if DSN present)

### `backend/config/settings/development.py`
- DEBUG = True, DB cache, debug-toolbar, CORS_ALLOW_ALL_ORIGINS = True

### `backend/config/settings/production.py`
- DEBUG = False, Redis cache, CORS restricted to chrome-extension://, HTTPS headers

### `backend/config/settings/test.py`
- SQLite in-memory (PostgreSQL if DATABASE_URL set), LocMem cache, Sentry disabled

---

## Data Models (from PRD)

### AnalyzedListing
```
id              UUID (PK, auto)
url_hash        VARCHAR(64)  — SHA-256 of normalized URL (unique, indexed)
content_hash    VARCHAR(64)  — SHA-256 of title+company+desc[:500] (indexed)
platform        VARCHAR(20)  — 'naukri' (extensible)
job_title       VARCHAR(255)
company_name    VARCHAR(255)
ghost_score     INTEGER 0-100 (computed server-side)
category_scores JSONB — {ghost_signals, scam_signals, toxic_culture, market_reality}
red_flags       JSONB — [{category, signal, severity, explanation}]
recommendation  VARCHAR(30) — TextChoices enum
ai_model_used   VARCHAR(50)
tokens_used     INTEGER
response_ms     INTEGER
created_at      TIMESTAMP (auto)
```

### UserFeedback
```
id              UUID (PK, auto)
analysis_id     UUID (FK → AnalyzedListing, CASCADE)
feedback_type   VARCHAR(20) — 'confirmed_real' | 'confirmed_fake'
device_hash     VARCHAR(64)
created_at      TIMESTAMP (auto)
```

### APIUsageLog
```
id              UUID (PK, auto)
device_hash     VARCHAR(64) (indexed with created_at)
ip_address      INET (indexed with created_at)
endpoint        VARCHAR(50)
was_cached      BOOLEAN
response_ms     INTEGER
created_at      TIMESTAMP (auto)
```

---

## Verification Checklist (End-to-End)

After all steps complete:
1. `uv run pytest` → all tests pass
2. `make run` → Django dev server starts on :8000
3. `curl http://localhost:8000/api/v1/health/` → `{"status":"healthy","version":"0.1.0",...}`
4. Load `extension/` as unpacked Chrome extension → loads without errors
5. Visit any Naukri job listing page → "Analyze This Job" button appears
6. Click extension icon → popup opens with shell UI
7. `git log` → clean initial commit
8. `git remote -v` → points to `git@github.com:stybik/hirecheck.git`
