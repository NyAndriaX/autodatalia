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
from app.db import _database_params, init_db, reset_all_state_for_tests  # noqa: E402
from app.services import _AI_CACHE, _AI_CACHE_BY_SCOPE, _RATE  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def _test_database():
    """Guard + bootstrap the database the suite will wipe.

    Every test DELETEs all users/workspaces/documents, so refuse to run against
    a database whose name doesn't say it's for tests (e.g. the local dev
    `datalia` DB) unless explicitly allowed. Then create the schema: the app's
    lifespan normally does that, but TestClient isn't used as a context
    manager here, so on a fresh database nothing would create the tables.
    """
    db_name = str(_database_params().get("database") or "")
    if "test" not in db_name.lower() and os.getenv("DATALIA_ALLOW_TEST_DB_WIPE") != "1":
        pytest.exit(
            f"Refusing to run tests against database {db_name!r}: the suite "
            "deletes all rows. Point MARIADB_DATABASE / DATABASE_URL at a "
            "database whose name contains 'test', or set "
            "DATALIA_ALLOW_TEST_DB_WIPE=1 to wipe it anyway.",
            returncode=2,
        )
    init_db(retries=30, delay=1.0)
    yield


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def workspace_client():
    """A real signed-in user with a personal workspace."""
    settings.allow_open_auth = False
    c = TestClient(app)
    response = c.post(
        "/auth/register",
        json={
            "email": "owner@example.com",
            "password": "secret123",
            "name": "Owner",
        },
    )
    assert response.status_code == 200, response.text
    return c


@pytest.fixture
def workspace_client_factory():
    """Create independent signed-in clients, one workspace per client."""

    counter = {"n": 0}

    def _make(*, email: str | None = None, name: str | None = None, password: str = "secret123"):
        settings.allow_open_auth = False
        c = TestClient(app)
        counter["n"] += 1
        idx = counter["n"]
        chosen_email = email or f"user{idx}@example.com"
        chosen_name = name or f"User {idx}"
        response = c.post(
            "/auth/register",
            json={
                "email": chosen_email,
                "password": password,
                "name": chosen_name,
            },
        )
        assert response.status_code == 200, response.text
        return c

    return _make


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
    # Wipe per-workspace media dirs (auto-increment resets to 1 each test, so a
    # stale ws/1 would otherwise leak into the next test's workspace).
    shutil.rmtree(TEST_CONTENT / "ws", ignore_errors=True)
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
    settings.allow_open_registration = True
    settings.telegram_bot_token = ""
    settings.telegram_default_chat_id = ""
    settings.telegram_webhook_secret = ""
    yield


def pytest_sessionfinish(session, exitstatus):
    shutil.rmtree(TEST_CONTENT, ignore_errors=True)
