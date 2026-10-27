from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from martian.config import get_settings
from martian.db.base import org_session, system_session
from martian.db.models import Membership, Role, User
from martian.security.auth import SESSION_COOKIE, bearer_matches, read_session
from martian.services.audit import Actor

UNSAFE = {"POST", "PUT", "PATCH", "DELETE"}


@dataclass
class Principal:
    user_id: uuid.UUID
    org_id: uuid.UUID
    email: str
    name: str
    role: str
    ip: str | None

    @property
    def actor(self) -> Actor:
        return Actor("user", str(self.user_id), self.email, self.ip)

    def at_least(self, role: Role) -> bool:
        return Role(self.role).rank >= role.rank

    def as_dict(self) -> dict:
        return {"user_id": str(self.user_id), "role": self.role, "email": self.email}


def client_ip(request: Request) -> str | None:
    fwd = request.headers.get("x-forwarded-for")
    return fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else None)


def _check_origin(request: Request) -> None:
    """CSRF defense for cookie sessions: unsafe requests must come from our web origin."""
    if request.method not in UNSAFE or "authorization" in request.headers:
        return
    origin = request.headers.get("origin") or request.headers.get("referer", "")
    allowed = {get_settings().web_origin.rstrip("/"), get_settings().api_public_url.rstrip("/")}
    if origin and not any(origin.startswith(a) for a in allowed):
        raise HTTPException(403, "This request came from another site, so Martian blocked it.")


async def current_principal(request: Request) -> Principal:
    _check_origin(request)
    token = request.cookies.get(SESSION_COOKIE)
    auth = request.headers.get("authorization", "")
    if not token and auth.lower().startswith("bearer "):
        token = auth[7:]
    claims = read_session(token) if token else None
    if not claims:
        raise HTTPException(401, "Sign in to continue.")
    user_id, org_id = uuid.UUID(claims["sub"]), uuid.UUID(claims["org"])
    async with system_session() as s:
        row = (
            await s.execute(
                select(User, Membership.role)
                .join(Membership, Membership.user_id == User.id)
                .where(User.id == user_id, Membership.org_id == org_id)
            )
        ).first()
    if row is None:
        raise HTTPException(401, "Your access to this organization was removed.")
    user, role = row
    return Principal(user.id, org_id, user.email, user.name, role, client_ip(request))


def require(role: Role):
    async def dep(p: Principal = Depends(current_principal)) -> Principal:
        if not p.at_least(role):
            raise HTTPException(403, f"This needs the {role.value} role or higher.")
        return p

    return dep


async def tenant_db(p: Principal = Depends(current_principal)) -> AsyncIterator[AsyncSession]:
    async with org_session(p.org_id) as s:
        yield s


def require_internal(request: Request) -> None:
    if not bearer_matches(request.headers.get("authorization"), get_settings().internal_token):
        raise HTTPException(401, "internal token required")
