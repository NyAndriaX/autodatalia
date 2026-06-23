"""Authentication logic using JWT and MariaDB."""

import hashlib
import hmac
import logging
import os
import secrets
import smtplib
import ssl
import threading
import time
from email.message import EmailMessage
from typing import Any

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel

from .config import settings
from .db import (
    count_users,
    create_user,
    delete_collection_document,
    get_collection_document,
    get_user_by_email,
    get_user_by_id,
    update_user_password,
    upsert_collection_document,
    verify_password as _db_verify_password,
    get_password_hash as _db_get_password_hash,
)
from .runtime_config import set_active_user
from . import workspaces

logger = logging.getLogger(__name__)

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


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class ForgotPasswordRequest(BaseModel):
    email: str


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str


class AcceptInviteRequest(BaseModel):
    token: str
    name: str = ""
    password: str = ""


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
    # Include the caller's active workspace + effective permissions so the
    # frontend can gate the Team & Access UI by permission string. Resolved
    # live (cheap) so a role change is reflected on the next /auth/me.
    uid = int(user["id"])
    workspace_id = workspaces.get_active_workspace_id(uid)
    # Safety net: a real user must always have a home workspace. If somehow none
    # (legacy data), provision their personal one so they're never locked out.
    if not workspace_id and uid > 0:
        workspace_id = workspaces.ensure_personal_workspace(
            uid, user.get("full_name"), user.get("email")
        )
    permissions: list[str] = []
    workspace = None
    if workspace_id:
        permissions = sorted(workspaces.permissions_for(uid, workspace_id))
        ws = workspaces.get_workspace(workspace_id) or {}
        workspace = {
            "id": workspace_id,
            "name": ws.get("name"),
            "role": workspaces.role_name_for(uid, workspace_id),
            "is_owner": workspaces.is_owner(workspace_id, uid),
            "is_personal": bool(ws.get("is_personal")),
        }
    return {
        "id": str(user["id"]),
        "email": user["email"],
        "name": user.get("full_name") or "",
        "role": user.get("role") or "member",
        "permissions": permissions,
        "workspace": workspace,
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


@router.post("/register", response_model=AuthResponse)
async def register(
    req: RegisterRequest, response: Response, request: Request
) -> dict[str, Any]:
    """Bootstrap-only registration.

    The first account always succeeds so a fresh instance can be bootstrapped.
    After that, account creation happens only through administrator invitations.
    """
    rate_key = _auth_rate_limit_check("register", request, req.email)

    if count_users() > 0:
        _auth_rate_limit_record_failure(rate_key)
        raise HTTPException(
            status_code=403,
            detail="Registration is invitation-only. Ask an administrator to invite you.",
        )

    if get_user_by_email(req.email):
        _auth_rate_limit_record_failure(rate_key)
        raise HTTPException(status_code=400, detail="Email already registered.")

    password_hash = get_password_hash(req.password)
    try:
        user_id = create_user(req.email, password_hash, req.name, role="member")
    except Exception:
        # A duplicate that slipped past the check above under a race trips the
        # UNIQUE(email) index — surface it as a clean 400 instead of a 500.
        if get_user_by_email(req.email):
            _auth_rate_limit_record_failure(rate_key)
            raise HTTPException(status_code=400, detail="Email already registered.")
        raise

    # Every new account owns a personal workspace (they are its Owner/admin), so
    # a signed-in user always has a workspace to operate in and can invite others.
    workspaces.create_workspace_with_owner(
        workspaces.workspace_name_for(req.name, req.email), user_id
    )

    user = get_user_by_id(user_id)
    token = create_jwt_token(user_id)
    _set_session_cookie(response, token)
    _auth_rate_limit_reset(rate_key)
    return {
        "user": _user_payload(
            user
            or {
                "id": user_id,
                "email": req.email,
                "full_name": req.name,
                "role": "member",
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


@router.post("/delete-account", status_code=200)
async def delete_account(
    response: Response, user_id: int = Depends(require_token)
) -> dict[str, Any]:
    """Permanently delete the caller's OWN account (self-service, irreversible).

    Workspaces they solely own are deleted with all their data; co-owned ones
    transfer ownership to the earliest other member (see workspaces.delete_user).
    Clears the session cookie so the now-dead session can't be reused.
    """
    if user_id <= 0:
        raise HTTPException(status_code=401, detail="Not signed in.")
    workspaces.delete_user(int(user_id))
    _clear_session_cookie(response)
    return {"deleted": True}

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


# --- Password management ---------------------------------------------------

_PASSWORD_RESET_COLLECTION = "password_resets"
_PASSWORD_RESET_SCOPE = 0  # system/global doc scope (not a real user)
_PASSWORD_RESET_TTL_SECONDS = 3600  # reset links are valid for one hour


def _hash_reset_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _send_email(to_email: str, subject: str, body: str) -> bool:
    """Send a plain-text email via SMTP when configured.

    Returns False when no SMTP_HOST is set — the caller then logs the link as
    an internal-tool fallback rather than failing the request.
    """
    host = os.getenv("SMTP_HOST", "").strip()
    if not host:
        return False
    port = int(os.getenv("SMTP_PORT", "587") or "587")
    user = os.getenv("SMTP_USER", "").strip()
    password = os.getenv("SMTP_PASSWORD", "")
    sender = os.getenv("SMTP_FROM", "").strip() or user or "no-reply@datalia.app"
    use_tls = os.getenv("SMTP_USE_TLS", "true").strip().lower() in {"1", "true", "yes", "on"}

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = sender
    msg["To"] = to_email
    msg.set_content(body)

    with smtplib.SMTP(host, port, timeout=15) as smtp:
        if use_tls:
            smtp.starttls(context=ssl.create_default_context())
        if user:
            smtp.login(user, password)
        smtp.send_message(msg)
    return True


@router.post("/change-password", status_code=200)
async def change_password(
    req: ChangePasswordRequest, user_id: int = Depends(require_token)
) -> dict[str, Any]:
    """Self-service password change for the signed-in user."""
    if user_id <= 0:
        raise HTTPException(status_code=401, detail="Not signed in.")
    user = get_user_by_id(user_id)
    if not user or not user.get("password_hash"):
        raise HTTPException(status_code=401, detail="Not signed in.")
    if not verify_password(req.current_password, user["password_hash"]):
        raise HTTPException(status_code=400, detail="Current password is incorrect.")
    update_user_password(user_id, get_password_hash(req.new_password))
    return {"ok": True}


@router.post("/forgot-password", status_code=200)
async def forgot_password(
    req: ForgotPasswordRequest, request: Request
) -> dict[str, Any]:
    """Start a password reset.

    Always returns 200 and never reveals whether an address has an account.
    Emails a one-hour reset link; if no SMTP is configured the link is logged
    so an operator can deliver it manually (internal-tool fallback).
    """
    rate_key = _auth_rate_limit_check("forgot", request, req.email)
    email = (req.email or "").strip()
    user = get_user_by_email(email) if email else None
    if user and user.get("id"):
        token = secrets.token_urlsafe(32)
        upsert_collection_document(
            _PASSWORD_RESET_COLLECTION,
            _hash_reset_token(token),
            {
                "user_id": int(user["id"]),
                "email": email,
                "expires_at": time.time() + _PASSWORD_RESET_TTL_SECONDS,
            },
            user_id=_PASSWORD_RESET_SCOPE,
        )
        base = os.getenv("PUBLIC_APP_URL", "").strip().rstrip("/")
        link = f"{base}/reset-password?token={token}"
        body = (
            "You requested a password reset for your Datalia account.\n\n"
            f"Open this link to choose a new password (valid one hour):\n{link}\n\n"
            "If you didn't request this, you can safely ignore this email."
        )
        try:
            if not _send_email(email, "Reset your Datalia password", body):
                logger.warning(
                    "Password reset requested for %s but no SMTP is configured. "
                    "Deliver this link manually: %s",
                    email,
                    link,
                )
        except Exception:
            logger.exception("Failed to send password-reset email to %s", email)
    _auth_rate_limit_reset(rate_key)
    return {"ok": True}


@router.post("/reset-password", response_model=AuthResponse)
async def reset_password(
    req: ResetPasswordRequest, response: Response, request: Request
) -> dict[str, Any]:
    """Complete a password reset using the token from the emailed link.

    On success the user is signed in with their new password.
    """
    rate_key = _auth_rate_limit_check("reset", request, (req.token or "")[:16])
    token = (req.token or "").strip()
    token_hash = _hash_reset_token(token) if token else ""
    record = (
        get_collection_document(
            _PASSWORD_RESET_COLLECTION, token_hash, user_id=_PASSWORD_RESET_SCOPE
        )
        if token_hash
        else None
    )
    expired = not record or float(record.get("expires_at") or 0) < time.time()
    user = (
        get_user_by_id(int(record["user_id"]))
        if record and record.get("user_id")
        else None
    )
    if expired or not user:
        if token_hash:
            delete_collection_document(
                _PASSWORD_RESET_COLLECTION, token_hash, user_id=_PASSWORD_RESET_SCOPE
            )
        _auth_rate_limit_record_failure(rate_key)
        raise HTTPException(
            status_code=400, detail="This reset link is invalid or has expired."
        )

    update_user_password(int(user["id"]), get_password_hash(req.new_password))
    delete_collection_document(
        _PASSWORD_RESET_COLLECTION, token_hash, user_id=_PASSWORD_RESET_SCOPE
    )

    token_jwt = create_jwt_token(int(user["id"]))
    _set_session_cookie(response, token_jwt)
    _auth_rate_limit_reset(rate_key)
    return {"user": _user_payload(user)}


# --- Workspace invitations (accept flow) -----------------------------------
@router.get("/invite/{token}")
async def invite_preview(token: str) -> dict[str, Any]:
    """Public: preview an invitation so the accept page can show the workspace,
    role and whether the invitee needs to create an account."""
    inv = workspaces.get_invitation_by_token((token or "").strip())
    if (
        not inv
        or inv.get("accepted_at")
        or float(inv.get("expires_at") or 0) < time.time()
    ):
        raise HTTPException(status_code=400, detail="This invitation is invalid or has expired.")
    ws = workspaces.get_workspace(int(inv["workspace_id"])) or {}
    role = workspaces.get_role(int(inv["role_id"])) or {}
    return {
        "email": inv["email"],
        "workspace_name": ws.get("name"),
        "role_name": role.get("name"),
        "needs_account": get_user_by_email(str(inv["email"])) is None,
    }


@router.post("/accept-invite", response_model=AuthResponse)
async def accept_invite(
    req: AcceptInviteRequest, response: Response, request: Request
) -> dict[str, Any]:
    """Public: accept a workspace invitation. Binds strictly to the invited
    email (never the caller's identity), single-use, expiring. Creates the user
    if needed, joins them to the workspace with the invited role, signs them in.
    """
    rate_key = _auth_rate_limit_check("accept_invite", request, (req.token or "")[:16])
    inv = workspaces.get_invitation_by_token((req.token or "").strip())
    if (
        not inv
        or inv.get("accepted_at")
        or float(inv.get("expires_at") or 0) < time.time()
    ):
        _auth_rate_limit_record_failure(rate_key)
        raise HTTPException(status_code=400, detail="This invitation is invalid or has expired.")

    email = str(inv["email"]).strip().lower()
    workspace_id = int(inv["workspace_id"])
    role_id = int(inv["role_id"])

    user = get_user_by_email(email)
    if user is None:
        name = (req.name or "").strip()
        password = req.password or ""
        if not name or not password:
            _auth_rate_limit_record_failure(rate_key)
            raise HTTPException(
                status_code=422,
                detail="Name and password are required to create your invited account.",
            )
        password_hash = get_password_hash(password)
        try:
            user_id = create_user(email, password_hash, name, role="member")
        except Exception:
            user = get_user_by_email(email)
            if not user:
                raise
            user_id = int(user["id"])
        else:
            user = get_user_by_id(user_id) or {
                "id": user_id,
                "email": email,
                "full_name": name,
                "role": "member",
            }
            # An invited user should not get their own admin workspace by
            # default; their workspace access comes from the administrator invite.
    else:
        user_id = int(user["id"])

    if workspaces.get_membership(user_id, workspace_id):
        _auth_rate_limit_record_failure(rate_key)
        raise HTTPException(
            status_code=400,
            detail="That account is already a member of this workspace.",
        )

    workspaces.add_member(workspace_id, user_id, role_id)
    workspaces.consume_invitation(int(inv["id"]))
    # Land the user in the workspace they just joined.
    workspaces.switch_workspace(user_id, workspace_id)

    user_row = get_user_by_id(user_id)
    token = create_jwt_token(user_id)
    _set_session_cookie(response, token)
    _auth_rate_limit_reset(rate_key)
    return {
        "user": _user_payload(
            user_row or {"id": user_id, "email": email, "full_name": req.name, "role": "member"}
        )
    }
