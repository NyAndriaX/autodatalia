"""Authentication logic using JWT and SQLite."""

import hmac
import time
from typing import Any

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from .config import settings
from .db import create_user, get_user_by_email, get_user_by_id, verify_password, get_password_hash

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginRequest(BaseModel):
    email: str
    password: str


class RegisterRequest(BaseModel):
    email: str
    password: str
    name: str = ""


class AuthResponse(BaseModel):
    token: str
    user: dict[str, Any]


def create_jwt_token(user_id: int) -> str:
    """Generate a JWT for the given user ID."""
    payload = {
        "sub": str(user_id),
        "exp": time.time() + 30 * 24 * 3600,  # 30 days
        "iat": time.time(),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def require_token(request: Request) -> int:
    """Extract and verify the JWT from the Authorization header. Returns user_id."""
    auth = request.headers.get("authorization") or ""
    presented = ""
    if auth.lower().startswith("bearer "):
        presented = auth.split(" ", 1)[1].strip()
    if not presented:
        presented = request.query_params.get("token", "")

    # Fallback to the global token for backward compatibility if configured
    if settings.backend_auth_token and hmac.compare_digest(presented, settings.backend_auth_token):
        return 1  # Dummy user ID for global token usage

    if not presented:
        if not settings.backend_auth_token:
            return 1  # Open mode fallback to dummy user
        raise HTTPException(status_code=401, detail="Missing authorization token.")

    try:
        payload = jwt.decode(presented, settings.jwt_secret, algorithms=["HS256"])
        user_id = int(payload["sub"])
        return user_id
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token has expired.")
    except (jwt.InvalidTokenError, ValueError):
        raise HTTPException(status_code=401, detail="Invalid token.")


@router.post("/register", response_model=AuthResponse)
async def register(req: RegisterRequest) -> dict[str, Any]:
    if get_user_by_email(req.email):
        raise HTTPException(status_code=400, detail="Email already registered.")
    
    password_hash = get_password_hash(req.password)
    user_id = create_user(req.email, password_hash, req.name)
    
    token = create_jwt_token(user_id)
    return {
        "token": token,
        "user": {
            "id": str(user_id),
            "email": req.email,
            "name": req.name,
            "role": "admin"
        }
    }


@router.post("/login", response_model=AuthResponse)
async def login(req: LoginRequest) -> dict[str, Any]:
    user = get_user_by_email(req.email)
    if not user or not user.get("password_hash"):
        raise HTTPException(status_code=401, detail="Invalid credentials.")
    
    if not verify_password(req.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials.")
    
    token = create_jwt_token(user["id"])
    return {
        "token": token,
        "user": {
            "id": str(user["id"]),
            "email": user["email"],
            "name": user["full_name"],
            "role": "admin"
        }
    }

@router.get("/me")
async def get_me(user_id: int = Depends(require_token)) -> dict[str, Any]:
    if user_id == 1 and settings.backend_auth_token:
        # Global dummy user
        return {"id": "1", "email": "team@datalia.app", "name": "Global Admin", "role": "admin"}
    
    user = get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    
    return {
        "id": str(user["id"]),
        "email": user["email"],
        "name": user["full_name"],
        "role": "admin"
    }
