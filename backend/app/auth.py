"""Authentication logic using JWT and MariaDB."""

import hmac
import os
import threading
import time
from typing import Any

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel

from .config import settings
from .db import (
    count_users,
    create_user,
    get_user_by_email,
    get_user_by_id,
    verify_password as _db_verify_password,
    get_password_hash as _db_get_password_hash,
)
from .runtime_config import set_active_user

router = APIRouter(prefix="/auth", tags=["auth"])


# bcrypt silently truncates the input to 72 BYTES. Without an explicit guard
# two distinct passwords that share the first 72 bytes hash identically and
# become interchangeable at login — a real auth-bypass for long passphrases.
# We reject anything longer than the limit on BOTH hashing and verification so
# the truncation can never be exploited (and an over-long stored hash can never
# be matched by a truncated candidate).
BCRYPT_MAX_PASSWORD_BYTES = 72


def _reject_overlong_password(password: str) -> None:
    if len((password or "").encode("utf-8")) > BCRYPT_MAX_PASSWORD_BYTES:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Password must be at most {BCRYPT_MAX_PASSWORD_BYTES} bytes "
                "(bcrypt truncates longer inputs, which would make distinct "
                "passwords interchangeable)."
            ),
        )


def get_password_hash(password: str) -> str:
    """Hash a password, refusing inputs longer than bcrypt's 72-byte limit."""
    _reject_overlong_password(password)
    return _db_get_password_hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a password, treating an over-long candidate as a non-match.

    Returning False (instead of comparing a silently-truncated prefix) closes
    the truncation-collision hole on the verification side too.
    """
    if len((plain_password or "").encode("utf-8")) > BCRYPT_MAX_PASSWORD_BYTES:
        return False
    return _db_verify_password(plain_password, hashed_password)


class LoginRequest(BaseModel):
    email: str
    password: str


class RegisterRequest(BaseModel):
    email: str
    password: str
    name: str = ""


class AuthResponse(BaseModel):
    user: dict[str, Any]


COOKIE_NAME = "datalia_session"
COOKIE_MAX_AGE = 30 * 24 * 3600
_AUTH_RATE_LOCK = threading.Lock()
_AUTH_RATE: dict[str, list[float]] = {}


def _cookie_secure() -> bool:
    return os.getenv("ENV", "development").strip().lower() in {"prod", "production"}


def _set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        max_age=COOKIE_MAX_AGE,
        httponly=True,
        secure=_cookie_secure(),
        samesite="lax",
        path="/",
    )


def _clear_session_cookie(response: Response) -> None:
    response.delete_cookie(
        key=COOKIE_NAME,
        httponly=True,
        secure=_cookie_secure(),
        samesite="lax",
        path="/",
    )


def _client_ip(request: Request) -> str:
    forwarded = (request.headers.get("x-forwarded-for") or "").strip()
    if forwarded:
        return forwarded.split(",", 1)[0].strip()
    return request.client.host if request.client else "unknown"


def _auth_rate_key(action: str, request: Request, identifier: str) -> str:
    normalized = (identifier or "").strip().lower()[:200]
    return f"{action}:{_client_ip(request)}:{normalized}"


def _auth_rate_limit_check(action: str, request: Request, identifier: str) -> str:
    key = _auth_rate_key(action, request, identifier)
    now = time.time()
    window = settings.auth_rate_limit_window_seconds
    limit = settings.auth_rate_limit_attempts
    with _AUTH_RATE_LOCK:
        attempts = [ts for ts in _AUTH_RATE.get(key, []) if now - ts < window]
        _AUTH_RATE[key] = attempts
        if len(attempts) >= limit:
            raise HTTPException(
                status_code=429,
                detail="Too many authentication attempts. Try again later.",
            )
    return key


def _auth_rate_limit_record_failure(key: str) -> None:
    now = time.time()
    window = settings.auth_rate_limit_window_seconds
    with _AUTH_RATE_LOCK:
        attempts = [ts for ts in _AUTH_RATE.get(key, []) if now - ts < window]
        attempts.append(now)
        _AUTH_RATE[key] = attempts


def _auth_rate_limit_reset(key: str) -> None:
    with _AUTH_RATE_LOCK:
        _AUTH_RATE.pop(key, None)


def create_jwt_token(user_id: int) -> str:
    """Generate a JWT for the given user ID."""
    payload = {
        "sub": str(user_id),
        "exp": time.time() + 30 * 24 * 3600,  # 30 days
        "iat": time.time(),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def _user_payload(user: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(user["id"]),
        "email": user["email"],
        "name": user.get("full_name") or "",
        "role": user.get("role") or "member",
    }


def require_token(request: Request) -> int:
    """Extract and verify the JWT from the Authorization header or cookie.

    Returns the user_id. A real JWT user yields its own id (> 0). The
    shared/global tenant is represented as 0 and is only reachable via the
    server-to-server BACKEND_AUTH_TOKEN or (dev-only) open-auth mode.

    NOTE: tokens are accepted ONLY from the Authorization header or the
    session cookie. The previous ``?token=`` query-parameter path was removed:
    URLs land in access logs, browser history and Referer headers, so a JWT in
    the query string leaks the session. Nothing in the codebase depends on it
    (the frontend apiClient always sends an Authorization header / cookie).
    """
    auth = request.headers.get("authorization") or ""
    presented = ""
    if auth.lower().startswith("bearer "):
        presented = auth.split(" ", 1)[1].strip()
    if not presented:
        presented = request.cookies.get(COOKIE_NAME, "").strip()

    # Shared server-to-server token. This is a NON-INTERACTIVE machine
    # identity that maps to the bounded 'global' tenant — never a real user.
    # It is disabled when open auth is off (production), so a leaked shared
    # token cannot be replayed as an interactive session in prod unless the
    # operator has explicitly opted into open auth.
    if (
        settings.backend_auth_token
        and settings.allow_open_auth
        and hmac.compare_digest(presented, settings.backend_auth_token)
    ):
        set_active_user(None)
        return 0  # Global/shared runtime settings scope (bounded tenant)

    if not presented:
        if settings.allow_open_auth and not settings.backend_auth_token:
            set_active_user(None)
            return 0  # Explicit dev-only open mode uses the shared scope
        set_active_user(None)
        raise HTTPException(status_code=401, detail="Missing authorization token.")

    try:
        payload = jwt.decode(presented, settings.jwt_secret, algorithms=["HS256"])
        user_id = int(payload["sub"])
        set_active_user(user_id)
        return user_id
    except jwt.ExpiredSignatureError:
        set_active_user(None)
        raise HTTPException(status_code=401, detail="Token has expired.")
    except (jwt.InvalidTokenError, ValueError):
        set_active_user(None)
        raise HTTPException(status_code=401, detail="Invalid token.")


class _RegistrationClosed(Exception):
    """Raised inside the registration transaction when a user already exists."""


class _EmailTaken(Exception):
    """Raised inside the registration transaction on a duplicate email."""


# Named advisory lock that serialises the first-user/admin bootstrap decision.
# GET_LOCK is process-/connection-agnostic and deadlock-free (unlike a
# FOR-UPDATE gap lock on the empty users range, which deadlocks contenders),
# so concurrent registrations queue cleanly and only the first one inserts.
_REGISTER_LOCK_NAME = "datalia_register_first_user"
_REGISTER_LOCK_TIMEOUT_SECONDS = 10


def _register_first_user_atomic(
    email: str, password_hash: str, full_name: str
) -> int:
    """Create the first (admin) user under a serialising advisory lock.

    Closes the first-user race: two concurrent POST /auth/register could both
    read count_users()==0 and both become admin. We take a named advisory lock
    (``GET_LOCK``), re-check the count while holding it, insert if still zero,
    and release. The second contender waits on the lock, then sees count > 0
    and is rejected with a clean 403 (no second admin is ever created).

    Note on Google sign-in: the FIRST user (whoever they are) becomes admin and
    closes open registration — this is the intended single-admin bootstrap.
    A Google-created first user has no password_hash, so they sign in via Google
    only; that is by design, not a lockout (additional members are provisioned
    via Google sign-in, see CLAUDE.md). Password self-registration is a
    bootstrap-only path for the very first admin.
    """
    from .db import _connect  # local import: only auth needs the raw conn here

    conn = _connect()  # autocommit=True
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT GET_LOCK(%s, %s) AS got",
            (_REGISTER_LOCK_NAME, _REGISTER_LOCK_TIMEOUT_SECONDS),
        )
        got = (cur.fetchone() or {}).get("got")
        if got != 1:
            # Couldn't acquire the lock in time — fail closed rather than risk
            # a second admin. The client can retry.
            raise HTTPException(
                status_code=503,
                detail="Registration is busy. Please retry in a moment.",
            )
        try:
            cur.execute("SELECT COUNT(*) AS n FROM users")
            existing = int((cur.fetchone() or {}).get("n") or 0)
            if existing > 0:
                raise _RegistrationClosed()
            # Defensive duplicate-email check (UNIQUE index is the real guard).
            cur.execute("SELECT id FROM users WHERE email = %s", (email,))
            if cur.fetchone():
                raise _EmailTaken()
            cur.execute(
                "INSERT INTO users (email, password_hash, full_name, role) "
                "VALUES (%s, %s, %s, %s)",
                (email, password_hash, full_name, "admin"),
            )
            return int(cur.lastrowid)
        finally:
            try:
                cur.execute("SELECT RELEASE_LOCK(%s)", (_REGISTER_LOCK_NAME,))
                cur.fetchall()
            except Exception:
                pass
    finally:
        conn.close()


@router.post("/register", response_model=AuthResponse)
async def register(
    req: RegisterRequest, response: Response, request: Request
) -> dict[str, Any]:
    rate_key = _auth_rate_limit_check("register", request, req.email)
    # Reject the obvious closed/duplicate cases early (cheap, no lock) — the
    # authoritative, race-free decision happens inside the locked transaction.
    if count_users() > 0:
        _auth_rate_limit_record_failure(rate_key)
        raise HTTPException(
            status_code=403,
            detail="Registration is closed after the first admin user.",
        )
    if get_user_by_email(req.email):
        _auth_rate_limit_record_failure(rate_key)
        raise HTTPException(status_code=400, detail="Email already registered.")

    password_hash = get_password_hash(req.password)
    try:
        user_id = _register_first_user_atomic(req.email, password_hash, req.name)
    except _RegistrationClosed:
        _auth_rate_limit_record_failure(rate_key)
        raise HTTPException(
            status_code=403,
            detail="Registration is closed after the first admin user.",
        )
    except _EmailTaken:
        _auth_rate_limit_record_failure(rate_key)
        raise HTTPException(status_code=400, detail="Email already registered.")

    user = get_user_by_id(user_id)

    token = create_jwt_token(user_id)
    _set_session_cookie(response, token)
    _auth_rate_limit_reset(rate_key)
    return {
        "user": _user_payload(
            user or {
                "id": user_id,
                "email": req.email,
                "full_name": req.name,
                "role": "admin",
            }
        )
    }


@router.post("/login", response_model=AuthResponse)
async def login(req: LoginRequest, response: Response, request: Request) -> dict[str, Any]:
    rate_key = _auth_rate_limit_check("login", request, req.email)
    user = get_user_by_email(req.email)
    if not user or not user.get("password_hash"):
        _auth_rate_limit_record_failure(rate_key)
        raise HTTPException(status_code=401, detail="Invalid credentials.")
    
    if not verify_password(req.password, user["password_hash"]):
        _auth_rate_limit_record_failure(rate_key)
        raise HTTPException(status_code=401, detail="Invalid credentials.")
    
    token = create_jwt_token(user["id"])
    _set_session_cookie(response, token)
    _auth_rate_limit_reset(rate_key)
    return {
        "user": _user_payload(user)
    }


@router.post("/logout", status_code=204)
async def logout(response: Response) -> Response:
    _clear_session_cookie(response)
    response.status_code = 204
    return response

@router.get("/me")
async def get_me(user_id: int = Depends(require_token)) -> dict[str, Any]:
    # The shared/global scope (user_id <= 0) is a NON-INTERACTIVE machine
    # identity, not a person. We must NOT mint a synthetic "Global Admin" here:
    # combined with require_token returning 0 for the shared token, that handed
    # any holder of the shared token a full admin session with no real user.
    # /me is an interactive "who am I" endpoint, so the only valid answer for a
    # non-user identity is 401. Real server-to-server callers don't need /me.
    if user_id <= 0:
        raise HTTPException(status_code=401, detail="Not signed in.")

    user = get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")

    return _user_payload(user)
