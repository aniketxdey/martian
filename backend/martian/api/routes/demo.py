"""Demo mode: whether the console should generate sample data, and the snapshot it uploads
so the chat agent answers about the same company the console shows."""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from martian.api.deps import Principal, current_principal, tenant_db
from martian.config import get_settings
from martian.db.base import utcnow
from martian.db.models import DemoSnapshot

router = APIRouter(prefix="/demo", tags=["demo"])

MAX_SNAPSHOT_BYTES = 2_000_000


@router.get("/config")
async def config() -> dict:
    """Public: the console reads this before sign-in to pick demo or live data."""
    return {"enabled": get_settings().demo_mode}


@router.put("/snapshot")
async def put_snapshot(
    data: dict[str, Any] = Body(...),
    p: Principal = Depends(current_principal),
    s: AsyncSession = Depends(tenant_db),
) -> dict:
    if not get_settings().demo_mode:
        raise HTTPException(404, "Demo mode is off. Set MARTIAN_DEMO_MODE=true to use generated data.")
    if len(json.dumps(data, default=str)) > MAX_SNAPSHOT_BYTES:
        raise HTTPException(413, "The demo snapshot is too large.")
    if not isinstance(data.get("overview"), dict) or not isinstance(data.get("findings"), list):
        raise HTTPException(422, "The demo snapshot needs overview and findings.")
    row = await s.get(DemoSnapshot, p.org_id)
    now = utcnow()
    if row is None:
        s.add(DemoSnapshot(org_id=p.org_id, data=data, updated_at=now))
    else:
        row.data = data
        row.updated_at = now
    return {"ok": True, "updated_at": now.isoformat()}


@router.get("/snapshot")
async def get_snapshot(
    p: Principal = Depends(current_principal), s: AsyncSession = Depends(tenant_db)
) -> dict:
    if not get_settings().demo_mode:
        raise HTTPException(404, "Demo mode is off. Set MARTIAN_DEMO_MODE=true to use generated data.")
    row = await s.get(DemoSnapshot, p.org_id)
    if row is None:
        raise HTTPException(404, "No demo snapshot yet. Open the console so it can upload one.")
    return {"updated_at": row.updated_at.isoformat(), "data": row.data}
