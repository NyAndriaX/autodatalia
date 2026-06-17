"""OAuth scaffolding for the 4 social platforms.

Currently a *stub* — the real authorization-code flow only kicks in once a
provider's credentials are present in the environment. Until then the
endpoints return a 503 with a clear message about which env vars are
missing, so the frontend Settings view can render an honest "Not
configured" state instead of pretending to be wired up.

When the CEO sends the Client ID / Secret per platform, those go into the
`.env` next to the existing AI_API_KEY — no code change here.

Env vars expected (per provider):
    META_APP_ID           META_APP_SECRET
    TIKTOK_CLIENT_KEY     TIKTOK_CLIENT_SECRET
    LINKEDIN_CLIENT_ID    LINKEDIN_CLIENT_SECRET
    GOOGLE_CLIENT_ID      GOOGLE_CLIENT_SECRET   (for user sign-in, not posting)

Plus one shared:
    OAUTH_REDIRECT_BASE   e.g. https://app.datalia.com  → callbacks land at
                          {base}/oauth/{provider}/callback
"""

from __future__ import annotations

import json
import os
import secrets
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, HTTPException, Query, Depends
from fastapi.responses import HTMLResponse, PlainTextResponse

from .config import settings
from .db import load_scoped_blob, save_scoped_blob
from .auth import require_token
from .authz import require_permission
from .workspaces import get_active_workspace_id

# ── Provider registry ──────────────────────────────────────────────────


@dataclass(frozen=True)
class ProviderSpec:
    """Static config for one OAuth provider."""

    id: str
    label: str
    client_id_env: str
    client_secret_env: str
    authorize_url: str
    token_url: str
    # Scopes we'll request at OAuth time (must match what the platform app
    # has been approved for in their developer portal).
    scopes: tuple[str, ...]
    # Extra query params some providers require on the authorize URL.
    extra_authorize_params: tuple[tuple[str, str], ...] = ()


PROVIDERS: dict[str, ProviderSpec] = {
    # Single Meta OAuth covers BOTH FB Pages and Instagram Business —
    # legacy "Instagram Graph API via Facebook Login" flow:
    #   • Auth via Facebook OAuth (no separate Instagram app needed)
    #   • Each FB Page the user admins exposes any linked IG Business
    #     account through the same Page access token
    #   • Bypasses Instagram-app tester management + Business Verification
    #     gates that block the newer Instagram Login flow
    "meta": ProviderSpec(
        id="meta",
        label="Facebook + Instagram",
        client_id_env="META_APP_ID",
        client_secret_env="META_APP_SECRET",
        authorize_url="https://www.facebook.com/v21.0/dialog/oauth",
        token_url="https://graph.facebook.com/v21.0/oauth/access_token",
        scopes=(
            # FB Pages
            "pages_show_list",
            "pages_read_engagement",
            "pages_manage_posts",
            "business_management",
            # Instagram (via the FB Page link). These are the LEGACY names
            # that travel through Facebook OAuth — not the `_business_*`
            # ones which only work via Instagram's own OAuth endpoint.
            "instagram_basic",
            "instagram_content_publish",
        ),
    ),
    "tiktok": ProviderSpec(
        id="tiktok",
        label="TikTok",
        client_id_env="TIKTOK_CLIENT_KEY",
        client_secret_env="TIKTOK_CLIENT_SECRET",
        authorize_url="https://www.tiktok.com/v2/auth/authorize/",
        token_url="https://open.tiktokapis.com/v2/oauth/token/",
        # Default to the sandbox-safe set. `video.publish` (Direct Post)
        # only grants post-audit — requesting it in sandbox makes TikTok
        # reject the whole authorize URL with a "client_key" error that's
        # actually a scope problem. After the audit clears, override via
        # the TIKTOK_SCOPES env (comma-separated) to add `video.publish`.
        scopes=("user.info.basic", "video.upload"),
    ),
    "linkedin": ProviderSpec(
        id="linkedin",
        label="LinkedIn",
        client_id_env="LINKEDIN_CLIENT_ID",
        client_secret_env="LINKEDIN_CLIENT_SECRET",
        authorize_url="https://www.linkedin.com/oauth/v2/authorization",
        token_url="https://www.linkedin.com/oauth/v2/accessToken",
        scopes=(
            "openid",
            "profile",
            "email",
            "w_member_social",
            # `w_organization_social` requires Community Management API approval.
            # Will be added once the LinkedIn review clears.
        ),
    ),
    # Google sign-in removed: the app uses open email/password self-registration
    # (no admin tier), so no Google OAuth login is needed. (This is unrelated to
    # the Google AI / Gemini image generation, which is configured separately.)
}


# ── Configuration view ────────────────────────────────────────────────


def _provider_creds(p: ProviderSpec) -> tuple[str | None, str | None]:
    return os.environ.get(p.client_id_env), os.environ.get(p.client_secret_env)


