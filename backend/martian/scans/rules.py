"""Deterministic findings rules over normalized inventory.

Every rule is a pure function from resources to findings, so savings are
reproducible and testable. Findings aggregate resources per integration, account
and region (for example "47 EC2 instances with <5% CPU"), and carry an executable
plan of MCP write-tool calls plus rollback calls where the change is reversible.

Resource contract (produced by every `*_inventory` MCP tool):
    resource_id, resource_type, name, account, region, state, environment,
    monthly_cost, attributes{...}, tags{...}, metrics{cpu_avg_14d, cpu_p95_14d, ...}
"""

from __future__ import annotations

import hashlib
from collections import defaultdict
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from typing import Any

# Thresholds (documented in the product; tuned with pilot customers).
IDLE_CPU_AVG = 5.0
IDLE_CPU_P95 = 15.0
DB_CPU_AVG = 15.0
DB_CPU_P95 = 40.0
UNATTACHED_MIN_DAYS = 7
SNAPSHOT_MAX_AGE_DAYS = 90
SNAPSHOT_COST_PER_GB = 0.05
HOST_CPU_AVG = 20.0
STORAGE_COST_PER_GB = 0.10
DOWNSIZE_SAVINGS_RATIO = 0.5
PROTECT_TAG_KEYS = {"martian:protect", "do-not-stop", "DoNotStop"}

PROVIDER_LABEL = {
    "aws": "AWS",
    "azure": "Azure",
    "gcp": "Google Cloud",
    "vcenter": "VMware",
    "ssh": "On-premises",
}

# Provider-specific tool names for each kind of change.
STOP_VMS = {
    "aws": ("aws_stop_instances", "aws_start_instances", "instance_ids"),
    "azure": ("azure_deallocate_vms", "azure_start_vms", "vm_ids"),
    "gcp": ("gcp_stop_instances", "gcp_start_instances", "instance_ids"),
    "vcenter": ("vcenter_power_off_vms", "vcenter_power_on_vms", "vm_ids"),
}
DELETE_VOLUMES = {
    "aws": ("aws_snapshot_and_delete_volumes", "volume_ids"),
    "azure": ("azure_snapshot_and_delete_disks", "disk_ids"),
    "gcp": ("gcp_snapshot_and_delete_disks", "disk_ids"),
}


@dataclass
class Res:
    integration_id: str
    provider: str
    resource_id: str
    resource_type: str
    name: str = ""
    account: str = ""
    region: str = ""
    state: str = ""
    environment: str = "cloud"
    monthly_cost: float = 0.0
    attributes: dict[str, Any] = field(default_factory=dict)
    tags: dict[str, Any] = field(default_factory=dict)
    metrics: dict[str, Any] = field(default_factory=dict)

    @property
    def protected(self) -> bool:
        return any(k in self.tags for k in PROTECT_TAG_KEYS)


@dataclass
class FindingDraft:
    rule: str
    category: str
    title: str
    description: str
    scope: str
    affects: str
    resource_ids: list[str]
    est_monthly_savings: float
    effort: str
    risk: str
    time_to_apply: str
    plan: list[dict[str, Any]]
    steps: list[str]
    evidence: dict[str, Any]
    integration_id: str
    # What the rule groups by (account/region, or one resource); keeps fingerprints unique and stable.
    group: str = ""

    @property
    def fingerprint(self) -> str:
        key = f"{self.rule}|{self.integration_id}|{self.group or self.scope}"
        return hashlib.sha256(key.encode()).hexdigest()[:40]


def _scope(r: Res) -> str:
    label = PROVIDER_LABEL.get(r.provider, r.provider)
    parts = [label]
    if r.region:
        parts.append(r.region)
    return " · ".join(parts)


def _group(resources: Iterable[Res], key: Callable[[Res], tuple]) -> dict[tuple, list[Res]]:
    groups: dict[tuple, list[Res]] = defaultdict(list)
    for r in resources:
        groups[key(r)].append(r)
    return groups


def _aws(account: str, region: str) -> dict[str, str]:
    return {"region": region, "account": account} if account else {"region": region}


def _money(v: float) -> float:
    return round(v, 2)


def _plural(n: int, one: str, many: str | None = None) -> str:
    return f"{n} {one if n == 1 else (many or one + 's')}"


# --------------------------------------------------------------------------- rules


