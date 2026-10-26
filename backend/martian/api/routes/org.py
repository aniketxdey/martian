"""Organization settings, members and the audit log."""

from __future__ import annotations

import secrets
import uuid
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from martian.api.deps import Principal, current_principal, require, tenant_db
from martian.db.base import system_session
from martian.db.models import AuditEntry, Membership, Organization, Role, User
from martian.security.auth import hash_password
from martian.services import audit

router = APIRouter(tags=["org"])


class OrgSettings(BaseModel):
    name: str | None = None
    default_mode: Literal["read", "ask", "auto"] | None = None
    auto_approve_max_monthly: float | None = None
    maintenance_window: str | None = None


@router.get("/org")
async def get_org(p: Principal = Depends(current_principal)) -> dict:
    async with system_session() as s:
        org = await s.get(Organization, p.org_id)
    assert org is not None
    return {
        "id": str(org.id),
        "name": org.name,
        "slug": org.slug,
        "settings": {
            "default_mode": "ask",
            "auto_approve_max_monthly": 1000,
            "maintenance_window": "",
            **(org.settings or {}),
        },
    }


@router.patch("/org")
async def update_org(
    body: OrgSettings, p: Principal = Depends(require(Role.admin)), s: AsyncSession = Depends(tenant_db)
) -> dict:
    org = await s.get(Organization, p.org_id)
    assert org is not None
    data = body.model_dump(exclude_none=True)
    if "name" in data:
        org.name = data.pop("name")
    org.settings = {**(org.settings or {}), **data}
    await audit.record(
        s, p.org_id, p.actor, "org.updated", summary="updated organization settings", details=data
    )
    return {"id": str(org.id), "name": org.name, "settings": org.settings}


@router.get("/members")
async def members(p: Principal = Depends(current_principal), s: AsyncSession = Depends(tenant_db)) -> dict:
    rows = await s.execute(
        select(User, Membership.role)
        .join(Membership, Membership.user_id == User.id)
        .where(Membership.org_id == p.org_id)
        .order_by(User.email)
    )
    return {
        "members": [
            {
                "id": str(u.id),
                "email": u.email,
                "name": u.name,
                "role": r,
                "last_login_at": u.last_login_at.isoformat() if u.last_login_at else None,
            }
            for u, r in rows
        ]
    }


class InviteBody(BaseModel):
    email: EmailStr
    name: str = ""
    role: Literal["viewer", "approver", "admin"] = "viewer"


@router.post("/members", status_code=201)
async def invite(
    body: InviteBody, p: Principal = Depends(require(Role.admin)), s: AsyncSession = Depends(tenant_db)
) -> dict[str, Any]:
    temp_password = None
    async with system_session() as sys:
        user = (
            await sys.execute(select(User).where(func.lower(User.email) == body.email.lower()))
        ).scalar_one_or_none()
        if user is None:
            temp_password = secrets.token_urlsafe(12)
            user = User(email=body.email.lower(), name=body.name, password_hash=hash_password(temp_password))
            sys.add(user)
            await sys.flush()
        if await sys.get(Membership, (p.org_id, user.id)) is not None:
            raise HTTPException(409, "already a member")
        sys.add(Membership(org_id=p.org_id, user_id=user.id, role=body.role))
        user_id = user.id
    await audit.record(
        s,
        p.org_id,
        p.actor,
        "member.added",
        target_type="user",
        target_id=str(user_id),
        summary=f"added {body.email} as {body.role}",
    )
    return {"id": str(user_id), "email": body.email, "role": body.role, "temporary_password": temp_password}


class RoleBody(BaseModel):
    role: Literal["viewer", "approver", "admin", "owner"]


@router.patch("/members/{user_id}")
async def set_role(
    user_id: uuid.UUID,
    body: RoleBody,
    p: Principal = Depends(require(Role.admin)),
    s: AsyncSession = Depends(tenant_db),
) -> dict:
    if body.role == "owner" and p.role != "owner":
        raise HTTPException(403, "only an owner can grant owner")
    async with system_session() as sys:
        m = await sys.get(Membership, (p.org_id, user_id))
        if m is None:
            raise HTTPException(404, "member not found")
        m.role = body.role
    await audit.record(
        s,
        p.org_id,
        p.actor,
        "member.role_changed",
        target_type="user",
        target_id=str(user_id),
        summary=f"changed role to {body.role}",
    )
    return {"id": str(user_id), "role": body.role}


@router.delete("/members/{user_id}")
async def remove_member(
    user_id: uuid.UUID, p: Principal = Depends(require(Role.admin)), s: AsyncSession = Depends(tenant_db)
) -> dict:
    if user_id == p.user_id:
        raise HTTPException(400, "you can't remove yourself")
    async with system_session() as sys:
        m = await sys.get(Membership, (p.org_id, user_id))
        if m is None:
            raise HTTPException(404, "member not found")
        await sys.delete(m)
    await audit.record(
        s,
        p.org_id,
        p.actor,
        "member.removed",
        target_type="user",
        target_id=str(user_id),
        summary="removed a member",
    )
    return {"removed": True}


@router.get("/audit")
async def audit_log(
    limit: int = 100,
    before: int | None = None,
    p: Principal = Depends(require(Role.approver)),
    s: AsyncSession = Depends(tenant_db),
) -> dict:
    q = select(AuditEntry).where(AuditEntry.org_id == p.org_id)
    if before:
        q = q.where(AuditEntry.id < before)
    rows = (await s.execute(q.order_by(AuditEntry.id.desc()).limit(min(limit, 500)))).scalars()
    return {
        "entries": [
            {
                "id": e.id,
                "at": e.at.isoformat(),
                "actor": e.actor_label or e.actor_id,
                "actor_type": e.actor_type,
                "action": e.action,
                "target_type": e.target_type,
                "target_id": e.target_id,
                "summary": e.summary,
                "details": e.details,
                "ip": e.ip,
            }
            for e in rows
        ]
    }


@router.get("/audit/verify")
async def verify(p: Principal = Depends(require(Role.admin)), s: AsyncSession = Depends(tenant_db)) -> dict:
    return {"intact": await audit.verify_chain(s, p.org_id)}
