"""Chat tools for demo mode (MARTIAN_DEMO_MODE=true).

The console generates a sample company in the browser and uploads a snapshot of it
(PUT /demo/snapshot) before each chat turn. These tools answer from that snapshot, so
Claude's numbers match what's on screen. approve_finding is a write and goes through the
same approval gate as any real change; start_workflow only asks the console to start
agents, so it doesn't need approval. Nothing here touches real infrastructure.
"""

from __future__ import annotations

import json
import uuid
from typing import Any

from langchain_core.runnables import RunnableConfig
from langchain_core.tools import BaseTool, StructuredTool
from sqlalchemy.orm.attributes import flag_modified

from martian.db.base import org_session, utcnow
from martian.db.models import DemoSnapshot

NO_SNAPSHOT = {"error": "No demo data yet. Open the console once so it can upload its snapshot."}


async def load_snapshot(org_id: uuid.UUID) -> dict[str, Any]:
    async with org_session(org_id) as s:
        row = await s.get(DemoSnapshot, org_id)
        return dict(row.data) if row and row.data else {}


def _services(snap: dict[str, Any]) -> list[dict[str, Any]]:
    out = []
    for c in snap.get("clusters", []):
        for svc in c.get("services", []):
            out.append(
                {
                    **svc,
                    "cluster": c.get("name"),
                    "cluster_id": c.get("node_id"),
                    "env": c.get("env"),
                    "location": c.get("location"),
                }
            )
    return out


def _dump(data: Any) -> str:
    return json.dumps(data, default=str)


