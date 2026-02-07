# Architecture

## System Overview

HireCheck is a ghost job and scam listing detector for Naukri.com, consisting of two components:

1. **Chrome Extension** (Manifest V3) — extracts job listing data from Naukri.com pages
2. **Django Backend** — receives listing data, runs AI analysis, returns scores and red flags

```
┌─────────────────┐     HMAC-signed POST      ┌──────────────────┐
│ Chrome Extension │ ──────────────────────────▶│  Django Backend   │
│   (content.js)   │                            │  /api/v1/analyze  │
│                  │◀─────────────────────────── │                  │
│   Shows score    │     JSON response          │  GPT-4o-mini /   │
│   + red flags    │                            │  Gemini fallback  │
└─────────────────┘                            └──────────────────┘
                                                       │
                                                       ▼
                                                ┌──────────────┐
                                                │ PostgreSQL 16 │
                                                │  (cache +     │
                                                │   analytics)  │
                                                └──────────────┘
```

## Data Flow

1. User visits a Naukri.com job listing page
2. Content script extracts: URL, title, company, description, requirements, salary, posting date
3. Extension computes URL hash + content hash for deduplication
4. Service worker signs the request with HMAC-SHA256
5. Backend checks cache (URL hash → existing analysis)
6. If miss: sends job data to GPT-4o-mini (or Gemini 1.5 Flash on failure)
7. AI returns per-category scores; backend computes weighted ghost_score
8. Response cached and returned to extension
9. Extension renders score badge, red flags, and recommendation

## Scoring Formula

```
ghost_score = round(
    ghost_signals   * 0.30 +
    scam_signals    * 0.25 +
    toxic_culture   * 0.20 +
    market_reality  * 0.25
)
```

Each category score is 0-100, returned by the AI model.

## Database Models

### AnalyzedListing
Primary cache and analytics store. Keyed by `url_hash` (unique) with `content_hash` for detecting listing updates.

### UserFeedback
User-submitted corrections (confirmed_real / confirmed_fake). FK to AnalyzedListing.

### APIUsageLog
Per-request logging for rate limiting and analytics. Indexed on (device_hash, created_at) and (ip_address, created_at).

## Settings Architecture

Split settings pattern using `DJANGO_ENV` environment variable:

| File | Purpose |
|------|---------|
| `base.py` | Shared settings, env var loading via django-environ |
| `development.py` | DEBUG=True, PostgreSQL, DB cache, debug toolbar |
| `test.py` | SQLite in-memory (or PostgreSQL via TEST_DATABASE_URL) |
| `production.py` | DEBUG=False, Redis cache, HTTPS, restricted CORS |