def _provider_scopes(p: ProviderSpec) -> list[str]:
    """Return the effective OAuth scopes for a provider.

    TikTok and LinkedIn both need env overrides in practice:
      - TikTok: teams toggle `video.publish` on/off during review
      - LinkedIn: some apps have OIDC (`openid profile email`) while
        others still rely on legacy profile scopes (`r_liteprofile`)
    """
    override_env = {
        "tiktok": "TIKTOK_SCOPES",
        "linkedin": "LINKEDIN_SCOPES",
    }.get(p.id)
    if not override_env:
        return list(p.scopes)
    raw = os.environ.get(override_env, "").strip()
    if not raw:
        return list(p.scopes)
    return [part.strip() for part in raw.replace(",", " ").split() if part.strip()]


def _redirect_uri(provider_id: str) -> str:
    # NOTE: OAUTH_REDIRECT_BASE and the *_CLIENT_ID/SECRET pairs are read
    # directly from os.environ on purpose — they are deliberately NOT in
    # runtime_config.EDITABLE_KEYS. Hot-applying them mid-flight is unsafe
    # because (a) the value must match what's registered in each provider's
    # developer portal, and (b) a change between /start and /callback would
    # break the state round-trip. A container restart is required when these
    # rotate.
    base = os.environ.get("OAUTH_REDIRECT_BASE", "http://localhost:8000").rstrip("/")
    return f"{base}/oauth/{provider_id}/callback"


def _provider_status(p: ProviderSpec) -> dict[str, Any]:
    client_id, client_secret = _provider_creds(p)
    configured = bool(client_id and client_secret)
    missing = []
    if not client_id:
        missing.append(p.client_id_env)
    if not client_secret:
        missing.append(p.client_secret_env)
    return {
        "id": p.id,
        "label": p.label,
        "configured": configured,
        "missing_env": missing,
        "redirect_uri": _redirect_uri(p.id),
        "scopes": _provider_scopes(p),
    }


# ── Token storage (file-based stub) ───────────────────────────────────


def _load_tokens(user_id: int | None = None) -> dict[str, Any]:
    try:
        payload = load_scoped_blob("oauth_tokens", user_id=user_id, default={}) or {}
        return payload if isinstance(payload, dict) else {}
    except Exception:
        return {}


def _save_tokens(data: dict[str, Any], user_id: int | None = None) -> None:
    save_scoped_blob("oauth_tokens", data or {}, user_id=user_id)


# ── Routes ─────────────────────────────────────────────────────────────

router = APIRouter(prefix="/oauth", tags=["oauth"])


@router.get("/status", dependencies=[Depends(require_permission("connections.read"))])
async def oauth_status(user_id: int = Depends(require_token)) -> dict[str, Any]:
    """Per-provider configuration + connection state.

    The frontend uses this to show real "Configured"/"Connected" badges in
    Settings, so the Connect buttons don't lie about being wireable.
    """
    tokens = _load_tokens(get_active_workspace_id(user_id))
    return {
        "providers": [
            {
                **_provider_status(p),
                "connected": p.id in tokens and bool(tokens[p.id].get("access_token")),
            }
            for p in PROVIDERS.values()
        ],
    }


# Providers whose tokens are PER-USER posting credentials. These MUST be
# tied to a real authenticated tenant (user_id > 0) so one tenant's social
# tokens never land in the shared/global scope where every other tenant
# could publish with them.
_PER_USER_TOKEN_PROVIDERS = {"meta", "tiktok", "linkedin"}


@router.get(
    "/{provider_id}/start",
    dependencies=[Depends(require_permission("connections.manage"))],
)
async def oauth_start(provider_id: str, user_id: int = Depends(require_token)) -> dict[str, str]:
    """Return the authorize URL to redirect the browser to.

    The frontend pops a new window pointing at this URL. The provider
    redirects back to /oauth/{provider}/callback with a `code`.
    """
    if provider_id not in PROVIDERS:
        raise HTTPException(404, f"Unknown provider: {provider_id}")
    # Social connections belong to a WORKSPACE: the token is shared by every
    # member so they can all publish to the same pages. Refuse to start if the
    # caller has no workspace, so a posting token never lands in the global scope.
    workspace_id = get_active_workspace_id(user_id)
    if provider_id in _PER_USER_TOKEN_PROVIDERS and not workspace_id:
        raise HTTPException(
            status_code=401,
            detail=(
                "Sign in to a workspace before connecting a social provider — "
                "posting tokens cannot be stored in the shared scope."
            ),
        )
    p = PROVIDERS[provider_id]
    client_id, client_secret = _provider_creds(p)
    if not client_id or not client_secret:
        raise HTTPException(
            503,
            detail={
                "error": "provider_not_configured",
                "missing": [
                    e
                    for e in (p.client_id_env, p.client_secret_env)
                    if not os.environ.get(e)
                ],
            },
        )

    state = secrets.token_urlsafe(24)
    # Stash state so the callback can verify it isn't a replay.
    # Notice we use the global token store for pending states because the callback
    # might not have the user_id (unless it's Google Auth, or we pass it in state).
    # We will encode the user_id in the state object if a token is provided in the query.
    # For now, let's keep pending state global.
    tokens = _load_tokens(None)
    tokens.setdefault("_pending_state", {})[state] = {
        "provider": provider_id,
        "created_at": time.time(),
        "user_id": user_id,
        # The callback has no session, so it binds the token to THIS workspace.
        "workspace_id": workspace_id,
    }
    _save_tokens(tokens, None)

    # TikTok diverges from the OAuth2 norm in two ways: the authorize URL
    # takes `client_key` instead of `client_id`, and scopes are joined
    # with commas instead of spaces. Every other provider follows the
    # standard `client_id` + space-separated scopes.
    if p.id == "tiktok":
        # Direct-post requires `video.publish`. Sandbox normally rejects
        # the scope at authorize time UNLESS the app's connected account
        # is the developer's own (which is always true in sandbox). Allow
        # an env override so the user can pick: TIKTOK_SCOPES="user.info.basic,video.upload,video.publish"
        scope_str = ",".join(_provider_scopes(p))
        params = {
            "client_key": client_id,
            "redirect_uri": _redirect_uri(p.id),
            "response_type": "code",
            "scope": scope_str,
            "state": state,
        }
    else:
        params = {
            "client_id": client_id,
            "redirect_uri": _redirect_uri(p.id),
            "response_type": "code",
            "scope": " ".join(_provider_scopes(p)),
            "state": state,
        }
    for k, v in p.extra_authorize_params:
        params[k] = v

    return {"authorize_url": f"{p.authorize_url}?{urlencode(params)}"}