def idle_compute(resources: list[Res]) -> list[FindingDraft]:
    candidates = [
        r
        for r in resources
        if r.resource_type == "vm"
        and r.state in {"running", "poweredOn", "POWERED_ON", "RUNNING", "VM running"}
        and r.provider in STOP_VMS
        and not r.protected
        and r.metrics.get("cpu_avg_14d") is not None
        and r.metrics["cpu_avg_14d"] < IDLE_CPU_AVG
        and r.metrics.get("cpu_p95_14d", 0) < IDLE_CPU_P95
    ]
    out = []
    for (iid, provider, account, region), rs in _group(
        candidates, lambda r: (r.integration_id, r.provider, r.account, r.region)
    ).items():
        stop, start, arg = STOP_VMS[provider]
        ids = sorted(r.resource_id for r in rs)
        savings = sum(r.monthly_cost for r in rs)
        noun = {"aws": "EC2 instance", "azure": "Azure VM", "gcp": "Compute Engine instance"}.get(
            provider, "VM"
        )
        base = (
            ({"region": region, "account": account} if account else {"region": region})
            if provider == "aws"
            else {}
        )
        out.append(
            FindingDraft(
                rule="idle_compute",
                group=f"{account}|{region}",
                category="compute",
                title={
                    "aws": "Unused EC2 instances",
                    "azure": "Idle Azure VMs",
                    "gcp": "Idle Compute Engine instances",
                }.get(provider, "Idle virtual machines"),
                description=f"{_plural(len(rs), noun)} with <{IDLE_CPU_AVG:g}% average CPU over 14 days",
                scope=_scope(rs[0]),
                affects=_plural(len(rs), "VM"),
                resource_ids=ids,
                est_monthly_savings=_money(savings),
                effort="easy",
                risk="low",
                time_to_apply="< 5 minutes",
                plan=[
                    {
                        "integration_id": iid,
                        "tool": stop,
                        "args": {**base, arg: ids},
                        "rollback": {"tool": start, "args": {**base, arg: ids}},
                        "description": f"Stop {_plural(len(ids), noun)}",
                    }
                ],
                steps=[
                    "Confirm owners from resource tags and notify them",
                    "Snapshot attached volumes" if provider == "aws" else "Record current power state",
                    f"Stop the {len(ids)} {'instances' if len(ids) != 1 else 'instance'} (reversible)",
                    "Report realized savings after 24 hours",
                ],
                evidence={
                    "threshold": {"cpu_avg_14d": IDLE_CPU_AVG, "cpu_p95_14d": IDLE_CPU_P95},
                    "resources": [
                        {
                            "id": r.resource_id,
                            "name": r.name,
                            "cpu_avg_14d": r.metrics.get("cpu_avg_14d"),
                            "monthly_cost": r.monthly_cost,
                        }
                        for r in sorted(rs, key=lambda r: -r.monthly_cost)[:25]
                    ],
                },
                integration_id=iid,
            )
        )
    return out


def unattached_volumes(resources: list[Res]) -> list[FindingDraft]:
    candidates = [
        r
        for r in resources
        if r.resource_type == "volume"
        and r.provider in DELETE_VOLUMES
        and r.attributes.get("attached") is False
        and (r.attributes.get("unattached_days") or 0) >= UNATTACHED_MIN_DAYS
        and not r.protected
    ]
    out = []
    for (iid, provider, account, region), rs in _group(
        candidates, lambda r: (r.integration_id, r.provider, r.account, r.region)
    ).items():
        tool, arg = DELETE_VOLUMES[provider]
        ids = sorted(r.resource_id for r in rs)
        gb = sum(float(r.attributes.get("size_gb", 0)) for r in rs)
        savings = max(0.0, sum(r.monthly_cost for r in rs) - gb * SNAPSHOT_COST_PER_GB)
        base = (
            ({"region": region, "account": account} if account else {"region": region})
            if provider == "aws"
            else {}
        )
        label = (
            "EBS volumes"
            if provider == "aws"
            else "managed disks"
            if provider == "azure"
            else "persistent disks"
        )
        out.append(
            FindingDraft(
                rule="unattached_volumes",
                group=f"{account}|{region}",
                category="storage",
                title="Unattached storage volumes",
                description=f"{len(rs)} unattached {label} ({gb:,.0f} GB) idle for {UNATTACHED_MIN_DAYS}+ days",
                scope=_scope(rs[0]),
                affects=_plural(len(rs), "volume"),
                resource_ids=ids,
                est_monthly_savings=_money(savings),
                effort="easy",
                risk="low",
                time_to_apply="< 3 minutes",
                plan=[
                    {
                        "integration_id": iid,
                        "tool": tool,
                        "args": {**base, arg: ids},
                        "rollback": None,
                        "description": f"Snapshot, then delete {len(ids)} unattached {label}",
                    }
                ],
                steps=[
                    "Take a final snapshot of each volume",
                    f"Delete the {len(ids)} unattached volumes",
                    "Keep snapshots so any volume can be restored",
                ],
                evidence={"total_gb": gb, "snapshot_cost_per_gb": SNAPSHOT_COST_PER_GB},
                integration_id=iid,
            )
        )
    return out


