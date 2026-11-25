import ssl

from app import db
from app.config import settings


def test_database_url_ssl_verifies_certificate_and_hostname(monkeypatch):
    monkeypatch.setattr(
        settings,
        "database_url",
        "mysql://user:pw@gateway.example.com:4000/datalia?ssl=true",
    )
    params = db._database_params()
    ctx = params["ssl"]
    assert isinstance(ctx, ssl.SSLContext)
    assert ctx.verify_mode == ssl.CERT_REQUIRED
    assert ctx.check_hostname is True
    assert params["host"] == "gateway.example.com"
    assert params["port"] == 4000
    assert params["database"] == "datalia"


def test_database_url_without_ssl_has_no_tls(monkeypatch):
    monkeypatch.setattr(settings, "database_url", "mysql://user:pw@db:3306/datalia")
    assert "ssl" not in db._database_params()
