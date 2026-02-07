# HireCheck - Job Listing Lie Detector

AI-powered Chrome extension that detects ghost jobs, scam listings, and toxic workplace signals on Naukri.com.

## Prerequisites

- **Python 3.12** (`python3 --version` to verify)
- **[uv](https://docs.astral.sh/uv/)** — Python package manager
- **PostgreSQL 16** — local database
- **Google Chrome** — for extension testing

## Quick Start

### 1. Install uv (if not already installed)

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
# Restart your terminal, or run:
export PATH="$HOME/.local/bin:$PATH"
```

### 2. Install PostgreSQL 16 (macOS)

```bash
brew install postgresql@16
brew services start postgresql@16
# Add to PATH if needed:
export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"
```

### 3. Create the database and user

```bash
createuser -s hirecheck
createdb -O hirecheck hirecheck
```

### 4. Install dependencies and configure environment

```bash
make setup
```

This installs all Python dependencies and copies `.env.example` to `.env` if it doesn't exist.

### 5. Generate a secret key and update .env

```bash
# Generate a random secret key:
python3 -c "import secrets; print(secrets.token_urlsafe(50))"
```

Open `.env` and replace the placeholder values:
- `DJANGO_SECRET_KEY` — paste the generated key
- `HMAC_SECRET_KEY` — generate a 64-char hex string: `python3 -c "import secrets; print(secrets.token_hex(32))"`
- `OPENAI_API_KEY` / `GEMINI_API_KEY` — add your API keys (optional for local dev)

### 6. Run migrations and start the server

```bash
make migrate
make createcachetable
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
- **AI**: Gemini 2.5 Flash (primary, free tier) + GPT-4o-mini (fallback)
- **Extension**: JavaScript + Manifest V3
- **CI/CD**: GitHub Actions