def demo_tools(org_id: uuid.UUID) -> list[BaseTool]:
    async def get_overview() -> str:
        """Monthly spend and open waste for the org, plus realized savings and the health score."""
        snap = await load_snapshot(org_id)
        if not snap:
            return _dump(NO_SNAPSHOT)
        return _dump({"org": snap.get("org", {}), **snap.get("overview", {})})

    async def list_findings(
        status: str = "open", min_monthly_savings: float = 0, integration: str | None = None
    ) -> str:
        """Savings findings, biggest first. status: open|running|applied|all. integration: catalog id such as aws or vmware."""
        snap = await load_snapshot(org_id)
        if not snap:
            return _dump(NO_SNAPSHOT)
        rows = [
            f
            for f in snap.get("findings", [])
            if (status == "all" or f.get("status") == status)
            and float(f.get("est_monthly_savings") or 0) >= min_monthly_savings
            and (not integration or f.get("integration") == integration)
        ]
        rows.sort(key=lambda f: -float(f.get("est_monthly_savings") or 0))
        return _dump({"findings": [{k: v for k, v in f.items() if k != "steps"} for f in rows[:40]]})

    async def get_finding(finding_id: str) -> str:
        """Everything about one finding, including the steps Martian would take to apply it."""
        snap = await load_snapshot(org_id)
        f = next((x for x in snap.get("findings", []) if x.get("id") == finding_id), None)
        return _dump(f or {"error": f"No finding with id {finding_id}"})

    async def search_inventory(
        query: str = "",
        service_type: str | None = None,
        integration: str | None = None,
        sort: str = "cost",
        limit: int = 15,
    ) -> str:
        """Search services by name or tag (cluster and location match too). sort: cost|cpu|count. service_type: vm-fleet, database, storage, k8s and so on."""
        snap = await load_snapshot(org_id)
        if not snap:
            return _dump(NO_SNAPSHOT)
        q = query.lower().strip()
        rows = [
            s
            for s in _services(snap)
            if (
                not q
                or q
                in f"{s.get('name')} {s.get('cluster')} {s.get('location')} {' '.join(s.get('tags', []))} {s.get('type')}".lower()
            )
            and (not service_type or s.get("type") == service_type)
            and (not integration or s.get("integration") == integration)
        ]
        key = {"cpu": lambda s: -(s.get("cpu") or -1), "count": lambda s: -(s.get("count") or 0)}.get(
            sort, lambda s: -(s.get("monthly_cost") or 0)
        )
        rows.sort(key=key)
        return _dump({"resources": rows[: max(1, min(limit, 50))]})

    async def describe_topology(env: str | None = None) -> str:
        """Clusters and services per environment (cloud, dc, labs, edge, saas) with costs and dependencies."""
        snap = await load_snapshot(org_id)
        if not snap:
            return _dump(NO_SNAPSHOT)
        clusters = [c for c in snap.get("clusters", []) if not env or c.get("env") == env]
        return _dump(
            {
                "clusters": [
                    {
                        "node_id": c.get("node_id"),
                        "name": c.get("name"),
                        "integration": c.get("integration"),
                        "env": c.get("env"),
                        "location": c.get("location"),
                        "monthly_cost": sum(s.get("monthly_cost") or 0 for s in c.get("services", [])),
                        "services": [
                            {
                                k: s.get(k)
                                for k in (
                                    "node_id",
                                    "name",
                                    "type",
                                    "count",
                                    "unit",
                                    "monthly_cost",
                                    "cpu",
                                    "depends_on",
                                )
                            }
                            for s in c.get("services", [])
                        ],
                    }
                    for c in clusters
                ],
                "nodes": len(clusters) + sum(len(c.get("services", [])) for c in clusters),
            }
        )

    async def get_resource_telemetry(node_id: str) -> str:
        """CPU and memory for the last 24 hours (48 half-hour points, oldest first) for a service or cluster node_id."""
        snap = await load_snapshot(org_id)
        tel = snap.get("telemetry", {})
        svc = next((s for s in _services(snap) if s.get("node_id") == node_id), None)
        if node_id in tel:
            return _dump(
                {
                    "node_id": node_id,
                    "name": svc.get("name") if svc else node_id,
                    **tel[node_id],
                    "cpu_now": svc.get("cpu") if svc else None,
                    "count": svc.get("count") if svc else None,
                }
            )
        cluster = next((c for c in snap.get("clusters", []) if c.get("node_id") == node_id), None)
        if cluster:
            series = [tel[s["node_id"]] for s in cluster.get("services", []) if s.get("node_id") in tel]
            if series:
                n = len(series[0]["cpu_24h"])
                avg = lambda key: [round(sum(t[key][i] for t in series) / len(series), 1) for i in range(n)]  # noqa: E731
                return _dump(
                    {
                        "node_id": node_id,
                        "name": cluster.get("name"),
                        "cpu_24h": avg("cpu_24h"),
                        "mem_24h": avg("mem_24h"),
                    }
                )
        return _dump({"error": f"No CPU data for {node_id}. Storage and network services don't report CPU."})

    async def list_agent_sessions(limit: int = 10, status: str | None = None) -> str:
        """Recent agent runs (scans, chats, workflows, approved changes), newest first. status: running|waiting|completed|failed."""
        snap = await load_snapshot(org_id)
        rows = [s for s in snap.get("sessions", []) if not status or s.get("status") == status]
        return _dump(
            {
                "sessions": [
                    {k: v for k, v in s.items() if k != "agents"} | {"agents": len(s.get("agents", []))}
                    for s in rows[: max(1, min(limit, 30))]
                ]
            }
        )

    async def get_agent_session(session_id: str) -> str:
        """One agent run in full: every step each agent took and how the run ended."""
        snap = await load_snapshot(org_id)
        s = next((x for x in snap.get("sessions", []) if x.get("id") == session_id), None)
        return _dump(s or {"error": f"No agent run with id {session_id}"})

    async def list_integrations() -> str:
        """Connected integrations with their status and permission mode, including which write tools are on."""
        snap = await load_snapshot(org_id)
        return _dump({"integrations": snap.get("integrations", [])})

    async def approve_finding(finding_id: str, config: RunnableConfig) -> str:
        """Approve a finding so Martian applies it. The user sees an approval card and confirms first."""
        from martian.services import audit

        c = (config or {}).get("configurable", {})
        async with org_session(org_id) as s:
            row = await s.get(DemoSnapshot, org_id)
            findings = (row.data or {}).get("findings", []) if row else []
            f = next((x for x in findings if x.get("id") == finding_id), None)
            if f is None:
                return _dump({"approved": False, "error": f"No finding with id {finding_id}"})
            if f.get("status") != "open":
                return _dump({"approved": False, "error": f"That finding is already {f.get('status')}."})
            if not f.get("automatable"):
                return _dump(
                    {"approved": False, "error": "This one needs a manual change; Martian can't apply it."}
                )
            f["status"] = "running"
            row.updated_at = utcnow()
            flag_modified(row, "data")
            await audit.record(
                s,
                org_id,
                audit.Actor("user", str(c.get("user_id") or ""), c.get("user_label", "user")),
                "finding.approved",
                target_type="finding",
                target_id=finding_id,
                summary=f"approved {f.get('title')} (demo)",
                details={"demo": True},
            )
        return _dump(
            {
                "approved": True,
                "finding_id": finding_id,
                "title": f.get("title"),
                "est_monthly_savings": f.get("est_monthly_savings"),
                "status": "applying",
            }
        )

    async def start_workflow(goal: str) -> str:
        """Start a read-only agent workflow for a goal, such as "check the data warehouses for idle compute". The console shows it on the Agents page."""
        goal = goal.strip()[:300]
        if not goal:
            return _dump({"started": False, "error": "Say what the workflow should check."})
        return _dump({"started": True, "goal": goal, "where": "Agents page"})

    fns = [
        get_overview,
        list_findings,
        get_finding,
        search_inventory,
        describe_topology,
        get_resource_telemetry,
        list_agent_sessions,
        get_agent_session,
        list_integrations,
        approve_finding,
        start_workflow,
    ]
    return [StructuredTool.from_function(coroutine=f, name=f.__name__) for f in fns]
