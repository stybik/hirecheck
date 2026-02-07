# HireCheck Phase 1 — Implementation Plan

> **PRD**: `Job_Listing_Lie_Detector_Phase1_PRD.docx` v1.1
> **Timeline**: 6 weeks (Weeks 1–6)
> **Detailed plans**: Each phase has a dedicated `docs/plans/week-N-plan.md`

---

## Current State (Week 1 — COMPLETE)

| Component | Status | Details |
|-----------|--------|---------|
| Django project scaffold | Done | Split settings (base/dev/test/prod), django-environ, CORS |
| Data models | Done | AnalyzedListing, UserFeedback, APIUsageLog — all migrated |
| Health endpoint | Done | `GET /api/v1/health/` returning version, uptime, model info |
| Chrome extension skeleton | Done | Manifest V3, content script with 3-tier DOM extraction, popup UI, HMAC signing module, service worker with API call + history |
| CI/CD | Done | GitHub Actions — lint (ruff) + test (pytest + PostgreSQL 16) + extension manifest validation |
| Tests | Done | 14 passing (model tests + health endpoint tests) |
| Admin | Done | All 3 models registered |
| Docs | Done | ADR-001 (no DRF), architecture, API reference, changelog |

---

## Phase Overview

```
Week 1  ██████████  Foundation          ✅ COMPLETE
Week 2  ░░░░░░░░░░  AI Engine           ← YOU ARE HERE
Week 3  ░░░░░░░░░░  Content Script
Week 4  ░░░░░░░░░░  Integration
Week 5  ░░░░░░░░░░  Polish
Week 6  ░░░░░░░░░░  Launch Prep
```

---

## Week 2 — AI Engine

**Goal**: Build the core AI analysis service — the backend brain that takes job listing data and returns scored analysis.

### Deliverables

1. **Pydantic schemas** (`schemas.py`)
   - `AnalyzeRequest` — validate incoming POST body (url, job_title, company_name, description, requirements, salary_text, posting_date, source, device_fingerprint)
   - `LLMResponse` — validate/parse LLM JSON output (category_scores, red_flags, recommendation, signals_checked)
   - `AnalyzeResponse` — shape the API response back to extension

2. **AI analysis service** (`services/ai_analyzer.py`)
   - System prompt from PRD Section 9 — tuned for Indian job market
   - **Gemini 2.5 Flash primary** (free tier: 250 RPD, 10 RPM — covers early users at zero cost)
   - **GPT-4o-mini fallback** (paid, $0.15/M input — kicks in if Gemini fails or hits rate limit)
   - JSON response parsing: strip markdown code fences, validate against `LLMResponse` schema
   - Retry logic: on parse failure, retry once with stricter prompt; on second failure return "analysis unavailable"
   - Log all parse failures to Sentry

3. **Server-side score computation** (`services/scoring.py`)
   - Weighted composite: `ghost_score = round(ghost_signals * 0.30 + scam_signals * 0.25 + toxic_culture * 0.20 + market_reality * 0.25)`
   - Recommendation mapping: 0–30 → apply_confidently, 31–60 → apply_with_caution, 61–100 → likely_fake
   - Never trust LLM for arithmetic

4. **HMAC validation middleware** (`common/middleware.py`)
   - Validate `X-Extension-Signature` + `X-Timestamp` headers
   - Reject if timestamp > 5 minutes old
   - Reject if HMAC signature doesn't match `HMAC(secret, timestamp + SHA256(body))`
   - Skip for health endpoint and non-API paths

5. **POST /api/v1/analyze endpoint** (`views.py`)
   - Accept JSON body, validate with Pydantic
   - Check rate limit (5/day per device_hash + IP)
   - Check cache (URL hash first, then content hash, TTL 24h)
   - If cache miss → call AI analyzer → compute score → save to DB → return
   - Log to APIUsageLog

6. **Request validation decorator** (`common/decorators.py`)
   - `@validate_json_body(SchemaClass)` — parse request body against Pydantic model, return 400 on failure

7. **Utility functions** (`common/utils.py`)
   - `compute_content_hash(job_title, company_name, description)` — SHA-256
   - `compute_url_hash(url)` — SHA-256 of normalized URL
   - Rate limit check helpers

8. **Tests**
   - Unit tests for scoring computation (edge cases: 0, 100, boundary values)
   - Unit tests for HMAC validation (valid, expired, tampered)
   - Unit tests for LLM response parsing (valid JSON, code-fenced JSON, malformed JSON)
   - Integration test for `/api/v1/analyze` (mocked LLM, full request cycle)
   - Rate limit enforcement tests

### Dependencies
- Gemini API key provisioned and in `.env` (free tier, no credit card needed)
- OpenAI API key provisioned and in `.env` (fallback — needs billing setup)
- HMAC secret synchronized between `.env` and extension's `hmac.js`

