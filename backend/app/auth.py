"""Optional bearer-token guard for mutating / spend-incurring routes.

If ``BACKEND_AUTH_TOKEN`` is unset the dependency is a no-op so local dev
keeps working. Once set (in prod or behind a tunnel), all gated routes
require ``Authorization: Bearer <token>`` (or ``?token=<token>`` for
form-style uploads where headers are inconvenient).
"""

from fastapi import HTTPException, Request

from .config import settings


def require_token(request: Request) -> None:
    """Reject the request with 401 if a token is configured and missing/wrong."""
    expected = settings.backend_auth_token
    if not expected:
        return  # auth disabled — open mode for local dev

    auth = request.headers.get("authorization") or ""
    presented = ""
    if auth.lower().startswith("bearer "):
        presented = auth.split(" ", 1)[1].strip()
    if not presented:
        presented = request.query_params.get("token", "")

    if presented != expected:
        raise HTTPException(status_code=401, detail="Invalid or missing token.")