@router.get(
    "/zernio/{platform}/start",
    dependencies=[Depends(require_permission("connections.manage"))],
)
async def zernio_start(platform: str, user_id: int = Depends(require_token)) -> dict[str, str]:
    """Hosted Zernio authorize URL for linking ``platform`` to this workspace's
    Zernio profile. Mirrors /oauth/{provider}/start but for the unified
    provider; the frontend pops it like any other connect popup.

    Unlike the direct providers there is no callback to us — Zernio handles the
    OAuth and links the account to the profile, so the frontend just refetches
    /oauth/connections after the popup closes to see the new account.
    """
    from . import zernio

    workspace_id = get_active_workspace_id(user_id)
    if not workspace_id:
        raise HTTPException(
            status_code=401,
            detail="Sign in to a workspace before connecting a Zernio account.",
        )
    if not zernio.is_enabled(workspace_id):
        raise HTTPException(
            status_code=503,
            detail={"error": "zernio_not_configured", "missing": ["ZERNIO_API_KEY"]},
        )
    try:
        url = await zernio.start_connect(workspace_id, platform)
    except zernio.ZernioError as exc:
        # Upstream Zernio failure. A 5xx from Zernio is a bad gateway from our
        # side (not our server erroring), so report 502 with Zernio's own
        # message; pass 4xx (bad key / profile / platform) through with its
        # status. Either way the message reaches the UI notification.
        status = exc.status if exc.status and exc.status < 500 else 502
        raise HTTPException(status_code=status, detail=f"Zernio: {exc}")
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001 — never leak a bare 500; log + report
        import traceback

        print(f"[zernio_start] {platform} connect failed: {exc!r}")
        traceback.print_exc()
        raise HTTPException(status_code=502, detail=f"Zernio connect failed: {exc}")
    return {"authorize_url": url}


async def _exchange_code(
    provider: ProviderSpec, code: str
) -> dict[str, Any]:
    """Exchange an authorization code for an access token at the provider.

    Uses the standard OAuth2 form-encoded POST to the provider's token URL
    with one provider-specific quirk: TikTok wants `client_key` instead of
    `client_id`. Meta is fine with the standard body too (they accept the
    same parameters via either GET or POST).
    """
    client_id, client_secret = _provider_creds(provider)
    body = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": _redirect_uri(provider.id),
        "client_id": client_id,
        "client_secret": client_secret,
    }
    if provider.id == "tiktok":
        body["client_key"] = client_id
        body.pop("client_id", None)

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            provider.token_url,
            data=body,
            headers={"Accept": "application/json"},
        )
    if resp.status_code >= 400:
        raise HTTPException(
            status_code=502,
            detail={
                "message": "Token exchange failed.",
                "provider": provider.id,
                "upstream_status": resp.status_code,
            },
        )
    return resp.json()


async def _fetch_tiktok_user_info(access_token: str, granted_scope: str = "") -> dict[str, Any]:
    """Pull the connected TikTok user's display_name + avatar_url.

    Required so the Compose-screen creator card can show the actual
    avatar and @handle of the account a post will fire to — TikTok's
    audit reviewers reject submissions where the user info is missing
    from the publish flow.

    Returns {} on any upstream failure so the callback stays graceful;
    the row will just lack `display_name` / `avatar_url` until the user
    reconnects.
    """
    # TikTok's field-to-scope rules:
    #   user.info.basic   → open_id, union_id, avatar_url*, display_name
    #   user.info.profile → username, bio_description, profile_deep_link, is_verified
    #   user.info.stats   → follower_count, following_count, likes_count, video_count
    # Asking for a field your scope doesn't cover returns 401 scope_not_authorized
    # on the WHOLE response — so we filter the field list by what the granted
    # scope actually includes.
    if not access_token:
        return {}
    scopes = {s.strip() for s in granted_scope.split(",") if s.strip()}
    fields = ["open_id", "union_id", "avatar_url", "display_name"]
    if "user.info.profile" in scopes:
        fields.extend(["username", "bio_description", "is_verified"])
    if "user.info.stats" in scopes:
        fields.extend(["follower_count", "following_count", "likes_count", "video_count"])
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.get(
                "https://open.tiktokapis.com/v2/user/info/",
                headers={"Authorization": f"Bearer {access_token}"},
                params={"fields": ",".join(fields)},
            )
    except Exception:
        return {}
    if resp.status_code >= 400:
        return {}
    return (resp.json().get("data") or {}).get("user") or {}