def old_snapshots(resources: list[Res]) -> list[FindingDraft]:
    candidates = [
        r
        for r in resources
        if r.resource_type == "snapshot"
        and r.provider == "aws"
        and (r.attributes.get("age_days") or 0) > SNAPSHOT_MAX_AGE_DAYS
        and not r.attributes.get("in_use_by_image")
        and not r.protected
    ]
    out = []
    for (iid, account, region), rs in _group(
        candidates, lambda r: (r.integration_id, r.account, r.region)
    ).items():
        ids = sorted(r.resource_id for r in rs)
        out.append(
            FindingDraft(
                rule="old_snapshots",
                group=f"{account}|{region}",
                category="storage",
                title="Orphaned snapshots",
                description=f"{len(rs)} snapshots older than {SNAPSHOT_MAX_AGE_DAYS} days not used by any image",
                scope=_scope(rs[0]),
                affects=_plural(len(rs), "snapshot"),
                resource_ids=ids,
                est_monthly_savings=_money(sum(r.monthly_cost for r in rs)),
                effort="easy",
                risk="medium",
                time_to_apply="< 5 minutes",
                plan=[
                    {
                        "integration_id": iid,
                        "tool": "aws_delete_snapshots",
                        "args": {**_aws(account, region), "snapshot_ids": ids},
                        "rollback": None,
                        "description": f"Delete {len(ids)} snapshots",
                    }
                ],
                steps=[
                    "Confirm no AMI or backup plan references the snapshots",
                    f"Delete the {len(ids)} snapshots",
                ],
                evidence={"max_age_days": SNAPSHOT_MAX_AGE_DAYS},
                integration_id=iid,
            )
        )
    return out


def overprovisioned_databases(resources: list[Res]) -> list[FindingDraft]:
    candidates = [
        r
        for r in resources
        if r.resource_type == "database"
        and r.provider == "aws"
        and r.attributes.get("downsize_to")
        and r.metrics.get("cpu_avg_14d") is not None
        and r.metrics["cpu_avg_14d"] < DB_CPU_AVG
        and r.metrics.get("cpu_p95_14d", 0) < DB_CPU_P95
        and not r.protected
    ]
    out = []
    for (iid, account, region), rs in _group(
        candidates, lambda r: (r.integration_id, r.account, r.region)
    ).items():
        plan = [
            {
                "integration_id": iid,
                "tool": "aws_modify_db_instance_class",
                "args": {
                    **_aws(account, region),
                    "db_instance_id": r.resource_id,
                    "target_class": r.attributes["downsize_to"],
                },
                "rollback": {
                    "tool": "aws_modify_db_instance_class",
                    "args": {
                        **_aws(account, region),
                        "db_instance_id": r.resource_id,
                        "target_class": r.attributes.get("instance_class"),
                    },
                },
                "description": f"Resize {r.name or r.resource_id} to {r.attributes['downsize_to']}",
            }
            for r in sorted(rs, key=lambda r: r.resource_id)
        ]
        out.append(
            FindingDraft(
                rule="overprovisioned_databases",
                group=f"{account}|{region}",
                category="database",
                title="Over-provisioned RDS instances",
                description=f"{len(rs)} database instances running at <{DB_CPU_AVG:g}% capacity",
                scope=_scope(rs[0]),
                affects=_plural(len(rs), "DB", "DBs"),
                resource_ids=sorted(r.resource_id for r in rs),
                est_monthly_savings=_money(sum(r.monthly_cost for r in rs) * DOWNSIZE_SAVINGS_RATIO),
                effort="medium",
                risk="medium",
                time_to_apply="15 minutes",
                plan=plan,
                steps=[
                    "Pick a smaller instance class from 14 days of load",
                    "Apply each change in the next maintenance window",
                    "Resize and watch latency for 1 hour",
                ],
                evidence={"threshold": {"cpu_avg_14d": DB_CPU_AVG, "cpu_p95_14d": DB_CPU_P95}},
                integration_id=iid,
            )
        )
    return out


