"""Scan pipeline: inventory → forecasts → rules → findings."""

from __future__ import annotations

import uuid
from decimal import Decimal
from typing import Any

import structlog
from sqlalchemy import select

from martian.db.base import org_session, utcnow
from martian.db.models import Finding, Integration, Resource, Scan
from martian.scans.rules import FindingDraft, Res, evaluate
from martian.services import audit
from martian.services.mcp import ToolBackend

log = structlog.get_logger()

INVENTORY_KINDS = {"aws", "azure", "gcp", "vcenter", "ssh"}
REOPENABLE = {"applied", "resolved", "failed"}


def _to_res(integration: Integration, raw: dict[str, Any]) -> Res:
    return Res(
        integration_id=str(integration.id),
        provider=integration.kind,
        resource_id=str(raw["resource_id"]),
        resource_type=str(raw.get("resource_type", "")),
        name=str(raw.get("name") or ""),
        account=str(raw.get("account") or ""),
        region=str(raw.get("region") or ""),
        state=str(raw.get("state") or ""),
        environment=str(raw.get("environment") or "cloud"),
        monthly_cost=float(raw.get("monthly_cost") or 0),
        attributes=raw.get("attributes") or {},
        tags=raw.get("tags") or {},
        metrics=raw.get("metrics") or {},
    )


async def _collect(
    backend: ToolBackend, integration: Integration
) -> tuple[list[Res], list[dict[str, Any]] | None, str | None]:
    """Returns (resources, tool catalog, error)."""
    tools: list[dict[str, Any]] | None = None
    try:
        tools = await backend.list_tools(str(integration.id))
        payload = await backend.call_tool(str(integration.id), f"{integration.kind}_inventory", {})
    except Exception as exc:  # noqa: BLE001 - one broken integration must not fail the scan
        log.warning("inventory_failed", integration=str(integration.id), error=str(exc))
        return [], tools, str(exc)
    raw = payload.get("resources", []) if isinstance(payload, dict) else []
    return [_to_res(integration, r) for r in raw if r.get("resource_id")], tools, None


