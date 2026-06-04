from zoneinfo import ZoneInfo

from app.timezones import DEFAULT_TZ_FALLBACK, get_default_timezone_name, resolve_zoneinfo


def test_default_timezone_prefers_datalia_env(monkeypatch):
    monkeypatch.setenv("DATALIA_DEFAULT_TZ", "Africa/Lagos")
    monkeypatch.setenv("DEFAULT_TIMEZONE", "UTC")

    assert get_default_timezone_name() == "Africa/Lagos"


def test_default_timezone_supports_legacy_alias(monkeypatch):
    monkeypatch.delenv("DATALIA_DEFAULT_TZ", raising=False)
    monkeypatch.setenv("DEFAULT_TIMEZONE", "Africa/Algiers")

    assert get_default_timezone_name() == "Africa/Algiers"


def test_default_timezone_has_non_utc_fallback(monkeypatch):
    monkeypatch.delenv("DATALIA_DEFAULT_TZ", raising=False)
    monkeypatch.delenv("DEFAULT_TIMEZONE", raising=False)

    assert get_default_timezone_name() == DEFAULT_TZ_FALLBACK


def test_resolve_zoneinfo_falls_back_to_configured_default(monkeypatch):
    monkeypatch.setenv("DATALIA_DEFAULT_TZ", "Africa/Lagos")

    assert resolve_zoneinfo("Pluto/Mars") == ZoneInfo("Africa/Lagos")