### Key Risks
- LLM response format instability — mitigated by Pydantic validation + retry + code-fence stripping
- Gemini free tier rate limits (250 RPD) — mitigated by 24h caching + content hash dedup + GPT-4o-mini fallback
- Gemini free tier could be reduced further by Google — GPT-4o-mini fallback ensures continuity

---

## Week 3 — Content Script Refinement

**Goal**: Harden the DOM extraction, wire up the full content-script-to-background-worker pipeline, and add manual paste fallback.

### Deliverables

1. **DOM extraction hardening**
   - Test all 6 data point selectors against real Naukri pages (title, company, description, requirements, salary, posting date)
   - Add regex-based fallbacks for salary (`/\d+\s*-\s*\d+\s*(LPA|lakh)/`) and posting date (`/posted\s+\d+\s+days?\s+ago/i`)
   - Description truncation to 3000 tokens (estimate ~4 chars/token)
   - Graceful degradation: if all selectors fail, show "Unable to extract — paste manually" prompt

2. **Content hash computation in extension**
   - SHA-256 of `job_title + company_name + first 500 chars of description`
   - URL hash: SHA-256 of normalized job URL
   - Send both hashes in API request for server-side dedup

3. **Manual paste mode refinements**
   - Already built in popup — wire up to same analysis flow
   - Source field: `"dom_extraction"` vs `"manual_paste"`

4. **Device fingerprinting**
   - Already implemented (`crypto.randomUUID()` in `chrome.storage.local`)
   - Verify it persists across browser sessions
   - Send as `device_fingerprint` in request body and `X-Device-Hash` header

5. **Message passing audit**
   - Content script → service worker → API → service worker → content script
   - Error propagation at each hop
   - Timeout handling (10s total budget)

6. **Cached Naukri page snapshot for CI**
   - Save 2-3 representative Naukri job detail page HTMLs
   - Automated test verifying primary selectors match

7. **Tests**
   - DOM selector tests against cached HTML snapshots
   - Hash computation tests
   - Message passing integration tests (mock chrome APIs)

### Dependencies
- Week 2 `/api/v1/analyze` endpoint must be working
- Access to real Naukri job listing pages for selector testing

---

## Week 4 — End-to-End Integration

**Goal**: Wire everything together into a working product. Button click → extract → sign → analyze → display results.

### Deliverables

1. **Full E2E flow**
   - Click "Analyze This Job" → extract DOM data → compute hashes → HMAC-sign → POST to backend → display results in popup
   - Verify with real Naukri listings (manual QA)

2. **Popup results UI polish**
   - Ghost Score gauge with color coding (green ≤30, yellow ≤60, red >60)
   - Top 3 red flag cards with severity badges and explanations
   - Per-category score bar chart (ghost_signals, scam_signals, toxic_culture, market_reality)
   - Recommendation badge (Apply Confidently / Apply with Caution / Likely Fake)
   - AI accuracy disclaimer on every result (PRD Section 5.3)

3. **Dual-layer caching verification**
   - URL hash cache: same URL returns cached result < 200ms
   - Content hash cache: reposted job at different URL detected
   - 24h TTL based on `created_at` timestamp
   - `was_cached` flag in response

4. **Rate limiting UI**
   - Show remaining free analyses today (X/5)
   - Display upgrade CTA when limit reached
   - Handle 429 response gracefully with reset timestamp

