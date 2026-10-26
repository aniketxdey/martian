"""Read models shared by the API and the agents."""

from __future__ import annotations

import uuid
from datetime import timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from martian.db.base import utcnow
from martian.db.models import Finding, Integration, Resource, Scan

OPEN_STATES = ("open", "approved", "running")


def health_score(monthly_cost: float, waste: float, attention: int, scan_age_hours: float | None) -> int:
    """0-100. Penalizes waste as a share of spend, integrations needing attention and stale scans."""
    score = 100.0
    if monthly_cost > 0:
        score -= min(60.0, 100.0 * waste / monthly_cost)
    score -= 5 * attention
    if scan_age_hours is None or scan_age_hours > 24:
        score -= 10
    return max(0, min(100, round(score)))


async def overview(s: AsyncSession, org_id: uuid.UUID) -> dict[str, Any]:
    cost, resources, accounts = (
        await s.execute(
            select(
                func.coalesce(func.sum(Resource.monthly_cost), 0),
                func.count(Resource.id),
                func.count(func.distinct(Resource.provider + ":" + Resource.account)).filter(
                    Resource.provider.in_(["aws", "azure", "gcp"])
                ),
            ).where(Resource.org_id == org_id)
        )
    ).one()
    waste, open_count = (
        await s.execute(
            select(func.coalesce(func.sum(Finding.est_monthly_savings), 0), func.count(Finding.id)).where(
                Finding.org_id == org_id, Finding.status.in_(OPEN_STATES)
            )
        )
    ).one()
    realized = (
        await s.execute(
            select(func.coalesce(func.sum(Finding.realized_monthly_savings), 0)).where(
                Finding.org_id == org_id, Finding.status == "applied"
            )
        )
    ).scalar_one()
    attention = (
        await s.execute(
            select(func.count(Integration.id)).where(
                Integration.org_id == org_id,
                Integration.enabled.is_(True),
                Integration.status.in_(["auth", "error"]),
            )
        )
    ).scalar_one()
    last_scan = (
        await s.execute(
            select(Scan)
            .where(Scan.org_id == org_id, Scan.finished_at.is_not(None))
            .order_by(Scan.finished_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    age = (
        (utcnow() - last_scan.finished_at).total_seconds() / 3600
        if last_scan and last_scan.finished_at
        else None
    )
    running = (
        await s.execute(
            select(func.count(Scan.id)).where(
                Scan.org_id == org_id,
                Scan.status == "running",
                Scan.started_at > utcnow() - timedelta(hours=1),
            )
        )
    ).scalar_one()
    return {
        "monthly_cost": float(cost),
        "resources": int(resources),
        "accounts": int(accounts),
        "waste_identified": float(waste),
        "open_findings": int(open_count),
        "realized_monthly_savings": float(realized),
        "realized_savings": float(realized),
        "integrations_needing_attention": int(attention),
        "health_score": health_score(float(cost), float(waste), int(attention), age),
        "last_scan_at": last_scan.finished_at.isoformat() if last_scan and last_scan.finished_at else None,
        "scan_running": bool(running),
    }


def finding_dict(f: Finding) -> dict[str, Any]:
    return {
        "id": str(f.id),
        "rule": f.rule,
        "category": f.category,
        "title": f.title,
        "description": f.description,
        "scope": f.scope,
        "affects": f.affects,
        "resource_ids": f.resource_ids,
        "est_monthly_savings": float(f.est_monthly_savings or Decimal(0)),
        "realized_monthly_savings": float(f.realized_monthly_savings or Decimal(0)),
        "effort": f.effort,
        "risk": f.risk,
        "time_to_apply": f.time_to_apply,
        "status": f.status,
        "steps": f.steps,
        "automatable": bool(f.plan),
        "plan": [
            {
                "tool": p["tool"],
                "description": p.get("description", ""),
                "reversible": bool(p.get("rollback")),
            }
            for p in f.plan
        ],
        "evidence": f.evidence,
        "first_seen_at": f.first_seen_at.isoformat() if f.first_seen_at else None,
        "last_seen_at": f.last_seen_at.isoformat() if f.last_seen_at else None,
    }
