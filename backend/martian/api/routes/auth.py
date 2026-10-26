from __future__ import annotations

import secrets
import uuid
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select

from martian.api.deps import Principal, client_ip, current_principal
from martian.config import get_settings
from martian.db.base import org_session, system_session, utcnow
from martian.db.models import Membership, Organization, Role, User
from martian.security.auth import SESSION_COOKIE, issue_session, verify_password
from martian.services import audit

router = APIRouter(prefix="/auth", tags=["auth"])
SSO_STATE_COOKIE = "martian_sso_state"


class LoginBody(BaseModel):
    email: str = Field(max_length=320)
    password: str


def _set_session(response: Response, user_id: uuid.UUID, org_id: uuid.UUID) -> None:
    s = get_settings()
    response.set_cookie(
        SESSION_COOKIE,
        issue_session(user_id, org_id),
        max_age=s.session_ttl_hours * 3600,
        httponly=True,
        secure=s.cookie_secure,
        samesite="lax",
        path="/",
    )


async def _me(user: User, org: Organization, role: str) -> dict:
    name = user.name or user.email.split("@")[0]
    return {
        "user": {"id": str(user.id), "email": user.email, "name": name},
        "org": {"id": str(org.id), "name": org.name, "slug": org.slug},
        "role": role,
        "sso_enabled": bool(get_settings().workos_api_key),
        # Flat copies for the console header.
        "email": user.email,
        "name": name,
        "org_name": org.name,
    }


@router.post("/login")
async def login(body: LoginBody, request: Request, response: Response) -> dict:
    async with system_session() as s:
        user = (
            await s.execute(select(User).where(func.lower(User.email) == body.email.lower()))
        ).scalar_one_or_none()
        if user is None or not verify_password(body.password, user.password_hash):
            raise HTTPException(401, "That email and password don't match an account.")
        membership = (
            (
                await s.execute(
                    select(Membership).where(Membership.user_id == user.id).order_by(Membership.created_at)
                )
            )
            .scalars()
            .first()
        )
        if membership is None:
            raise HTTPException(403, "You don't belong to an organization yet")
        org = await s.get(Organization, membership.org_id)
        user.last_login_at = utcnow()
    assert org is not None
    async with org_session(org.id) as s:
        await audit.record(
            s,
            org.id,
            audit.Actor("user", str(user.id), user.email, client_ip(request)),
            "auth.login",
            summary="signed in",
        )
    _set_session(response, user.id, org.id)
    return await _me(user, org, membership.role)


@router.post("/logout")
async def logout(response: Response) -> dict:
    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"ok": True}


@router.get("/me")
async def me(p: Principal = Depends(current_principal)) -> dict:
    async with system_session() as s:
        user = await s.get(User, p.user_id)
        org = await s.get(Organization, p.org_id)
    assert user and org
    return await _me(user, org, p.role)


# ---- WorkOS SSO (SAML/OIDC). Organizations are matched by email domain.


@router.get("/sso/start")
async def sso_start(email: EmailStr) -> Response:
    s = get_settings()
    if not (s.workos_api_key and s.workos_client_id):
        raise HTTPException(404, "SSO isn't configured for this Martian install.")
    domain = email.split("@", 1)[1].lower()
    async with system_session() as db:
        org = (
            await db.execute(select(Organization).where(Organization.email_domain == domain))
        ).scalar_one_or_none()
    if org is None or not org.workos_org_id:
        raise HTTPException(404, "SSO isn't set up for this email domain")
    state = secrets.token_urlsafe(24)
    params = {
        "client_id": s.workos_client_id,
        "redirect_uri": f"{s.api_public_url.rstrip('/')}/auth/sso/callback",
        "response_type": "code",
        "organization": org.workos_org_id,
        "state": state,
    }
    resp = RedirectResponse("https://api.workos.com/sso/authorize?" + urlencode(params))
    resp.set_cookie(
        SSO_STATE_COOKIE, state, max_age=600, httponly=True, secure=s.cookie_secure, samesite="lax"
    )
    return resp


@router.get("/sso/callback")
async def sso_callback(code: str, state: str, request: Request) -> Response:
    s = get_settings()
    if not s.workos_api_key or request.cookies.get(SSO_STATE_COOKIE) != state:
        raise HTTPException(400, "That sign-in link expired. Start SSO again.")
    async with httpx.AsyncClient(timeout=15) as http:
        r = await http.post(
            "https://api.workos.com/sso/token",
            data={
                "client_id": s.workos_client_id,
                "client_secret": s.workos_api_key,
                "grant_type": "authorization_code",
                "code": code,
            },
        )
    if r.status_code != 200:
        raise HTTPException(401, "SSO sign-in didn't work. Try again or use your password.")
    profile = r.json()["profile"]
    email = profile["email"].lower()
    async with system_session() as db:
        org = (
            await db.execute(
                select(Organization).where(Organization.workos_org_id == profile.get("organization_id"))
            )
        ).scalar_one_or_none()
        if org is None:
            raise HTTPException(403, "Your organization isn't set up in Martian")
        user = (await db.execute(select(User).where(func.lower(User.email) == email))).scalar_one_or_none()
        if user is None:  # just-in-time provisioning as a viewer
            name = " ".join(filter(None, [profile.get("first_name"), profile.get("last_name")]))
            user = User(email=email, name=name)
            db.add(user)
            await db.flush()
        membership = await db.get(Membership, (org.id, user.id))
        if membership is None:
            db.add(Membership(org_id=org.id, user_id=user.id, role=Role.viewer.value))
        user.last_login_at = utcnow()
        user_id, org_id = user.id, org.id
    resp = RedirectResponse(s.web_origin)
    _set_session(resp, user_id, org_id)
    resp.delete_cookie(SSO_STATE_COOKIE)
    return resp