async def _forecasts(backend: ToolBackend, resources: list[Res]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for r in resources:
        series = r.metrics.get("cpu_series")
        if r.resource_type != "asg" or not series or len(series) < 48:
            continue
        try:
            out[r.resource_id] = await backend.forecast(
                "recommend_scaling",
                {
                    "series": series,
                    "current_capacity": int(r.attributes.get("desired", 1)),
                    "min_capacity": int(r.attributes.get("min", 1)),
                    "max_capacity": int(r.attributes.get("max", 10)),
                    "target_utilization": 60,
                    "horizon_hours": 24,
                },
            )
        except Exception as exc:  # noqa: BLE001 - forecasts are best effort
            log.warning("forecast_failed", resource=r.resource_id, error=str(exc))
    return out


async def run_scan(org_id: uuid.UUID, backend: ToolBackend, trigger: str = "schedule") -> dict[str, Any]:
    async with org_session(org_id) as s:
        # A scan that crashed (worker died, bad data) must not look "running" forever.
        for stale in (
            await s.execute(select(Scan).where(Scan.org_id == org_id, Scan.status == "running"))
        ).scalars():
            stale.status, stale.finished_at = "failed", utcnow()
            stale.error = stale.error or "interrupted"
    scan_id = await _start_scan(org_id, trigger)
    try:
        return await _run_scan(org_id, backend, scan_id)
    except Exception as exc:
        async with org_session(org_id) as s:
            row = await s.get(Scan, scan_id)
            if row is not None:
                row.status, row.error, row.finished_at = "failed", str(exc)[:2000], utcnow()
        raise


async def _start_scan(org_id: uuid.UUID, trigger: str) -> uuid.UUID:
    async with org_session(org_id) as s:
        scan = Scan(org_id=org_id, trigger=trigger)
        s.add(scan)
        await s.flush()
        return scan.id


async def _run_scan(org_id: uuid.UUID, backend: ToolBackend, scan_id: uuid.UUID) -> dict[str, Any]:
    async with org_session(org_id) as s:
        integrations = list(
            (
                await s.execute(
                    select(Integration).where(
                        Integration.org_id == org_id,
                        Integration.enabled.is_(True),
                        Integration.kind.in_(INVENTORY_KINDS),
                    )
                )
            ).scalars()
        )

    all_resources: list[Res] = []
    per_integration: dict[str, Any] = {}
    errors = 0
    seen_by_integration: dict[str, set[str]] = {}
    for integration in integrations:
        resources, tools, error = await _collect(backend, integration)
        per_integration[str(integration.id)] = {"resources": len(resources), "error": error}
        async with org_session(org_id) as s:
            row = await s.get(Integration, integration.id)
            assert row is not None
            if tools is not None:
                row.tools = tools
            if error:
                errors += 1
                row.status = "auth" if "credential" in error.lower() or "auth" in error.lower() else "error"
                row.last_error = error[:2000]
            else:
                row.status = "connected"
                row.last_error = None
                row.last_sync_at = utcnow()
        if not error:
            all_resources.extend(resources)
            seen_by_integration[str(integration.id)] = {r.resource_id for r in resources}

    forecasts = await _forecasts(backend, all_resources)
    drafts = evaluate(all_resources, forecasts)

    async with org_session(org_id) as s:
        await _upsert_resources(s, org_id, all_resources, seen_by_integration)
        opened, updated, resolved = await _upsert_findings(s, org_id, drafts, set(seen_by_integration))
        total_cost = sum(r.monthly_cost for r in all_resources)
        savings = sum(d.est_monthly_savings for d in drafts)
        stats = {
            "integrations": per_integration,
            "resources": len(all_resources),
            "findings": len(drafts),
            "opened": opened,
            "updated": updated,
            "resolved": resolved,
            "monthly_cost": round(total_cost, 2),
            "potential_savings": round(savings, 2),
            "forecasts": len(forecasts),
        }
        scan = await s.get(Scan, scan_id)
        assert scan is not None
        scan.stats = stats
        scan.status = "succeeded" if errors == 0 else ("partial" if errors < len(integrations) else "failed")
        scan.finished_at = utcnow()
        await audit.record(
            s,
            org_id,
            audit.Actor("agent", "martian-2", "Martian 2"),
            "scan.completed",
            target_type="scan",
            target_id=str(scan_id),
            summary=f"mapped {len(all_resources):,} resources across {len(integrations)} integrations",
            details={k: v for k, v in stats.items() if k != "integrations"},
        )
        if opened:
            await audit.record(
                s,
                org_id,
                audit.Actor("agent", "martian-3", "Martian 3"),
                "findings.opened",
                target_type="scan",
                target_id=str(scan_id),
                summary=f"found {opened} new optimization{'s' if opened != 1 else ''} worth ${savings:,.0f}/mo",
            )
    log.info("scan_finished", org=str(org_id), **{k: v for k, v in stats.items() if k != "integrations"})
    return {"scan_id": str(scan_id), **stats}


async def _upsert_resources(s, org_id, resources: list[Res], seen: dict[str, set[str]]) -> None:
    existing = {
        (str(r.integration_id), r.resource_id): r
        for r in (await s.execute(select(Resource).where(Resource.org_id == org_id))).scalars()
    }
    now = utcnow()
    for r in resources:
        row = existing.pop((r.integration_id, r.resource_id), None)
        if row is None:
            row = Resource(
                org_id=org_id,
                integration_id=uuid.UUID(r.integration_id),
                resource_id=r.resource_id,
                first_seen_at=now,
            )
            s.add(row)
        row.provider = r.provider
        row.account = r.account
        row.region = r.region
        row.resource_type = r.resource_type
        row.name = r.name
        row.state = r.state
        row.environment = r.environment
        row.attributes = r.attributes
        row.tags = r.tags
        # Keep raw series out of the table; forecasts fetch them on demand.
        row.metrics = {k: v for k, v in r.metrics.items() if not k.endswith("_series")}
        row.monthly_cost = Decimal(str(round(r.monthly_cost, 2)))
        row.last_seen_at = now
    # Resources that disappeared from a successfully scanned integration are gone.
    for (iid, _), row in existing.items():
        if iid in seen:
            await s.delete(row)


async def _upsert_findings(s, org_id, drafts: list[FindingDraft], scanned: set[str]) -> tuple[int, int, int]:
    rows = {
        f.fingerprint: f for f in (await s.execute(select(Finding).where(Finding.org_id == org_id))).scalars()
    }
    now = utcnow()
    opened = updated = 0
    produced = set()
    for d in drafts:
        produced.add(d.fingerprint)
        row = rows.get(d.fingerprint)
        if row is None:
            row = Finding(org_id=org_id, fingerprint=d.fingerprint, first_seen_at=now, status="open")
            s.add(row)
            opened += 1
        else:
            if row.status in REOPENABLE and set(row.resource_ids) != set(d.resource_ids):
                row.status = "open"
                row.resolved_at = None
                opened += 1
            elif row.status in {"open", "dismissed"}:
                updated += 1
            else:
                continue  # approved/running: leave the in-flight plan untouched
        row.integration_id = uuid.UUID(d.integration_id)
        row.rule = d.rule
        row.category = d.category
        row.title = d.title
        row.description = d.description
        row.scope = d.scope
        row.affects = d.affects
        row.resource_ids = d.resource_ids
        row.est_monthly_savings = Decimal(str(d.est_monthly_savings))
        row.effort = d.effort
        row.risk = d.risk
        row.time_to_apply = d.time_to_apply
        row.plan = d.plan
        row.steps = d.steps
        row.evidence = d.evidence
        row.last_seen_at = now
    resolved = 0
    for fp, row in rows.items():
        in_scope = row.integration_id is None or str(row.integration_id) in scanned
        if fp not in produced and row.status == "open" and in_scope:
            row.status = "resolved"
            row.resolved_at = now
            resolved += 1
    return opened, updated, resolved
