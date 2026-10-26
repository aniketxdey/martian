"""Overview, findings, actions, scans and agent activity."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from martian.api.deps import Principal, current_principal, require, tenant_db
from martian.db.models import Action, AuditEntry, Finding, Role, Scan
from martian.jobs.queue import enqueue
from martian.services import findings as svc
from martian.services.overview import finding_dict, overview

router = APIRouter(tags=["core"])


@router.get("/overview")
async def get_overview(
    p: Principal = Depends(current_principal), s: AsyncSession = Depends(tenant_db)
) -> dict:
    return await overview(s, p.org_id)


@router.get("/findings")
async def list_findings(
    status: str = "active", p: Principal = Depends(current_principal), s: AsyncSession = Depends(tenant_db)
) -> dict:
    q = select(Finding).where(Finding.org_id == p.org_id)
    if status == "active":
        # What the Overview table shows: open and in-flight work, plus recently applied.
        q = q.where(Finding.status.in_(["open", "approved", "running", "applied", "failed"]))
    elif status != "all":
        q = q.where(Finding.status == status)
    rows = (await s.execute(q.order_by(Finding.est_monthly_savings.desc()))).scalars()
    return {"findings": [finding_dict(f) for f in rows]}


@router.get("/findings/{finding_id}")
async def get_finding(
    finding_id: uuid.UUID, p: Principal = Depends(current_principal), s: AsyncSession = Depends(tenant_db)
) -> dict:
    f = await s.get(Finding, finding_id)
    if f is None:
        raise HTTPException(404, "finding not found")
    actions = (
        await s.execute(select(Action).where(Action.finding_id == finding_id).order_by(Action.created_at))
    ).scalars()
    return {**finding_dict(f), "actions": [_action(a) for a in actions]}


class DismissBody(BaseModel):
    reason: str = ""


@router.post("/findings/{finding_id}/approve")
async def approve(
    finding_id: uuid.UUID,
    p: Principal = Depends(require(Role.approver)),
    s: AsyncSession = Depends(tenant_db),
) -> dict:
    f = await svc.approve_finding(s, p.org_id, finding_id, p.actor, p.role, p.user_id)
    return finding_dict(f)


@router.post("/findings/{finding_id}/dismiss")
async def dismiss(
    finding_id: uuid.UUID,
    body: DismissBody,
    p: Principal = Depends(require(Role.approver)),
    s: AsyncSession = Depends(tenant_db),
) -> dict:
    return finding_dict(await svc.dismiss_finding(s, p.org_id, finding_id, p.actor, p.role, body.reason))


@router.get("/actions")
async def list_actions(
    limit: int = 50, p: Principal = Depends(current_principal), s: AsyncSession = Depends(tenant_db)
) -> dict:
    rows = (
        await s.execute(
            select(Action)
            .where(Action.org_id == p.org_id)
            .order_by(Action.created_at.desc())
            .limit(min(limit, 200))
        )
    ).scalars()
    return {"actions": [_action(a) for a in rows]}


@router.post("/actions/{action_id}/rollback")
async def rollback(
    action_id: uuid.UUID, p: Principal = Depends(require(Role.approver)), s: AsyncSession = Depends(tenant_db)
) -> dict:
    a = await s.get(Action, action_id)
    if a is None:
        raise HTTPException(404, "action not found")
    if a.status != "succeeded" or not a.rollback:
        raise HTTPException(409, "this action can't be rolled back")
    await enqueue(
        s,
        "rollback_action",
        {"action_id": str(a.id)},
        org_id=p.org_id,
        dedupe_key=f"rollback:{a.id}",
        max_attempts=1,
    )
    return {"queued": True}


@router.post("/scans")
async def start_scan(
    p: Principal = Depends(require(Role.approver)), s: AsyncSession = Depends(tenant_db)
) -> dict:
    job = await enqueue(s, "scan", {"trigger": "manual"}, org_id=p.org_id, dedupe_key=f"scan:{p.org_id}")
    return {"queued": job is not None}


@router.get("/scans/latest")
async def latest_scan(
    p: Principal = Depends(current_principal), s: AsyncSession = Depends(tenant_db)
) -> dict:
    scan = (
        await s.execute(select(Scan).where(Scan.org_id == p.org_id).order_by(Scan.started_at.desc()).limit(1))
    ).scalar_one_or_none()
    if scan is None:
        return {"scan": None}
    return {
        "scan": {
            "id": str(scan.id),
            "status": scan.status,
            "started_at": scan.started_at.isoformat(),
            "finished_at": scan.finished_at.isoformat() if scan.finished_at else None,
            "stats": scan.stats,
        }
    }


@router.get("/activity")
async def activity(
    limit: int = 20, p: Principal = Depends(current_principal), s: AsyncSession = Depends(tenant_db)
) -> dict:
    rows = (
        await s.execute(
            select(AuditEntry)
            .where(AuditEntry.org_id == p.org_id, AuditEntry.actor_type.in_(["agent", "system"]))
            .order_by(AuditEntry.id.desc())
            .limit(min(limit, 100))
        )
    ).scalars()
    return {
        "activity": [
            {
                "id": e.id,
                "agent": e.actor_label,
                "text": e.summary,
                "at": e.at.isoformat(),
                "action": e.action,
                "target_type": e.target_type,
            }
            for e in rows
        ]
    }


def _action(a: Action) -> dict:
    return {
        "id": str(a.id),
        "finding_id": str(a.finding_id) if a.finding_id else None,
        "integration_id": str(a.integration_id),
        "tool": a.tool,
        "args": a.args,
        "description": a.description,
        "status": a.status,
        "requested_by": a.requested_by,
        "approved_at": a.approved_at.isoformat() if a.approved_at else None,
        "result": a.result,
        "error": a.error,
        "reversible": bool(a.rollback),
        "created_at": a.created_at.isoformat(),
        "finished_at": a.finished_at.isoformat() if a.finished_at else None,
    }