5. **Error handling**
   - Network failure → "Check your connection" + retry button
   - 429 → "Daily limit reached" + reset time
   - 403 → "Authentication error" (shouldn't happen in normal use)
   - 503 → "Analysis unavailable, try again shortly"
   - JSON parse → never exposed to user, always friendly message

6. **Tests**
   - E2E test: mock Naukri page → extension extracts → API returns analysis (manual QA checklist)
   - Cache hit/miss tests
   - Rate limit boundary tests (5th request OK, 6th blocked)
   - Error response handling tests

### Dependencies
- Week 2 backend fully working
- Week 3 content script fully working
- Real Naukri pages for QA testing

---

## Week 5 — Polish & Compliance

**Goal**: Add secondary features, handle edge cases, prepare for Chrome Web Store submission.

### Deliverables

1. **Analysis history**
   - Popup tab/section showing last 50 analyses from `chrome.storage.local`
   - Each entry: job title, company, ghost score, date, recommendation badge
   - Tap to view full analysis details
   - "Clear history" button
   - No cross-device sync (local only)

2. **Feedback system**
   - "This was actually real" / "Confirmed suspicious" buttons on each result
   - `POST /api/v1/feedback` endpoint
   - Feedback stored in `UserFeedback` table
   - Confirmation toast after submission
   - One feedback per analysis per device

3. **Edge case handling**
   - Very long descriptions (>12000 chars) — truncate to 3000 tokens
   - Missing fields (no salary, no posting date) — handled gracefully
   - Naukri layout variants (search results page vs direct job page)
   - Rapid double-clicks on Analyze button — debounce
   - Extension loaded on non-Naukri pages — no button shown

4. **Loading states & animations**
   - Skeleton UI while analysis in progress
   - Smooth transitions between states
   - Empty state for first-time users

5. **Privacy policy page**
   - DPDP Act 2023 compliant
   - Discloses: PII stored (IP, device hash, job data), 90-day log retention, indefinite analysis cache
   - Required for Chrome Web Store submission
   - Simple HTML page, hostable as GitHub Pages or standalone

6. **Chrome Web Store assets**
   - Extension icon (128x128 store icon)
   - Screenshots (1280x800) — popup with results, floating button on Naukri
   - Promotional tile (440x280)
   - Store description (short + detailed)

7. **Landing page**
   - One-pager HTML explaining what HireCheck does
   - Link to Chrome Web Store listing
   - Ghost job statistics for India
   - How it works (3-step visual)

8. **Tests**
   - Feedback endpoint tests
   - History storage/retrieval tests
   - Edge case tests (missing fields, truncation)

### Dependencies
- Week 4 E2E flow working
- Chrome Web Store Developer Account ($5 one-time fee)
- Design assets for store listing

---

## Week 6 — Launch Prep & Submission

**Goal**: Submit to Chrome Web Store, load test, set up monitoring, and launch.

### Deliverables

1. **Chrome Web Store submission**
   - Package extension as `.zip`
   - Fill store listing (description, screenshots, privacy policy URL)
   - Submit for review (1–3 business days typical)
   - Manifest V3 compliance verified

2. **Automated DOM selector tests**
   - CI job that runs cached Naukri page snapshot tests
   - Alerts if primary selectors fail (weekly cron schedule)

3. **Load testing**
   - Simulate 100 concurrent analysis requests
   - Verify p95 < 5s, p50 < 3s
   - Cached retrieval < 200ms
   - Database connection pool holds
   - Rate limiting works under load

4. **Sentry alerting**
   - Alert on >1% error rate
   - Alert on JSON parse failure rate >5%
   - Alert on LLM failover activation
   - Alert on rate limit spike (abuse detection)

5. **Production deployment**
   - EC2 t3.small + RDS db.t3.micro (or equivalent)
   - Gunicorn + nginx config
   - SSL certificate (Let's Encrypt or AWS ACM)
   - Environment variables in production
   - Redis for production cache (ElastiCache or local)

6. **Launch activities**
   - Post on r/developersIndia (300K+ members)
   - Twitter/X announcement with ghost job stats
   - Monitor for first 48 hours
   - Hotfix pipeline ready

7. **Smoke tests**
   - Production health endpoint
   - Full analysis cycle in production
   - Extension communicating with production backend
   - CORS properly blocking non-extension origins

### Dependencies
- Weeks 2–5 all complete
- AWS infrastructure provisioned
- Chrome Web Store developer account active
- All API keys in production environment

---

## Critical Path

```
Week 1 (Done) → Week 2 (AI Engine) → Week 4 (Integration)
                                    ↗
                Week 3 (Content Script) → Week 4 (Integration) → Week 5 (Polish) → Week 6 (Launch)
```

**The bottleneck is Week 2**: The AI engine is the core product differentiator. Everything downstream depends on it working correctly.

Week 3 can partially overlap with Week 2 (content script hardening is independent of backend), but Week 4 integration requires both.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│  Chrome Extension (Manifest V3)                              │
│  ┌──────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │ Content   │→│ Service      │→│ Popup UI                │ │
│  │ Script    │  │ Worker       │  │ (Results/History/Paste) │ │
│  │ (DOM      │  │ (HMAC Sign,  │  │                        │ │
│  │  Extract) │  │  API Call,   │  └────────────────────────┘ │
│  └──────────┘  │  History)    │                              │
│                 └──────┬───────┘                              │
└────────────────────────┼─────────────────────────────────────┘
                         │ HTTPS + HMAC Headers
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  Django Backend                                              │
│  ┌────────────┐  ┌──────────────┐  ┌──────────────────────┐ │
│  │ HMAC       │→│ Rate Limiter │→│ Cache Check            │ │
│  │ Middleware  │  │ (5/day)      │  │ (URL hash →           │ │
│  └────────────┘  └──────────────┘  │  content hash)        │ │
│                                     └──────────┬───────────┘ │
│                                          miss  │  hit         │
│                          ┌─────────────────────┤             │
│                          ▼                     ▼             │
│  ┌─────────────────────────────────┐  ┌──────────────────┐  │
│  │ AI Analyzer Service             │  │ Return cached     │  │
│  │ ┌───────────┐ ┌───────────────┐ │  │ result (<200ms)   │  │
│  │ │ Gemini    │ │ GPT-4o-mini  │ │  └──────────────────┘  │
│  │ │ 2.5 Flash │ │              │ │                          │
│  │ │ (primary) │ │ (fallback)   │ │                          │
│  │ └─────┬─────┘ └──────┬──────┘ │                          │
│  │       └───────┬───────┘        │                          │
│  │               ▼                │                          │
│  │  Pydantic Parse + Score Calc   │                          │
│  └────────────────┬────────────────┘                          │
│                   ▼                                           │
│  ┌──────────────────────────────────┐                        │
│  │ PostgreSQL                        │                        │
│  │ analyzed_listings | user_feedback │                        │
│  │ api_usage_logs                    │                        │
│  └──────────────────────────────────┘                        │
└─────────────────────────────────────────────────────────────┘
```

---

## File Structure (Final State)

```
hirecheck/
├── backend/
│   ├── apps/
│   │   ├── analysis/
│   │   │   ├── models.py          ✅ Week 1
│   │   │   ├── views.py           ⬜ Week 2 (analyze endpoint) + Week 5 (feedback)
│   │   │   ├── urls.py            ⬜ Week 2 (add routes)
│   │   │   ├── schemas.py         ⬜ Week 2 (Pydantic models)
│   │   │   ├── admin.py           ✅ Week 1
│   │   │   ├── services/
│   │   │   │   ├── ai_analyzer.py ⬜ Week 2
│   │   │   │   └── scoring.py     ⬜ Week 2
│   │   │   └── tests/
│   │   │       ├── test_models.py ✅ Week 1
│   │   │       ├── test_health.py ✅ Week 1
│   │   │       ├── test_analyze.py⬜ Week 2
│   │   │       ├── test_scoring.py⬜ Week 2
│   │   │       ├── test_hmac.py   ⬜ Week 2
│   │   │       └── test_feedback.py⬜ Week 5
│   │   └── common/
│   │       ├── middleware.py      ⬜ Week 2 (HMAC validation)
│   │       ├── decorators.py      ⬜ Week 2 (JSON body validation)
│   │       └── utils.py           ⬜ Week 2 (hashing, rate limit)
│   └── config/
│       └── settings/
│           ├── base.py            ✅ Week 1
│           ├── development.py     ✅ Week 1
│           ├── test.py            ✅ Week 1
│           └── production.py      ✅ Week 1
├── extension/
│   ├── manifest.json              ✅ Week 1
│   ├── background/service-worker.js ✅ Week 1 (refine Week 3)
│   ├── content/content.js         ✅ Week 1 (harden Week 3)
│   ├── content/content.css        ✅ Week 1
│   ├── popup/popup.html           ✅ Week 1 (polish Week 4-5)
│   ├── popup/popup.js             ✅ Week 1 (polish Week 4-5)
│   ├── popup/popup.css            ✅ Week 1 (polish Week 4-5)
│   └── lib/hmac.js                ✅ Week 1
├── docs/
│   ├── plans/
│   │   ├── week-2-plan.md         ⬜ Detailed AI engine plan
│   │   ├── week-3-plan.md         ⬜ Detailed content script plan
│   │   ├── week-4-plan.md         ⬜ Detailed integration plan
│   │   ├── week-5-plan.md         ⬜ Detailed polish plan
│   │   └── week-6-plan.md         ⬜ Detailed launch plan
│   ├── privacy-policy.html        ⬜ Week 5
│   └── landing/index.html         ⬜ Week 5
├── tests/
│   └── fixtures/
│       └── naukri_snapshots/       ⬜ Week 3 (cached HTML for selector tests)
└── implementation.md               ← THIS FILE
```

---

## Open Decisions

| # | Question | Needed By | Notes |
|---|----------|-----------|-------|
| 1 | HMAC secret rotation strategy — hardcoded in extension means CWS re-review on rotation | Week 2 | Consider versioned secrets with grace period |
| 2 | Where to host privacy policy + landing page? | Week 5 | GitHub Pages (free) vs subdomain |
| 3 | Minimum AI accuracy before launch? | Week 3 | PRD proposes 65% on 50-listing labeled set |
| 4 | How to build labeled test set of 50 Naukri listings? | Week 2-3 | Manual curation needed |
| 5 | Production hosting — AWS EC2 or simpler PaaS (Railway/Render)? | Week 5 | PRD says EC2, but PaaS is faster for solo dev |

---

## Next Step

Create `docs/plans/week-2-plan.md` with detailed implementation steps for the AI Engine phase.
