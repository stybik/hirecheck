import os

from config.settings.base import *  # noqa: F401, F403

DEBUG = False

# SQLite in-memory for fast local tests.
# CI overrides this by setting TEST_DATABASE_URL in the workflow env.
if os.environ.get("TEST_DATABASE_URL"):
    DATABASES = {
        "default": env.db_url("TEST_DATABASE_URL"),  # noqa: F405
    }
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": ":memory:",
        },
    }

# Fast password hashing for tests
PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.MD5PasswordHasher",
]

# In-memory cache for tests
CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
    },
}

# Disable Sentry in tests
SENTRY_DSN = ""
