"""Pytest fixtures.

Env vars are set BEFORE the app is imported so ``app.config.load_settings``
picks them up. Each test gets a fresh temp content directory and a wiped
posts/cache file.
"""

import os
import shutil
import tempfile
from pathlib import Path

# Must happen before any `from app import …`.
TEST_CONTENT = Path(tempfile.mkdtemp(prefix="datalia-test-"))
os.environ["CONTENT_DIR"] = str(TEST_CONTENT)
os.environ["AI_API_KEY"] = "test-fake-key"
os.environ["AI_DAILY_LIMIT"] = "0"  # disable rate guard in tests
os.environ["BACKEND_AUTH_TOKEN"] = ""  # default to open mode
os.environ["ALLOW_OPEN_AUTH"] = "true"
os.environ["TUNNEL_ENABLED"] = "false"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.config import settings  # noqa: E402
from app.db import reset_all_state_for_tests  # noqa: E402
from app.services import _AI_CACHE, _AI_CACHE_BY_SCOPE, _RATE  # noqa: E402


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def _isolate_state():
    """Wipe per-test artefacts: posts file, messages file, AI cache."""
    reset_all_state_for_tests()
    for f in (
        "posts.json",
        "messages.json",
        ".ai_cache.json",
        "automation_rules.json",
        "runtime_settings.json",
    ):
        p = TEST_CONTENT / f
        if p.exists():
            p.unlink()
    for p in TEST_CONTENT.glob("runtime_settings_user_*.json"):
        p.unlink()
    # Reset the AI cache (global slice + every per-tenant slice) and the
    # per-tenant daily rate-limit counters so tests don't leak across each other.
    _AI_CACHE.clear()
    for bucket in _AI_CACHE_BY_SCOPE.values():
        bucket.clear()
    _AI_CACHE_BY_SCOPE.clear()
    _AI_CACHE_BY_SCOPE["global"] = _AI_CACHE
    _RATE.clear()
    # Reset auth to open mode between tests; individual tests can opt in.
    settings.backend_auth_token = ""
    settings.allow_open_auth = True
    settings.telegram_bot_token = ""
    settings.telegram_default_chat_id = ""
    settings.telegram_webhook_secret = ""
    yield


def pytest_sessionfinish(session, exitstatus):
    shutil.rmtree(TEST_CONTENT, ignore_errors=True)
