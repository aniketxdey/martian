"""Passwords (argon2id), session tokens (JWT HS256) and connector tokens."""

from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

from martian.config import get_settings

_hasher = PasswordHasher()
SESSION_COOKIE = "martian_session"


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str | None) -> bool:
    if not password_hash:
        return False
    try:
        return _hasher.verify(password_hash, password)
    except (VerificationError, InvalidHashError):
        return False


def issue_session(user_id: uuid.UUID, org_id: uuid.UUID) -> str:
    s = get_settings()
    now = datetime.now(UTC)
    payload = {
        "sub": str(user_id),
        "org": str(org_id),
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(hours=s.session_ttl_hours)).timestamp()),
        "typ": "session",
    }
    return jwt.encode(payload, s.session_secret, algorithm="HS256")


def read_session(token: str) -> dict[str, Any] | None:
    try:
        payload = jwt.decode(token, get_settings().session_secret, algorithms=["HS256"])
    except jwt.PyJWTError:
        return None
    return payload if payload.get("typ") == "session" else None


def new_connector_token() -> tuple[str, str, str]:
    """Returns (token, sha256 hash, display prefix). Only the hash is stored."""
    token = "mct_" + secrets.token_urlsafe(32)
    return token, hash_token(token), token[:12]


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()