async def _fetch_linkedin_user_info(access_token: str) -> dict[str, Any]:
    """Fetch LinkedIn member profile details from the OpenID userinfo endpoint."""
    if not access_token:
        return {}
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.get(
                "https://api.linkedin.com/v2/userinfo",
                headers={"Authorization": f"Bearer {access_token}"},
            )
    except Exception:
        return {}
    if resp.status_code >= 400:
        return {}
    return resp.json()


async def _fetch_linkedin_profile(access_token: str) -> dict[str, Any]:
    """Fallback LinkedIn member lookup through /v2/me.

    This supports apps that only have the legacy `r_liteprofile`
    permission instead of the OpenID Connect product.
    """
    if not access_token:
        return {}
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.get(
                "https://api.linkedin.com/v2/me",
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "X-Restli-Protocol-Version": "2.0.0",
                },
            )
    except Exception:
        return {}
    if resp.status_code >= 400:
        return {}
    return resp.json()

async def _refresh_tiktok_token(refresh_token: str) -> dict[str, Any]:
    """Trade a refresh_token for a new access_token + refresh_token pair.

    TikTok access tokens expire after 24h; refresh tokens are valid for
    365 days. Without this, every publish that hits an expired token 401s
    with `access_token_invalid` and the user has to manually disconnect /
    reconnect from the Settings UI. Returns the raw token-endpoint body
    on success, or {} on any error (caller falls back to the old token
    and surfaces the upstream error).
    """
    if not refresh_token:
        return {}
    p = PROVIDERS.get("tiktok")
    if not p:
        return {}
    try:
        client_id, client_secret = _provider_creds(p)
    except Exception:
        return {}
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(
                p.token_url,
                data={
                    "client_key": client_id,
                    "client_secret": client_secret,
                    "grant_type": "refresh_token",
                    "refresh_token": refresh_token,
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
    except Exception as exc:
        print(f"[tiktok-refresh] network error: {exc}")
        return {}
    if resp.status_code >= 400:
        print(f"[tiktok-refresh] {resp.status_code}: {resp.text[:300]}")
        return {}
    data = resp.json() or {}
    if not data.get("access_token"):
        print(f"[tiktok-refresh] no access_token in response: {data}")
        return {}
    return data


async def resolve_tiktok_access_token(user_id: int | None = None) -> str | None:
    """Return a valid TikTok access_token, refreshing if it's expired or
    about to be. Persists the refreshed token back to the store so the
    next call doesn't re-refresh.

    Returns None if there's no TikTok connection at all, or refresh failed.
    The caller should surface a "reconnect TikTok" error in that case.
    """
    tokens = _load_tokens(user_id)
    record = tokens.get("tiktok") or {}
    access_token = record.get("access_token")
    if not access_token:
        return None

    # 60s grace so we don't ship a token that expires mid-flight.
    expires_at = record.get("expires_at")
    if expires_at is None or expires_at - time.time() > 60:
        return access_token

    refresh_token = record.get("refresh_token") or (record.get("raw") or {}).get("refresh_token")
    if not refresh_token:
        print("[tiktok-refresh] no refresh_token on record — needs manual reconnect")
        return access_token  # let the caller try anyway; it may 401

    print("[tiktok-refresh] access_token expired, refreshing…")
    fresh = await _refresh_tiktok_token(refresh_token)
    if not fresh:
        return access_token  # refresh failed; caller will likely 401 + know to surface

    new_access = fresh["access_token"]
    new_refresh = fresh.get("refresh_token") or refresh_token
    new_expires_in = fresh.get("expires_in")
    record["access_token"] = new_access
    record["refresh_token"] = new_refresh
    record["scope"] = fresh.get("scope") or record.get("scope")
    record["expires_at"] = (time.time() + int(new_expires_in)) if new_expires_in else None
    record["obtained_at"] = time.time()
    raw = record.get("raw") or {}
    raw.update({
        "access_token": new_access,
        "refresh_token": new_refresh,
        "expires_in": new_expires_in,
        "refresh_expires_in": fresh.get("refresh_expires_in"),
        "scope": fresh.get("scope"),
    })
    record["raw"] = raw
    tokens["tiktok"] = record
    _save_tokens(tokens, user_id)
    print("[tiktok-refresh] persisted new token")
    return new_access


async def _refresh_linkedin_token(refresh_token: str) -> dict[str, Any]:
    """Trade a LinkedIn refresh_token for a fresh access_token.

    LinkedIn access tokens last ~60 days. Programmatic refresh tokens (issued
    only to apps approved for them) last a FIXED 365 days — the one-year clock
    starts at the ORIGINAL authorization and does NOT extend when you refresh,
    so after a year the member must fully reconnect. LinkedIn uses the standard
    OAuth client_id/client_secret (unlike TikTok's client_key). Returns the raw
    token-endpoint body on success, {} on any error.
    """
    if not refresh_token:
        return {}
    p = PROVIDERS.get("linkedin")
    if not p:
        return {}
    try:
        client_id, client_secret = _provider_creds(p)
    except Exception:
        return {}
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(
                p.token_url,
                data={
                    "grant_type": "refresh_token",
                    "refresh_token": refresh_token,
                    "client_id": client_id,
                    "client_secret": client_secret,
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
    except Exception as exc:
        print(f"[linkedin-refresh] network error: {exc}")
        return {}
    if resp.status_code >= 400:
        print(f"[linkedin-refresh] {resp.status_code}: {resp.text[:300]}")
        return {}
    data = resp.json() or {}
    if not data.get("access_token"):
        print(f"[linkedin-refresh] no access_token in response: {data}")
        return {}
    return data


async def resolve_linkedin_access_token(user_id: int | None = None) -> str | None:
    """Return a valid LinkedIn access_token, refreshing if it's expired or
    about to be. Persists the refreshed token back to the store.

    Returns None if there's no LinkedIn connection at all. If the record has
    no refresh_token (LinkedIn only mints them for apps approved for
    programmatic refresh tokens), returns the existing token and lets the
    caller's publish attempt surface a reconnect error on 401.
    """
    tokens = _load_tokens(user_id)
    record = tokens.get("linkedin") or {}
    access_token = record.get("access_token")
    if not access_token:
        return None

    # 60s grace so we don't ship a token that expires mid-flight.
    expires_at = record.get("expires_at")
    if expires_at is None or expires_at - time.time() > 60:
        return access_token

    refresh_token = record.get("refresh_token") or (record.get("raw") or {}).get("refresh_token")
    if not refresh_token:
        print("[linkedin-refresh] no refresh_token on record — needs manual reconnect")
        return access_token  # let the caller try anyway; it may 401

    print("[linkedin-refresh] access_token expired, refreshing…")
    fresh = await _refresh_linkedin_token(refresh_token)
    if not fresh:
        return access_token  # refresh failed; caller will likely 401 + know to surface

    new_access = fresh["access_token"]
    new_refresh = fresh.get("refresh_token") or refresh_token
    new_expires_in = fresh.get("expires_in")
    record["access_token"] = new_access
    record["refresh_token"] = new_refresh
    record["scope"] = fresh.get("scope") or record.get("scope")
    record["expires_at"] = (time.time() + int(new_expires_in)) if new_expires_in else None
    record["obtained_at"] = time.time()
    raw = record.get("raw") or {}
    raw.update({
        "access_token": new_access,
        "refresh_token": new_refresh,
        "expires_in": new_expires_in,
        "refresh_token_expires_in": fresh.get("refresh_token_expires_in"),
        "scope": fresh.get("scope"),
    })
    record["raw"] = raw
    tokens["linkedin"] = record
    _save_tokens(tokens, user_id)
    print("[linkedin-refresh] persisted new token")
    return new_access


async def _exchange_long_lived_meta(short_token: str) -> dict[str, Any]:
    """Meta returns a short-lived user token; trade it for the 60-day one."""
    p = PROVIDERS["meta"]
    client_id, client_secret = _provider_creds(p)
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(
            "https://graph.facebook.com/v21.0/oauth/access_token",
            params={
                "grant_type": "fb_exchange_token",
                "client_id": client_id,
                "client_secret": client_secret,
                "fb_exchange_token": short_token,
            },
        )
    if resp.status_code >= 400:
        # Non-fatal — keep the short-lived token, surface a warning.
        return {}
    return resp.json()


def _popup_close_html(provider_id: str, ok: bool, message: str = "", extra_data: dict[str, Any] = None) -> str:
    """HTML body that postMessages the opener and closes the popup."""
    payload_dict = {"type": "oauth:result", "provider": provider_id, "ok": ok, "message": message}
    if extra_data:
        payload_dict.update(extra_data)
    payload = json.dumps(payload_dict)
    title = "Connected" if ok else "Connection failed"
    return f"""<!doctype html>
<html><head><meta charset="utf-8"><title>{title}</title>
<style>body{{font-family:system-ui,sans-serif;padding:32px;text-align:center;color:#0f172a}}
.ok{{color:#22c55e}} .err{{color:#ef4444}}</style></head>
<body>
<h3 class="{'ok' if ok else 'err'}">{title}</h3>
<p>{message or ('You can close this window.' if ok else 'Please try again.')}</p>
<script>
  try {{ window.opener && window.opener.postMessage({payload}, "*"); }} catch (e) {{}}
  setTimeout(function() {{ window.close(); }}, 600);
</script>
</body></html>"""


@router.get("/tiktok/callback/{filename}", response_class=PlainTextResponse)
async def tiktok_domain_verify(filename: str) -> str:
    """Serve TikTok's domain-verification text file.

    TikTok asks you to host a tiktok<token>.txt file under the redirect URI
    to prove you control the domain. Token comes from TIKTOK_DOMAIN_VERIFY
    in the env — change it without redeploy.
    """
    expected = os.environ.get("TIKTOK_DOMAIN_VERIFY", "").strip()
    if not expected:
        raise HTTPException(404)
    if filename != f"tiktok{expected}.txt":
        raise HTTPException(404)
    return f"tiktok-developers-site-verification={expected}"


@router.get("/{provider_id}/callback", response_class=HTMLResponse)
async def oauth_callback(
    provider_id: str,
    code: str | None = Query(default=None),
    state: str | None = Query(default=None),
    error: str | None = Query(default=None),
) -> HTMLResponse:
    """Exchange the authorization code for an access token, persist it,
    then return a tiny HTML page that closes the popup and notifies the
    opener via postMessage."""
    # Diagnostic log so we can see what the provider actually sent when
    # things fail. Truncated so a leaked code isn't pasted whole into logs.
    print(
        f"[oauth] {provider_id} callback received: "
        f"code={'present' if code else 'MISSING'} "
        f"state={'present' if state else 'MISSING'} "
        f"error={error or 'none'}"
    )
    if provider_id not in PROVIDERS:
        return HTMLResponse(
            _popup_close_html(provider_id, False, "Unknown provider."),
            status_code=404,
        )
    if error:
        return HTMLResponse(
            _popup_close_html(provider_id, False, f"Provider error: {error}")
        )
    if not code or not state:
        return HTMLResponse(
            _popup_close_html(provider_id, False, "Missing code or state.")
        )

    global_tokens = _load_tokens(None)
    # Sweep expired pending-state entries (older than 10 minutes) so an
    # unauthenticated /start spammer can't pollute the store indefinitely.
    pending = {
        k: v
        for k, v in (global_tokens.get("_pending_state") or {}).items()
        if isinstance(v, dict)
        and (time.time() - (v.get("created_at") or 0)) < 600
    }
    global_tokens["_pending_state"] = pending
    pending_data = pending.get(state)
    if not pending_data or pending_data.get("provider") != provider_id:
        return HTMLResponse(
            _popup_close_html(provider_id, False, "Invalid or expired state token.")
        )
    pending.pop(state, None)
    _save_tokens(global_tokens, None)

    provider = PROVIDERS[provider_id]
    try:
        data = await _exchange_code(provider, code)
    except HTTPException as exc:
        msg = (
            exc.detail.get("message", "Token exchange failed.")
            if isinstance(exc.detail, dict)
            else str(exc.detail)
        )
        return HTMLResponse(_popup_close_html(provider_id, False, msg))

    access_token = data.get("access_token")
    if not access_token:
        return HTMLResponse(
            _popup_close_html(
                provider_id, False, "Provider response missing access_token."
            )
        )

    # Meta hands back a short-lived token by default; immediately upgrade
    # to the 60-day long-lived one so we don't have to re-prompt the user
    # every couple of hours. Non-fatal if the upgrade fails.
    if provider_id == "meta":
        long_lived = await _exchange_long_lived_meta(access_token)
        if long_lived.get("access_token"):
            data = {**data, **long_lived}
            access_token = long_lived["access_token"]

    # TikTok-specific: the token-exchange response includes `open_id` but
    # not the user's display name or avatar. Fetch those right after the
    # exchange so the connection record carries everything the compose
    # screen needs (avatar + @handle are reject-on-sight required).
    user_info: dict[str, Any] = {}
    if provider_id == "tiktok":
        # Pass the actual granted scope — TikTok 401s the whole user/info
        # response if you ask for a field outside it (e.g. `username` needs
        # user.info.profile, not basic).
        user_info = await _fetch_tiktok_user_info(access_token, data.get("scope") or "")
    elif provider_id == "linkedin":
        user_info = await _fetch_linkedin_user_info(access_token)
        if not user_info.get("sub"):
            legacy_profile = await _fetch_linkedin_profile(access_token)
            if legacy_profile:
                user_info = {
                    **user_info,
                    "sub": legacy_profile.get("id"),
                    "given_name": legacy_profile.get("localizedFirstName"),
                    "family_name": legacy_profile.get("localizedLastName"),
                    "name": " ".join(
                        part
                        for part in (
                            legacy_profile.get("localizedFirstName"),
                            legacy_profile.get("localizedLastName"),
                        )
                        if part
                    ).strip(),
                }

    # For posting providers we must know WHICH workspace is connecting and
    # persist the token ONLY to that workspace's scope. The pending-state row was
    # stamped with the connecting workspace_id at /start time. If it lacks one,
    # refuse — we never store posting tokens in the shared global scope, which
    # every workspace can read.
    raw_pending_ws = pending_data.get("workspace_id")
    try:
        connected_workspace_id = int(raw_pending_ws) if raw_pending_ws is not None else None
    except (TypeError, ValueError):
        connected_workspace_id = None
    if connected_workspace_id is not None and connected_workspace_id <= 0:
        connected_workspace_id = None
    if provider_id in _PER_USER_TOKEN_PROVIDERS and not connected_workspace_id:
        return HTMLResponse(
            _popup_close_html(
                provider_id,
                False,
                (
                    "This connection was not tied to a workspace and was "
                    "refused. Sign in, then connect the provider again."
                ),
            )
        )
    tokens = _load_tokens(connected_workspace_id)

    expires_in = data.get("expires_in")
    record = {
        "access_token": access_token,
        "refresh_token": data.get("refresh_token"),
        "scope": data.get("scope") or " ".join(_provider_scopes(provider)),
        "expires_at": (time.time() + int(expires_in)) if expires_in else None,
        "obtained_at": time.time(),
        # Stash the full response (minus the secrets we already split out)
        # so provider-specific fields like TikTok's open_id are recoverable.
        "raw": data,
    }
    if user_info:
        # Promote the common fields to top-level so callers don't have to
        # dig through `raw` to render an avatar.
        if provider_id == "tiktok":
            record["open_id"] = user_info.get("open_id")
            record["union_id"] = user_info.get("union_id")
            record["display_name"] = user_info.get("display_name")
            record["username"] = user_info.get("username")
            record["avatar_url"] = user_info.get("avatar_url")
            record["bio_description"] = user_info.get("bio_description")
            record["is_verified"] = user_info.get("is_verified")
            record["follower_count"] = user_info.get("follower_count")
            record["following_count"] = user_info.get("following_count")
            record["likes_count"] = user_info.get("likes_count")
            record["video_count"] = user_info.get("video_count")
        elif provider_id == "linkedin":
            person_id = user_info.get("sub")
            if person_id:
                record["urn"] = f"urn:li:person:{person_id}"
            record["display_name"] = user_info.get("name")
            record["first_name"] = user_info.get("given_name")
            record["last_name"] = user_info.get("family_name")
            record["avatar_url"] = user_info.get("picture")
            record["email"] = user_info.get("email")
    if provider_id == "linkedin" and not record.get("urn"):
        return HTMLResponse(
            _popup_close_html(
                provider_id,
                False,
                (
                    "LinkedIn connected, but no member profile target was returned. "
                    "Enable either OpenID Connect scopes "
                    "(openid profile email) or r_liteprofile on the LinkedIn app, "
                    "then reconnect."
                ),
            )
        )
    tokens[provider_id] = record
    _save_tokens(tokens, connected_workspace_id)

    return HTMLResponse(
        _popup_close_html(provider_id, True, f"{provider.label} connected.")
    )


@router.delete(
    "/{provider_id}",
    dependencies=[Depends(require_permission("connections.manage"))],
)
async def oauth_disconnect(provider_id: str, user_id: int = Depends(require_token)) -> dict[str, str]:
    """Forget the stored token for this provider."""
    if provider_id not in PROVIDERS:
        raise HTTPException(404, f"Unknown provider: {provider_id}")
    tokens = _load_tokens(get_active_workspace_id(user_id))
    tokens.pop(provider_id, None)
    _save_tokens(tokens, get_active_workspace_id(user_id))
    return {"status": "disconnected", "provider": provider_id}


async def _fetch_meta_pages(user_token: str) -> list[dict[str, Any]]:
    """Internal helper — calls /me/accounts and unwraps the response.

    Returns [] on any upstream failure (graceful — the connections endpoint
    shouldn't 502 just because a single provider hiccupped).

    Audience counts (fan_count, IG followers_count) ride along for the
    dashboard's "Subscribers / Audience" tiles — they used to be MOCK
    placeholders, now they're real numbers from Meta directly.
    """
    if not user_token:
        return []
    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.get(
            "https://graph.facebook.com/v21.0/me/accounts",
            params={
                "access_token": user_token,
                "fields": (
                    "id,name,category,access_token,fan_count,"
                    "instagram_business_account{"
                    "id,username,profile_picture_url,followers_count"
                    "}"
                ),
                "limit": 100,
            },
        )
    if resp.status_code >= 400:
        return []
    raw_pages = resp.json().get("data", [])
    pages: list[dict[str, Any]] = []
    for p in raw_pages:
        ig = p.get("instagram_business_account") or {}
        pages.append(
            {
                "page_id": p.get("id"),
                "page_name": p.get("name"),
                "page_category": p.get("category"),
                "page_access_token": p.get("access_token"),
                "fan_count": p.get("fan_count"),
                "instagram": (
                    {
                        "ig_id": ig.get("id"),
                        "username": ig.get("username"),
                        "profile_picture_url": ig.get("profile_picture_url"),
                        "followers_count": ig.get("followers_count"),
                    }
                    if ig.get("id")
                    else None
                ),
            }
        )
    return pages


@router.get("/meta/accounts", dependencies=[Depends(require_permission("connections.read"))])
async def meta_accounts(user_id: int = Depends(require_token)) -> dict[str, Any]:
    """Return every FB Page the connected user admins, plus any IG Business
    account linked to each Page. Each entry includes the Page access token
    so callers can publish without another round-trip."""
    tokens = _load_tokens(get_active_workspace_id(user_id))
    meta_record = tokens.get("meta") or {}
    user_token = meta_record.get("access_token")
    if not user_token:
        raise HTTPException(409, "Meta is not connected. Run OAuth first.")
    pages = await _fetch_meta_pages(user_token)
    return {"pages": pages}


@router.get("/connections", dependencies=[Depends(require_permission("connections.read"))])
async def connections(user_id: int = Depends(require_token)) -> dict[str, Any]:
    """Frontend-friendly view of all OAuth connections.

    For each platform: configured, connected, and (when connected) a
    `targets` list of publishable destinations — FB Pages, linked IG
    accounts, LinkedIn member/orgs, TikTok handles. The UI uses this to
    render "Connected as @… with X Pages / Y IG accounts" without
    hitting multiple endpoints.

    Tokens are NEVER returned here — only ids and human-readable labels.
    Callers that need a token go through /oauth/meta/accounts (or future
    per-provider equivalents) so we can audit token egress separately.
    """
    tokens = _load_tokens(get_active_workspace_id(user_id))
    out: dict[str, Any] = {"providers": {}}

    for p in PROVIDERS.values():
        record = tokens.get(p.id) or {}
        access_token = record.get("access_token")
        status = _provider_status(p)
        connected = bool(access_token)
        entry: dict[str, Any] = {
            "id": p.id,
            "label": p.label,
            "configured": status["configured"],
            "connected": connected,
            "missing_env": status["missing_env"],
            "targets": [],
        }
        if connected:
            entry["expires_at"] = record.get("expires_at")
            entry["scope"] = record.get("scope")

        if connected and p.id == "meta":
            pages = await _fetch_meta_pages(access_token)
            for page in pages:
                entry["targets"].append(
                    {
                        "id": page["page_id"],
                        "label": page["page_name"],
                        "kind": "facebook_page",
                        "category": page.get("page_category"),
                        # Audience count surfaces in the dashboard's Subscribers
                        # tile; can be None if Meta hasn't propagated it yet.
                        "audience": page.get("fan_count"),
                    }
                )
                if page.get("instagram"):
                    ig = page["instagram"]
                    entry["targets"].append(
                        {
                            "id": ig["ig_id"],
                            "label": f"@{ig['username']}" if ig.get("username") else ig["ig_id"],
                            "kind": "instagram_business",
                            "linked_to_page_id": page["page_id"],
                            "profile_picture_url": ig.get("profile_picture_url"),
                            "audience": ig.get("followers_count"),
                        }
                    )

        if connected and p.id == "tiktok":
            # One target per connected TikTok account. We persisted
            # display_name / username / avatar_url on the token record at
            # callback time, so no extra round-trip here. open_id is what
            # the publish API takes as the target identifier — same field
            # the publish handler expects.
            open_id = record.get("open_id") or (record.get("raw") or {}).get("open_id")
            if open_id:
                handle = record.get("username") or record.get("display_name") or open_id
                entry["targets"].append(
                    {
                        "id": open_id,
                        "label": f"@{handle}" if not handle.startswith("@") else handle,
                        "kind": "tiktok_account",
                        "display_name": record.get("display_name"),
                        "profile_picture_url": record.get("avatar_url"),
                        # `audience` is the field the dashboard sums across
                        # platforms for the "Total audience" KPI — same key
                        # the IG branch uses, so TikTok auto-rolls up.
                        "audience": record.get("follower_count"),
                        "is_verified": record.get("is_verified"),
                        "bio_description": record.get("bio_description"),
                        "likes_count": record.get("likes_count"),
                        "video_count": record.get("video_count"),
                    }
                )

        if connected and p.id == "linkedin":
            urn = record.get("urn") or (record.get("raw") or {}).get("urn")
            if urn:
                label = record.get("display_name") or urn
                entry["targets"].append(
                    {
                        "id": urn,
                        "label": label,
                        "kind": "linkedin_member",
                        "profile_picture_url": record.get("avatar_url"),
                    }
                )

        out["providers"][p.id] = entry

    # Zernio (optional unified provider) folded in alongside the direct
    # providers so Settings + the publish path treat it uniformly. Inert
    # (configured=False) when no ZERNIO_API_KEY is set for the workspace, and
    # never allowed to break the whole connections view.
    from . import zernio

    try:
        out["providers"]["zernio"] = await zernio.connections_entry(
            get_active_workspace_id(user_id)
        )
    except Exception as exc:  # noqa: BLE001
        out["providers"]["zernio"] = {
            "id": "zernio",
            "label": zernio.LABEL,
            "configured": True,
            "connected": False,
            "missing_env": [],
            "targets": [],
            "is_aggregator": True,
            "error": str(exc),
        }

    return out
