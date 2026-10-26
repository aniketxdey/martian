"""The infrastructure map for the console: integrations → clusters → services.

Real inventory has no service catalog, so clusters are an integration's resources in one
region (or vSphere cluster, or account), and services are the resources of one type inside
a cluster. Node ids are stable so findings can point at them.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Any

from martian.db.models import Finding, Integration, Resource

# Backend integration kind → console catalog id (for logos).
CATALOG_ID = {
    "aws": "aws",
    "azure": "azure",
    "gcp": "gcp",
    "vcenter": "vmware",
    "ssh": "ssh",
    "custom": "custom",
}
PROVIDER = {"aws": "AWS", "azure": "Azure", "gcp": "Google Cloud", "vcenter": "VMware", "ssh": "On-premises"}
TYPE = {
    "vm": ("VMs", "vm-fleet", "VMs"),
    "volume": ("Volumes", "storage", "volumes"),
    "snapshot": ("Snapshots", "storage", "snapshots"),
    "database": ("Databases", "database", "databases"),
    "load_balancer": ("Load balancers", "network", "load balancers"),
    "nat_gateway": ("NAT gateways", "network", "gateways"),
    "asg": ("Auto Scaling groups", "vm-fleet", "groups"),
    "host": ("Hosts", "host-cluster", "hosts"),
    "datastore": ("Datastores", "storage", "datastores"),
    "file_share": ("File shares", "storage", "shares"),
}
# Inferred dependencies inside one cluster: (from type, to type, label).
INFERRED = [
    ("load_balancer", "vm", "routes to"),
    ("asg", "vm", "scales"),
    ("vm", "database", "reads"),
    ("vm", "volume", "mounts"),
]


def cluster_key(r: Resource) -> str:
    where = r.attributes.get("cluster") or r.region or r.account or r.environment or "default"
    return f"cl:{r.integration_id}:{where}"


def service_key(r: Resource) -> str:
    return f"svc:{cluster_key(r)[3:]}/{r.resource_type}"


def _status(cpu: float | None, rtype: str) -> str:
    if cpu is None:
        return "healthy"
    if cpu < 5 and rtype in {"vm", "host", "asg", "database"}:
        return "idle"
    return "hot" if cpu > 80 else "healthy"


def build_graph(
    integrations: list[Integration], resources: list[Resource], findings: list[Finding]
) -> dict[str, Any]:
    by_service: dict[str, list[Resource]] = defaultdict(list)
    for r in resources:
        by_service[service_key(r)].append(r)
    res_node = {r.resource_id: service_key(r) for r in resources}
    open_by_node: dict[str, int] = defaultdict(int)
    for f in findings:
        if f.status != "open":
            continue
        node = next((res_node[x] for x in f.resource_ids or [] if x in res_node), None)
        if node:
            open_by_node[node] += 1

    kinds = {str(i.id): i.kind for i in integrations}
    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []
    for i in integrations:
        nodes.append(
            {
                "id": f"int:{i.id}",
                "kind": "integration",
                "label": i.name,
                "integration": CATALOG_ID.get(i.kind, "custom"),
                "status": "healthy" if i.status == "connected" else "degraded",
            }
        )
    clusters: dict[str, list[str]] = defaultdict(list)
    for key in by_service:
        clusters["cl:" + key[4:].rsplit("/", 1)[0]].append(key)
    for cid, svc_keys in clusters.items():
        rs = [r for k in svc_keys for r in by_service[k]]
        first = rs[0]
        kind = kinds.get(str(first.integration_id), "custom")
        where = first.attributes.get("cluster") or first.region or first.account or first.environment
        cpus = [float(r.metrics["cpu_avg_14d"]) for r in rs if r.metrics.get("cpu_avg_14d") is not None]
        nodes.append(
            {
                "id": cid,
                "kind": "cluster",
                "label": f"{PROVIDER.get(kind, kind)} {where}".strip(),
                "integration": CATALOG_ID.get(kind, "custom"),
                "env": first.environment,
                "location": first.region or where,
                "parent": f"int:{first.integration_id}",
                "monthlyCost": round(sum(float(r.monthly_cost) for r in rs), 2),
                "cpu": round(sum(cpus) / len(cpus), 1) if cpus else None,
                "count": len(rs),
                "unit": "resources",
                "findings": sum(open_by_node.get(k, 0) for k in svc_keys),
                "status": "healthy",
            }
        )
        edges.append({"from": f"int:{first.integration_id}", "to": cid, "kind": "contains"})
        types = {}
        for k in svc_keys:
            group = by_service[k]
            rtype = group[0].resource_type
            label, stype, unit = TYPE.get(rtype, (rtype.replace("_", " ").capitalize(), "storage", "items"))
            cpus = [
                float(r.metrics["cpu_avg_14d"]) for r in group if r.metrics.get("cpu_avg_14d") is not None
            ]
            cpu = round(sum(cpus) / len(cpus), 1) if cpus else None
            mems = [
                float(r.metrics["mem_avg_14d"]) for r in group if r.metrics.get("mem_avg_14d") is not None
            ]
            nodes.append(
                {
                    "id": k,
                    "kind": "service",
                    "label": label,
                    "integration": CATALOG_ID.get(kind, "custom"),
                    "env": group[0].environment,
                    "parent": cid,
                    "location": group[0].region,
                    "type": stype,
                    "count": len(group),
                    "unit": unit,
                    "monthlyCost": round(sum(float(r.monthly_cost) for r in group), 2),
                    "cpu": cpu,
                    "mem": round(sum(mems) / len(mems), 1) if mems else None,
                    "status": _status(cpu, rtype),
                    "findings": open_by_node.get(k, 0),
                }
            )
            edges.append({"from": cid, "to": k, "kind": "contains"})
            types[rtype] = k
        for a, b, label in INFERRED:
            if a in types and b in types:
                edges.append({"from": types[a], "to": types[b], "kind": "depends", "label": label})
    return {"nodes": nodes, "edges": edges}


def finding_extras(f: Finding, kinds: dict[str, str], res_node: dict[str, str]) -> dict[str, Any]:
    """Fields the console uses to place a finding on the map."""
    kind = kinds.get(str(f.integration_id)) if f.integration_id else None
    node = next((res_node[x] for x in f.resource_ids or [] if x in res_node), None)
    return {
        "integration_kind": kind,
        "node_id": node,
        "created_at": f.first_seen_at.isoformat() if f.first_seen_at else None,
    }
