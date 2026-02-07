# HireCheck - Job Listing Lie Detector

AI-powered Chrome extension that detects ghost jobs, scam listings, and toxic workplace signals on Naukri.com.

## Prerequisites

- Python 3.12
- [uv](https://docs.astral.sh/uv/) (Python package manager)
- PostgreSQL 16
- Google Chrome (for extension testing)

## Quick Start

```bash
# 1. Install dependencies
make setup

# 2. Edit .env with your local settings
#    (DATABASE_URL, API keys, etc.)

# 3. Create the database
createdb hirecheck

# 4. Run migrations
make migrate

# 5. Create cache table (dev uses DB cache)
make createcachetable

# 6. Start the development server
make run
```

The API will be available at `http://localhost:8000/api/v1/health/`.

## Loading the Chrome Extension

1. Open `chrome://extensions/` in Chrome
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select the `extension/` directory
5. Visit any Naukri.com job listing to see the "Analyze This Job" button

## Development

```bash
make test          # Run tests
make lint          # Run linter
make format        # Auto-format code
make shell         # Django shell
make makemigrations # Generate new migrations
make migrate       # Apply migrations
```

## Project Structure

```
hirecheck/
├── backend/           # Django API server
│   ├── config/        # Project settings (split: base/dev/prod/test)
│   └── apps/
│       ├── analysis/  # Core analysis app (models, views, tests)
│       └── common/    # Shared middleware and utilities
├── extension/         # Chrome extension (Manifest V3)
│   ├── background/    # Service worker
│   ├── content/       # Content script (Naukri page injection)
│   ├── popup/         # Extension popup UI
│   └── lib/           # HMAC signing module
└── .github/workflows/ # CI/CD pipeline
```

## Tech Stack

- **Backend**: Django 5.x + Pydantic v2
- **Database**: PostgreSQL 16
- **AI**: GPT-4o-mini (primary) + Gemini 1.5 Flash (fallback)
- **Extension**: JavaScript + Manifest V3
- **CI/CD**: GitHub Actions