def idle_network(resources: list[Res]) -> list[FindingDraft]:
    candidates = [
        r
        for r in resources
        if r.provider == "aws"
        and r.resource_type in {"load_balancer", "nat_gateway"}
        and r.metrics.get("traffic_14d") == 0
        and not r.protected
    ]
    out = []
    for (iid, account, region), rs in _group(
        candidates, lambda r: (r.integration_id, r.account, r.region)
    ).items():
        lbs = sorted(r.resource_id for r in rs if r.resource_type == "load_balancer")
        nats = sorted(r.resource_id for r in rs if r.resource_type == "nat_gateway")
        plan = []
        if lbs:
            plan.append(
                {
                    "integration_id": iid,
                    "tool": "aws_delete_load_balancers",
                    "args": {**_aws(account, region), "load_balancer_arns": lbs},
                    "rollback": None,
                    "description": f"Delete {_plural(len(lbs), 'idle load balancer')}",
                }
            )
        if nats:
            plan.append(
                {
                    "integration_id": iid,
                    "tool": "aws_delete_nat_gateways",
                    "args": {**_aws(account, region), "nat_gateway_ids": nats},
                    "rollback": None,
                    "description": f"Delete {_plural(len(nats), 'idle NAT gateway')}",
                }
            )
        out.append(
            FindingDraft(
                rule="idle_network",
                group=f"{account}|{region}",
                category="network",
                title="Idle load balancers and NAT gateways",
                description="Load balancers and NAT gateways with no traffic in 14 days",
                scope=_scope(rs[0]),
                affects=" + ".join(
                    filter(
                        None,
                        [_plural(len(lbs), "LB") if lbs else "", _plural(len(nats), "NAT") if nats else ""],
                    )
                ),
                resource_ids=lbs + nats,
                est_monthly_savings=_money(sum(r.monthly_cost for r in rs)),
                effort="medium",
                risk="medium",
                time_to_apply="20 minutes",
                plan=plan,
                steps=[
                    "Confirm no DNS records or routes point at them",
                    "Delete idle load balancers and NAT gateways",
                    "Compare transfer costs after 7 days",
                ],
                evidence={"window_days": 14},
                integration_id=iid,
            )
        )
    return out


def underutilized_hosts(resources: list[Res]) -> list[FindingDraft]:
    candidates = [
        r
        for r in resources
        if r.resource_type == "host"
        and r.metrics.get("cpu_avg_14d") is not None
        and r.metrics["cpu_avg_14d"] < HOST_CPU_AVG
        and not r.protected
    ]
    out = []
    for (iid, _provider), rs in _group(candidates, lambda r: (r.integration_id, r.provider)).items():
        if len(rs) < 2:
            continue  # consolidation needs at least two hosts
        removable = len(rs) // 2
        per_host = sum(r.monthly_cost for r in rs) / len(rs)
        out.append(
            FindingDraft(
                rule="underutilized_hosts",
                group=_provider,
                category="compute",
                title="Consolidate underused hosts",
                description=f"{len(rs)} physical hosts under {HOST_CPU_AVG:g}% CPU; {removable} can be freed by consolidating VMs",
                scope=_scope(rs[0]),
                affects=_plural(len(rs), "host"),
                resource_ids=sorted(r.resource_id for r in rs),
                est_monthly_savings=_money(per_host * removable),
                effort="medium",
                risk="medium",
                time_to_apply="1–2 days",
                plan=[],  # consolidation is planned with the customer, not executed automatically
                steps=[
                    "Rebalance VMs onto fewer hosts with vMotion",
                    "Place freed hosts in maintenance mode",
                    "Power down or repurpose freed hosts",
                ],
                evidence={"threshold": {"cpu_avg_14d": HOST_CPU_AVG}},
                integration_id=iid,
            )
        )
    return out


