"""Append-only, hash-chained audit log."""

from __future__ import annotations

import hashlib
import json
import uuid
from dataclasses import dataclass
from datetime import UTC
from typing import Any

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from martian.db.base import utcnow
from martian.db.models import AuditEntry


@dataclass(frozen=True)
class Actor:
    type: str  # user|agent|system|connector
    id: str = ""
    label: str = ""
    ip: str | None = None

    @staticmethod
    def system() -> Actor:
        return Actor("system", "system", "Martian")

    @staticmethod
    def agent(name: str = "martian") -> Actor:
        return Actor("agent", name, name)


def _digest(prev: str, entry: dict[str, Any]) -> str:
    body = json.dumps(entry, sort_keys=True, default=str)
    return hashlib.sha256((prev + body).encode()).hexdigest()


async def record(
    session: AsyncSession,
    org_id: uuid.UUID,
    actor: Actor,
    action: str,
    *,
    target_type: str = "",
    target_id: str = "",
    summary: str = "",
    details: dict[str, Any] | None = None,
) -> AuditEntry:
    # Serialize writers per tenant so the chain stays linear.
    await session.execute(text("SELECT pg_advisory_xact_lock(hashtext(:k))"), {"k": f"audit:{org_id}"})
    prev = (
        await session.execute(
            select(AuditEntry.hash).where(AuditEntry.org_id == org_id).order_by(AuditEntry.id.desc()).limit(1)
        )
    ).scalar_one_or_none() or ""
    at = utcnow()
    fields = {
        "org_id": str(org_id),
        "at": at.astimezone(UTC).isoformat(),
        "actor_type": actor.type,
        "actor_id": actor.id,
        "action": action,
        "target_type": target_type,
        "target_id": target_id,
        "summary": summary,
        "details": details or {},
    }
    entry = AuditEntry(
        org_id=org_id,
        at=at,
        actor_type=actor.type,
        actor_id=actor.id,
        actor_label=actor.label,
        action=action,
        target_type=target_type,
        target_id=target_id,
        summary=summary,
        details=details or {},
        ip=actor.ip,
        prev_hash=prev,
        hash=_digest(prev, fields),
    )
    session.add(entry)
    await session.flush()
    return entry


async def verify_chain(session: AsyncSession, org_id: uuid.UUID) -> bool:
    rows = (
        await session.execute(select(AuditEntry).where(AuditEntry.org_id == org_id).order_by(AuditEntry.id))
    ).scalars()
    prev = ""
    for e in rows:
        fields = {
            "org_id": str(e.org_id),
            "at": e.at.astimezone(UTC).isoformat(),
            "actor_type": e.actor_type,
            "actor_id": e.actor_id,
            "action": e.action,
            "target_type": e.target_type,
            "target_id": e.target_id,
            "summary": e.summary,
            "details": e.details,
        }
        if e.prev_hash != prev or e.hash != _digest(prev, fields):
            return False
        prev = e.hash
    return True
