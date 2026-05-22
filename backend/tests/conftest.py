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
os.environ["TUNNEL_ENABLED"] = "false"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.config import settings  # noqa: E402
from app.services import _AI_CACHE  # noqa: E402


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def _isolate_state():
    """Wipe per-test artefacts: posts file, messages file, AI cache."""
    for f in ("posts.json", "messages.json", ".ai_cache.json"):
        p = TEST_CONTENT / f
        if p.exists():
            p.unlink()
    _AI_CACHE.clear()
    # Reset auth to open mode between tests; individual tests can opt in.
    settings.backend_auth_token = ""
    yield


def pytest_sessionfinish(session, exitstatus):
    shutil.rmtree(TEST_CONTENT, ignore_errors=True)
