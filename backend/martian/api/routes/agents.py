"""Agent runs for the Agents page: chat conversations, scans and approved changes, shaped
like the console's AgentSession (times in epoch milliseconds)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from martian.agents.chat import RESULT_LIMIT, _text, thread_messages
from martian.api.deps import Principal, current_principal, require, tenant_db
from martian.db.models import Action, ChatThread, Finding, Integration, Role, Scan
from martian.jobs.queue import enqueue

router = APIRouter(prefix="/agents", tags=["agents"])

# Backend integration kind → console catalog id (for logos).
CATALOG_ID = {
    "aws": "aws",
    "azure": "azure",
    "gcp": "gcp",
    "vcenter": "vmware",
    "ssh": "ssh",
    "custom": "custom",
}
# MCP tool prefix → catalog id, mirroring src/data/catalog.ts.
TOOL_PREFIX = {
    "aws": "aws",
    "azure": "azure",
    "gcp": "gcp",
    "vcenter": "vmware",
    "ssh": "ssh",
    "forecast": "martian",
}
INTERNAL_AGENT = {
    "get_overview": "Martian",
    "list_findings": "Cost analyst",
    "get_finding": "Cost analyst",
    "search_inventory": "Discovery",
    "describe_topology": "Discovery",
    "get_resource_telemetry": "Utilization analyst",
    "list_agent_sessions": "Martian",
    "get_agent_session": "Martian",
    "list_integrations": "Access checker",
    "approve_finding": "Remediator",
    "start_workflow": "Martian",
    "forecast_utilization": "Forecaster",
    "recommend_scaling": "Forecaster",
}
SHORT = {"aws": "AWS", "azure": "Azure", "gcp": "Google Cloud", "vmware": "vCenter", "ssh": "Servers"}
SCAN_STATUS = {"running": "running", "succeeded": "completed", "partial": "completed", "failed": "failed"}
ACTION_STATUS = {
    "pending": "running",
    "approved": "running",
    "running": "running",
    "succeeded": "completed",
    "failed": "failed",
    "rolled_back": "completed",
}


def ms(t: datetime | None) -> int | None:
    return int(t.timestamp() * 1000) if t else None


def _money(v: float) -> str:
    return f"${v:,.0f}"


def _integration_of(tool: str) -> str | None:
    if tool in ("forecast_utilization", "recommend_scaling"):
        return "martian"
    return TOOL_PREFIX.get(tool.split("_", 1)[0])


# --------------------------------------------------------------------------- builders


def _thread_session(t: ChatThread) -> dict[str, Any]:
    ctx = t.context or {}
    return {
        "id": f"thr_{t.id}",
        "title": t.title,
        "goal": t.title,
        "status": "completed",
        "source": "chat",
        "startedAt": ms(t.created_at),
        "endedAt": ms(t.updated_at),
        "integrations": [],
        "agents": [],
        "threadId": str(t.id),
        "summary": f"Conversation about {ctx['session_title']}" if ctx.get("session_title") else None,
    }


def _thread_detail(t: ChatThread, messages: list[Any]) -> dict[str, Any]:
    s = _thread_session(t)
    results = {m.tool_call_id: m for m in messages if isinstance(m, ToolMessage)}
    agents: dict[str, dict[str, Any]] = {}
    integrations: list[str] = []
    answer = ""
    base = s["startedAt"] or 0
    for i, m in enumerate(messages):
        at = m.additional_kwargs.get("ts") if hasattr(m, "additional_kwargs") else None
        t_ms = ms(datetime.fromisoformat(at)) if at else base + i * 1000
        if isinstance(m, AIMessage):
            if _text(m.content).strip() and not m.tool_calls:
                answer = _text(m.content)
            for tc in m.tool_calls:
                integ = _integration_of(tc["name"])
                name = INTERNAL_AGENT.get(tc["name"]) or (
                    f"{SHORT.get(integ, integ)} agent" if integ else "Martian"
                )
                a = agents.setdefault(
                    name,
                    {
                        "id": f"agt_{len(agents) + 1}",
                        "name": name,
                        "role": "Calls tools for this conversation",
                        "status": "done",
                        "startedAt": t_ms,
                        "integrations": [],
                        "steps": [],
                    },
                )
                if integ and integ != "martian":
                    if integ not in a["integrations"]:
                        a["integrations"].append(integ)
                    if integ not in integrations:
                        integrations.append(integ)
                res = results.get(tc["id"])
                failed = res is not None and getattr(res, "status", "") == "error"
                content = (
                    (_text(res.content) if not isinstance(res.content, str) else res.content) if res else ""
                )
                a["steps"].append(
                    {
                        "id": tc["id"],
                        "agentId": a["id"],
                        "at": t_ms,
                        "durationMs": 1000,
                        "kind": "tool",
                        "title": tc["name"].replace("_", " "),
                        "text": ("Failed: " + content[:160])
                        if failed
                        else ("Done." if res else "Waiting for approval."),
                        "tool": tc["name"],
                        "integration": integ,
                        "args": tc.get("args", {}),
                        "result": content[:RESULT_LIMIT] or None,
                        "status": "failed" if failed else ("done" if res else "pending"),
                    }
                )
                if failed:
                    a["status"] = "failed"
        elif isinstance(m, HumanMessage) and not agents:
            s["goal"] = _text(m.content)[:300] or s["goal"]
    if answer:
        a = agents.setdefault(
            "Martian",
            {
                "id": f"agt_{len(agents) + 1}",
                "name": "Martian",
                "role": "Writes the answer",
                "status": "done",
                "startedAt": s["endedAt"],
                "integrations": [],
                "steps": [],
            },
        )
        a["steps"].append(
            {
                "id": f"answer_{t.id}",
                "agentId": a["id"],
                "at": s["endedAt"],
                "durationMs": 500,
                "kind": "result",
                "title": "Answer",
                "text": answer[:600],
                "status": "done",
            }
        )
    s["agents"] = list(agents.values())
    s["integrations"] = integrations
    s["summary"] = s["summary"] or (answer[:220] if answer else None)
    return s


def _scan_session(scan: Scan, kinds: dict[str, str], detail: bool = False) -> dict[str, Any]:
    stats = scan.stats or {}
    per = stats.get("integrations", {}) or {}
    ints = [CATALOG_ID.get(kinds.get(i, ""), "custom") for i in per]
    start = ms(scan.started_at) or 0
    end = ms(scan.finished_at)
    status = SCAN_STATUS.get(scan.status, "running")
    trigger = scan.trigger or "schedule"
    title = {
        "schedule": "Scheduled discovery scan",
        "manual": "Discovery scan",
        "workflow": "Workflow scan",
    }.get(trigger, "Discovery scan")
    summary = None
    if stats:
        summary = (
            f"Scanned {stats.get('resources', 0):,} resources in {len(per)} integrations. "
            f"{stats.get('findings', 0)} findings worth {_money(float(stats.get('potential_savings', 0)))}/mo."
        )
    s: dict[str, Any] = {
        "id": f"scan_{scan.id}",
        "title": title,
        "goal": "Inventory every connected integration and refresh findings",
        "status": status,
        "source": "scan" if trigger != "schedule" else "schedule",
        "startedAt": start,
        "endedAt": end,
        "integrations": sorted(set(ints)),
        "agents": [],
        "summary": summary,
        "savings": float(stats.get("potential_savings", 0)) or None,
        "resourcesTouched": stats.get("resources"),
        "findingsCount": stats.get("findings"),
    }
    if not detail:
        # Enough for counts in the list without the full trace.
        s["agents"] = [
            {
                "id": "agt_discovery",
                "name": "Discovery",
                "role": "",
                "status": "done",
                "startedAt": start,
                "integrations": [],
                "steps": [
                    {
                        "id": k,
                        "tool": "inventory",
                        "status": "done",
                        "kind": "tool",
                        "agentId": "agt_discovery",
                        "at": start,
                        "durationMs": 0,
                        "title": "",
                        "text": "",
                    }
                    for k in per
                ],
            }
        ]
        return s
    span = max(1000, (end or start + 1000) - start)
    steps = []
    for n, (iid, info) in enumerate(per.items()):
        kind = kinds.get(iid, "custom")
        cid = CATALOG_ID.get(kind, "custom")
        err = (info or {}).get("error")
        steps.append(
            {
                "id": f"inv_{iid}",
                "agentId": "agt_discovery",
                "at": start + int(span * n / max(1, len(per)) * 0.7),
                "durationMs": int(span * 0.6 / max(1, len(per))),
                "kind": "tool",
                "title": f"Inventory {kind}",
                "text": f"Failed: {err}" if err else f"Found {(info or {}).get('resources', 0):,} resources.",
                "tool": f"{kind}_inventory",
                "integration": cid,
                "status": "failed" if err else "done",
                "metrics": [{"label": "resources", "value": f"{(info or {}).get('resources', 0):,}"}],
            }
        )
    analyst = (
        [
            {
                "id": f"rules_{scan.id}",
                "agentId": "agt_analyst",
                "at": start + int(span * 0.8),
                "durationMs": int(span * 0.15),
                "kind": "decide",
                "title": "Run findings rules",
                "text": f"{stats.get('opened', 0)} new, {stats.get('updated', 0)} updated and {stats.get('resolved', 0)} resolved.",
                "status": "done" if end else "running",
                "metrics": [
                    {"label": "findings", "value": str(stats.get("findings", 0))},
                    {"label": "waste", "value": f"{_money(float(stats.get('potential_savings', 0)))}/mo"},
                ],
            },
        ]
        if stats
        else []
    )
    s["agents"] = [
        {
            "id": "agt_discovery",
            "name": "Discovery",
            "role": "Inventories every connected integration",
            "status": "failed" if status == "failed" else ("running" if status == "running" else "done"),
            "startedAt": start,
            "endedAt": end,
            "integrations": sorted(set(ints)),
            "steps": steps,
        },
        *(
            [
                {
                    "id": "agt_analyst",
                    "name": "Cost analyst",
                    "role": "Runs the findings rules and ranks savings",
                    "status": "done" if end else "running",
                    "startedAt": start,
                    "endedAt": end,
                    "integrations": [],
                    "steps": analyst,
                }
            ]
            if analyst
            else []
        ),
    ]
    return s


def _action_session(a: Action, f: Finding | None, kind: str | None) -> dict[str, Any]:
    cid = CATALOG_ID.get(kind or "", "custom")
    status = ACTION_STATUS.get(a.status, "running")
    title = f"Apply: {f.title}" if f else a.description or a.tool
    start = ms(a.approved_at or a.created_at) or 0
    end = ms(a.finished_at)
    step = {
        "id": f"step_{a.id}",
        "agentId": "agt_remediator",
        "at": start,
        "durationMs": max(0, (end or start) - start),
        "kind": "tool",
        "title": a.tool.replace("_", " "),
        "tool": a.tool,
        "integration": cid,
        "args": a.args or {},
        "text": (
            f"Failed: {a.error[:160]}" if a.error else ("Done." if status == "completed" else "Running")
        ),
        "result": str((a.result or {}).get("output", ""))[:RESULT_LIMIT] or None,
        "status": "failed" if status == "failed" else ("done" if status == "completed" else "running"),
    }
    return {
        "id": f"act_{a.id}",
        "title": title[:200],
        "goal": f.description[:300] if f else title,
        "status": status,
        "source": "approval",
        "startedAt": start,
        "endedAt": end,
        "integrations": [cid] if cid != "custom" else [],
        "savings": float(f.est_monthly_savings) if f else None,
        "summary": a.description or None,
        "agents": [
            {
                "id": "agt_remediator",
                "name": "Remediator",
                "role": "Applies the approved change",
                "status": step["status"],
                "startedAt": start,
                "endedAt": end,
                "integrations": [cid] if cid != "custom" else [],
                "steps": [step],
            }
        ],
    }


async def _kinds(s: AsyncSession, org_id: uuid.UUID) -> dict[str, str]:
    rows = (
        await s.execute(select(Integration.id, Integration.kind).where(Integration.org_id == org_id))
    ).all()
    return {str(i): k for i, k in rows}


# --------------------------------------------------------------------------- routes


@router.get("/sessions")
async def list_sessions(
    limit: int = 60, p: Principal = Depends(current_principal), s: AsyncSession = Depends(tenant_db)
) -> dict:
    limit = max(1, min(limit, 200))
    kinds = await _kinds(s, p.org_id)
    threads = (
        await s.execute(
            select(ChatThread)
            .where(ChatThread.org_id == p.org_id, ChatThread.user_id == p.user_id)
            .order_by(ChatThread.updated_at.desc())
            .limit(limit)
        )
    ).scalars()
    scans = (
        await s.execute(
            select(Scan).where(Scan.org_id == p.org_id).order_by(Scan.started_at.desc()).limit(limit)
        )
    ).scalars()
    actions = (
        await s.execute(
            select(Action, Finding)
            .outerjoin(Finding, Finding.id == Action.finding_id)
            .where(Action.org_id == p.org_id, Action.finding_id.is_not(None))
            .order_by(Action.created_at.desc())
            .limit(limit)
        )
    ).all()
    sessions = [
        *(_thread_session(t) for t in threads),
        *(_scan_session(sc, kinds) for sc in scans),
        *(_action_session(a, f, kinds.get(str(a.integration_id))) for a, f in actions),
    ]
    sessions.sort(key=lambda x: -(x["startedAt"] or 0))
    return {"sessions": sessions[:limit]}


@router.get("/sessions/{session_id}")
async def get_session(
    session_id: str, p: Principal = Depends(current_principal), s: AsyncSession = Depends(tenant_db)
) -> dict:
    prefix, _, raw = session_id.partition("_")
    try:
        rid = uuid.UUID(raw)
    except ValueError:
        raise HTTPException(404, "That agent run doesn't exist.") from None
    if prefix == "thr":
        t = await s.get(ChatThread, rid)
        if t is None or (t.user_id != p.user_id and not p.at_least(Role.admin)):
            raise HTTPException(404, "That agent run doesn't exist.")
        return _thread_detail(t, await thread_messages(p.org_id, rid))
    if prefix == "scan":
        sc = await s.get(Scan, rid)
        if sc is None:
            raise HTTPException(404, "That agent run doesn't exist.")
        return _scan_session(sc, await _kinds(s, p.org_id), detail=True)
    if prefix == "act":
        a = await s.get(Action, rid)
        if a is None:
            raise HTTPException(404, "That agent run doesn't exist.")
        f = await s.get(Finding, a.finding_id) if a.finding_id else None
        return _action_session(a, f, (await _kinds(s, p.org_id)).get(str(a.integration_id)))
    raise HTTPException(404, "That agent run doesn't exist.")


class WorkflowBody(BaseModel):
    goal: str = Field(min_length=1, max_length=300)


@router.post("/workflows", status_code=202)
async def start_workflow(
    body: WorkflowBody, p: Principal = Depends(require(Role.approver)), s: AsyncSession = Depends(tenant_db)
) -> dict:
    """Start a read-only workflow. Today every workflow runs a full discovery scan."""
    job = await enqueue(
        s, "scan", {"trigger": "workflow", "goal": body.goal}, org_id=p.org_id, dedupe_key=f"scan:{p.org_id}"
    )
    return {"queued": job is not None, "session_id": None}
