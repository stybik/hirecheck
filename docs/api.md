# API Reference

Base URL: `/api/v1/`

## Endpoints

### GET /api/v1/health/

Health check endpoint. No authentication required.

**Response** `200 OK`
```json
{
  "status": "healthy",
  "version": "0.1.0",
  "uptime_seconds": 1234,
  "models": {
    "primary": "gemini-2.5-flash",
    "fallback": "gpt-4o-mini"
  }
}
```

### POST /api/v1/analyze/ *(Week 2)*

Analyze a job listing for ghost/scam signals.

**Headers**
- `X-Extension-Signature` — HMAC-SHA256 signature of the request body
- `X-Timestamp` — Unix timestamp (must be within 5 minutes)
- `X-Device-Hash` — Anonymous device fingerprint

**Request Body**
```json
{
  "url": "https://www.naukri.com/job-listings-...",
  "url_hash": "sha256-of-url",
  "content_hash": "sha256-of-content",
  "job_title": "Senior Software Engineer",
  "company_name": "Acme Corp",
  "description": "...",
  "requirements": "...",
  "salary_text": "10-15 LPA",
  "posting_date": "2 days ago"
}
```

**Response** `200 OK`
```json
{
  "ghost_score": 72,
  "category_scores": {
    "ghost_signals": 80,
    "scam_signals": 60,
    "toxic_culture": 45,
    "market_reality": 85
  },
  "red_flags": [
    {
      "category": "ghost_signals",
      "signal": "Perpetually open listing",
      "severity": "high",
      "explanation": "This position has been reposted 4+ times..."
    }
  ],
  "recommendation": "apply_with_caution",
  "cached": false
}
```

## Authentication

All `/analyze` and `/feedback` endpoints use HMAC-SHA256 signing. The shared secret is configured via `HMAC_SECRET_KEY` in both the extension and backend.

## Rate Limiting

- Default: 5 analyses per device per day (`DAILY_ANALYSIS_LIMIT`)
- Cached results don't count against the limit
