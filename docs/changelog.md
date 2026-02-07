# Changelog

## Week 1 — Foundation (2026-02-07)

### Backend
- Django 5.x project with split settings (base/dev/prod/test)
- 3 models: AnalyzedListing, UserFeedback, APIUsageLog
- Health endpoint: GET /api/v1/health/
- HMAC middleware stub
- 14 tests passing (models + health endpoint)

### Chrome Extension
- Manifest V3 skeleton with content script, service worker, popup
- HMAC-SHA256 signing module (Web Crypto API)
- Floating "Analyze This Job" button on Naukri.com job pages
- 3-tier CSS selector fallback for DOM extraction

### Infrastructure
- GitHub Actions CI: lint + test + extension validation
- PostgreSQL 16 local setup
- uv for dependency management, ruff for linting/formatting
- Makefile with common dev commands
