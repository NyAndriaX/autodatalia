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
    verify_password,
    get_password_hash,
)
from .runtime_config import set_active_user

router = APIRouter(prefix="/auth", tags=["auth"])


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
    """Extract and verify the JWT from the Authorization header. Returns user_id."""
    auth = request.headers.get("authorization") or ""
    presented = ""
    if auth.lower().startswith("bearer "):
        presented = auth.split(" ", 1)[1].strip()
    if not presented:
        presented = request.cookies.get(COOKIE_NAME, "").strip()
    if not presented:
        presented = request.query_params.get("token", "")

    # Fallback to the global token for backward compatibility if configured
    if settings.backend_auth_token and hmac.compare_digest(presented, settings.backend_auth_token):
        set_active_user(None)
        return 0  # Global/shared runtime settings scope

    if not presented:
        if settings.backend_auth_token:
            set_active_user(None)
            raise HTTPException(status_code=401, detail="Missing authorization token.")
        if settings.allow_open_auth:
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


@router.post("/register", response_model=AuthResponse)
async def register(
    req: RegisterRequest, response: Response, request: Request
) -> dict[str, Any]:
    rate_key = _auth_rate_limit_check("register", request, req.email)
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
    user_id = create_user(req.email, password_hash, req.name)
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
    if user_id <= 0:
        if settings.backend_auth_token:
            # Global dummy user
            return {"id": "1", "email": "team@datalia.app", "name": "Global Admin", "role": "admin"}
        raise HTTPException(status_code=401, detail="Not signed in.")
    
    user = get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    
    return _user_payload(user)
