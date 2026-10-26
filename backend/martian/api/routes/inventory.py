"""Inventory and the topology view used by the Infrastructure page."""

from __future__ import annotations

from collections import Counter, defaultdict

from fastapi import APIRouter, Depends
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from martian.api.deps import Principal, current_principal, tenant_db
from martian.db.models import Finding, Integration, Resource
from martian.services.graph import build_graph

router = APIRouter(prefix="/inventory", tags=["inventory"])

ENVIRONMENTS = {
    "cloud": ("Cloud infrastructure", "AWS · Azure · Google Cloud"),
    "dc": ("Primary data center", "VMware · physical servers"),
    "labs": ("Development labs", "Dev · test · research"),
    "edge": ("Edge and remote sites", "Branch · IoT · CDN · VDI"),
}
PROVIDER = {"aws": "AWS", "azure": "Azure", "gcp": "Google Cloud", "vcenter": "VMware", "ssh": "On-premises"}
TYPE_LABEL = {
    "vm": "VMs",
    "volume": "volumes",
    "snapshot": "snapshots",
    "database": "databases",
    "load_balancer": "load balancers",
    "nat_gateway": "NAT gateways",
    "asg": "auto scaling groups",
    "host": "hosts",
    "datastore": "datastores",
    "file_share": "file shares",
}


def _money_k(v: float) -> str:
    return f"${v / 1000:,.0f}K" if v >= 1000 else f"${v:,.0f}"


@router.get("/topology")
async def topology(p: Principal = Depends(current_principal), s: AsyncSession = Depends(tenant_db)) -> dict:
    rows = list((await s.execute(select(Resource).where(Resource.org_id == p.org_id))).scalars())
    systems: dict[tuple[str, str], list[Resource]] = defaultdict(list)
    for r in rows:
        system = r.attributes.get("system") or f"{PROVIDER.get(r.provider, r.provider)} {r.account}".strip()
        systems[(r.environment, system)].append(r)
    groups = []
    for env, (name, where) in ENVIRONMENTS.items():
        env_systems = [(k[1], v) for k, v in systems.items() if k[0] == env]
        if not env_systems:
            continue
        items = []
        for system, rs in sorted(env_systems, key=lambda kv: -sum(float(r.monthly_cost) for r in kv[1])):
            vms = [r for r in rs if r.resource_type in {"vm", "host"}]
            sizes = Counter(r.attributes.get("instance_type") or r.attributes.get("size") or "" for r in vms)
            size, n = sizes.most_common(1)[0] if sizes else ("", 0)
            line_a = f"{len(vms)} {'hosts' if vms and vms[0].resource_type == 'host' else 'VMs'}" + (
                f" · {n}× {size}" if size else ""
            )
            others = Counter(r.resource_type for r in rs if r.resource_type not in {"vm", "host"})
            line_b = " · ".join(f"{c} {TYPE_LABEL.get(t, t)}" for t, c in others.most_common(2)) or (
                rs[0].region or ""
            )
            cpus = [float(r.metrics["cpu_avg_14d"]) for r in vms if r.metrics.get("cpu_avg_14d") is not None]
            items.append(
                {
                    "name": system,
                    "a": line_a if vms else (f"{len(rs)} resources"),
                    "b": line_b,
                    "util": round(sum(cpus) / len(cpus)) if cpus else None,
                    "monthly_cost": round(sum(float(r.monthly_cost) for r in rs), 2),
                    "resources": len(rs),
                }
            )
        cost = sum(i["monthly_cost"] for i in items)
        groups.append(
            {
                "key": env,
                "name": name,
                "where": where,
                "cost": _money_k(cost),
                "monthly_cost": cost,
                "systems": items[:8],
            }
        )
    open_findings = (
        await s.execute(
            select(func.count(Finding.id)).where(Finding.org_id == p.org_id, Finding.status == "open")
        )
    ).scalar_one()
    total = sum(float(r.monthly_cost) for r in rows)
    summary = [
        {"value": f"{sum(1 for r in rows if r.resource_type == 'vm'):,}", "label": "Virtual machines"},
        {"value": f"{sum(1 for r in rows if r.resource_type == 'host'):,}", "label": "Physical servers"},
        {
            "value": f"{len({(r.provider, r.account) for r in rows if r.environment == 'cloud' and r.account}):,}",
            "label": "Cloud accounts",
        },
        {"value": _money_k(total), "label": "Monthly cost", "accent": True},
        {"value": f"{sum(1 for k in systems if k[0] == 'labs'):,}", "label": "Lab environments"},
        {"value": f"{open_findings:,}", "label": "Open findings"},
    ]
    return {"summary": summary, "groups": groups}


@router.get("/graph")
async def graph(p: Principal = Depends(current_principal), s: AsyncSession = Depends(tenant_db)) -> dict:
    """Integrations → clusters → services, for the Infrastructure map."""
    integrations = list(
        (await s.execute(select(Integration).where(Integration.org_id == p.org_id))).scalars()
    )
    resources = list((await s.execute(select(Resource).where(Resource.org_id == p.org_id))).scalars())
    findings = list((await s.execute(select(Finding).where(Finding.org_id == p.org_id))).scalars())
    return build_graph(integrations, resources, findings)


@router.get("")
async def list_resources(
    q: str = "",
    resource_type: str | None = None,
    provider: str | None = None,
    limit: int = 100,
    offset: int = 0,
    p: Principal = Depends(current_principal),
    s: AsyncSession = Depends(tenant_db),
) -> dict:
    query = select(Resource).where(Resource.org_id == p.org_id)
    if q:
        query = query.where(or_(Resource.name.ilike(f"%{q}%"), Resource.resource_id.ilike(f"%{q}%")))
    if resource_type:
        query = query.where(Resource.resource_type == resource_type)
    if provider:
        query = query.where(Resource.provider == provider)
    rows = (
        await s.execute(query.order_by(Resource.monthly_cost.desc()).limit(min(limit, 500)).offset(offset))
    ).scalars()
    return {
        "resources": [
            {
                "id": str(r.id),
                "resource_id": r.resource_id,
                "name": r.name,
                "type": r.resource_type,
                "provider": r.provider,
                "account": r.account,
                "region": r.region,
                "state": r.state,
                "environment": r.environment,
                "monthly_cost": float(r.monthly_cost),
                "metrics": r.metrics,
                "attributes": r.attributes,
                "tags": r.tags,
            }
            for r in rows
        ]
    }
