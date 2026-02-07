import os

env = os.environ.get("DJANGO_ENV", "development")

if env == "production":
    from config.settings.production import *  # noqa: F401, F403
elif env == "test":
    from config.settings.test import *  # noqa: F401, F403
else:
    from config.settings.development import *  # noqa: F401, F403