def duplicate_data(resources: list[Res]) -> list[FindingDraft]:
    out = []
    for r in resources:
        dup = float(r.attributes.get("duplicate_bytes") or 0)
        if r.resource_type not in {"file_share", "datastore"} or dup < 50 * 1024**3:
            continue
        gb = dup / 1024**3
        out.append(
            FindingDraft(
                rule="duplicate_data",
                group=r.resource_id,
                category="data",
                title="Duplicate data",
                description=f"{gb:,.0f} GB of duplicate files on {r.name or r.resource_id}",
                scope=_scope(r),
                affects=f"{gb:,.0f} GB",
                resource_ids=[r.resource_id],
                est_monthly_savings=_money(gb * float(r.attributes.get("cost_per_gb", STORAGE_COST_PER_GB))),
                effort="medium",
                risk="medium",
                time_to_apply="1 hour",
                plan=[],
                steps=[
                    "Review the duplicate report with data owners",
                    "Consolidate copies, keeping the newest",
                    "Re-scan to confirm reclaimed space",
                ],
                evidence={
                    "duplicate_bytes": dup,
                    "top_duplicates": r.attributes.get("top_duplicates", [])[:10],
                },
                integration_id=r.integration_id,
            )
        )
    return out


def predictive_scaling(resources: list[Res], forecasts: dict[str, dict[str, Any]]) -> list[FindingDraft]:
    """Uses LSTM forecasts for auto scaling groups to pre-scale or right-size capacity."""
    out = []
    for r in resources:
        f = forecasts.get(r.resource_id)
        if r.resource_type != "asg" or not f:
            continue
        desired = int(r.attributes.get("desired", 0))
        rec = int(f.get("recommended_desired", desired))
        lo, hi = int(r.attributes.get("min", 0)), int(r.attributes.get("max", max(desired, rec)))
        rec = max(lo, min(hi, rec))
        if rec == desired:
            continue
        per_instance = r.monthly_cost / desired if desired else 0
        up = rec > desired
        out.append(
            FindingDraft(
                rule="predictive_scaling",
                group=r.resource_id,
                category="scaling",
                title="Scale ahead of forecast demand" if up else "Right-size auto scaling group",
                description=(
                    f"Forecast peak {f.get('peak_utilization', 0):.0f}% CPU in the next {f.get('horizon_hours', 24)}h on "
                    f"{r.name}; {'raise' if up else 'lower'} desired capacity {desired} → {rec}"
                ),
                scope=_scope(r),
                affects=_plural(abs(rec - desired), "instance"),
                resource_ids=[r.resource_id],
                est_monthly_savings=0.0 if up else _money(per_instance * (desired - rec)),
                effort="easy",
                risk="low" if up else "medium",
                time_to_apply="< 2 minutes",
                plan=[
                    {
                        "integration_id": r.integration_id,
                        "tool": "aws_set_asg_desired_capacity",
                        "args": {**_aws(r.account, r.region), "asg_name": r.resource_id, "desired": rec},
                        "rollback": {
                            "tool": "aws_set_asg_desired_capacity",
                            "args": {
                                **_aws(r.account, r.region),
                                "asg_name": r.resource_id,
                                "desired": desired,
                            },
                        },
                        "description": f"Set desired capacity of {r.name} to {rec}",
                    }
                ],
                steps=[
                    "Forecast demand with the LSTM model (24h horizon)",
                    f"Set desired capacity to {rec}",
                    "Re-forecast every hour and adjust",
                ],
                evidence={"forecast": f},
                integration_id=r.integration_id,
            )
        )
    return out


RULES: list[Callable[[list[Res]], list[FindingDraft]]] = [
    idle_compute,
    unattached_volumes,
    old_snapshots,
    overprovisioned_databases,
    idle_network,
    underutilized_hosts,
    duplicate_data,
]


def evaluate(resources: list[Res], forecasts: dict[str, dict[str, Any]] | None = None) -> list[FindingDraft]:
    findings: list[FindingDraft] = []
    for rule in RULES:
        findings.extend(rule(resources))
    findings.extend(predictive_scaling(resources, forecasts or {}))
    findings.sort(key=lambda f: -f.est_monthly_savings)
    return findings
