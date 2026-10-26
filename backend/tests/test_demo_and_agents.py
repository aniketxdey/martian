"""Demo mode, thread context and skills in the prompt, agent runs and the infrastructure map."""

from __future__ import annotations

import json
import uuid
from typing import Any

from langchain_core.messages import SystemMessage

from martian.agents import chat
from martian.agents.chat import run_turn
from martian.agents.llm import OfflinePlanner
from martian.config import get_settings
from martian.db.base import org_session
from martian.db.models import ChatThread, DemoSnapshot
from martian.scans.scan import run_scan

SNAPSHOT: dict[str, Any] = {
    "version": 1,
    "org": {"name": "Northwind Commerce", "industry": "Retail", "hq": "Seattle, WA"},
    "overview": {
        "health_score": 81,
        "monthly_cost": 94100,
        "waste_identified": 3400,
        "realized_savings": 600,
        "resources": 512,
        "accounts": 3,
        "open_findings": 2,
    },
    "integrations": [
        {
            "id": "aws",
            "name": "Amazon Web Services",
            "status": "connected",
            "enabled": True,
            "mode": "ask",
            "scope": ["412983007231 · us-east-1"],
            "write_tools": ["aws_stop_instances"],
        }
    ],
    "clusters": [
        {
            "id": "aws-prod",
            "node_id": "cl:aws-prod",
            "name": "AWS prod",
            "integration": "aws",
            "env": "cloud",
            "location": "us-east-1",
            "services": [
                {
                    "id": "web",
                    "node_id": "svc:aws-prod/web",
                    "name": "Storefront web fleet",
                    "type": "vm-fleet",
                    "integration": "aws",
                    "count": 64,
                    "unit": "instances",
                    "monthly_cost": 41000,
                    "cpu": 63.5,
                    "mem": 55.0,
                    "depends_on": [],
                    "tags": ["prod"],
                },
                {
                    "id": "batch",
                    "node_id": "svc:aws-prod/batch",
                    "name": "Batch workers",
                    "type": "vm-fleet",
                    "integration": "aws",
                    "count": 12,
                    "unit": "instances",
                    "monthly_cost": 5200,
                    "cpu": 2.1,
                    "mem": 9.0,
                    "depends_on": ["web"],
                    "tags": [],
                },
            ],
        }
    ],
    "telemetry": {
        "svc:aws-prod/web": {"cpu_24h": [50.0 + i % 12 for i in range(48)], "mem_24h": [55.0] * 48}
    },
    "findings": [
        {
            "id": "f-batch-idle",
            "title": "Stop 12 idle batch workers",
            "description": "Under 3% CPU for 14 days.",
            "scope": "AWS · us-east-1",
            "affects": "12 instances",
            "est_monthly_savings": 2400,
            "effort": "easy",
            "time_to_apply": "5 minutes",
            "status": "open",
            "automatable": True,
            "integration": "aws",
            "node_id": "svc:aws-prod/batch",
            "steps": ["Stop the instances"],
        },
        {
            "id": "f-web-rightsize",
            "title": "Right-size the web fleet",
            "description": "p95 CPU is 70%.",
            "scope": "AWS · us-east-1",
            "affects": "64 instances",
            "est_monthly_savings": 1000,
            "effort": "medium",
            "time_to_apply": "1 day",
            "status": "open",
            "automatable": False,
            "integration": "aws",
            "node_id": "svc:aws-prod/web",
            "steps": [],
        },
    ],
    "sessions": [
        {
            "id": "ses_scan_1",
            "title": "Scheduled discovery scan",
            "goal": "Inventory everything",
            "status": "completed",
            "source": "schedule",
            "started_at": "2026-10-26T12:00:00Z",
            "ended_at": "2026-10-26T12:01:00Z",
            "integrations": ["aws"],
            "summary": "Scanned 1 cluster.",
            "savings": None,
            "agents": [
                {
                    "name": "Discovery",
                    "role": "Inventories",
                    "status": "done",
                    "steps": [
                        {
                            "kind": "tool",
                            "title": "Inventory AWS prod",
                            "text": "Found 76 resources.",
                            "tool": "aws_inventory",
                            "integration": "aws",
                            "status": "done",
                        }
                    ],
                }
            ],
        }
    ],
    "activity": [],
}


async def _events(gen):
    return [e async for e in gen]


async def _thread(tenant, context: dict | None = None) -> tuple[uuid.UUID, dict]:
    from sqlalchemy import select

    from martian.db.base import system_session
    from martian.db.models import Membership

    async with system_session() as s:
        owner = (
            await s.execute(select(Membership.user_id).where(Membership.org_id == tenant["org"]))
        ).scalar_one()
    async with org_session(tenant["org"]) as s:
        t = ChatThread(org_id=tenant["org"], user_id=owner, context=context or {})
        s.add(t)
        await s.flush()
        return t.id, {"user_id": str(owner), "role": "owner", "email": "owner"}


async def test_demo_config_is_public_and_follows_the_setting(client, monkeypatch):
    assert (await client.get("/demo/config")).json() == {"enabled": False}
    monkeypatch.setattr(get_settings(), "demo_mode", True)
    assert (await client.get("/demo/config")).json() == {"enabled": True}


async def test_snapshot_upload_needs_demo_mode_and_a_valid_body(client, signed_in, monkeypatch):
    assert (await client.put("/demo/snapshot", json=SNAPSHOT)).status_code == 404
    monkeypatch.setattr(get_settings(), "demo_mode", True)
    assert (await client.put("/demo/snapshot", json={"hello": 1})).status_code == 422
    r = await client.put("/demo/snapshot", json=SNAPSHOT)
    assert r.status_code == 200, r.text
    got = (await client.get("/demo/snapshot")).json()
    assert got["data"]["org"]["name"] == "Northwind Commerce"


async def test_demo_tools_answer_from_the_snapshot_and_gate_approvals(tenant, monkeypatch):
    monkeypatch.setattr(get_settings(), "demo_mode", True)
    async with org_session(tenant["org"]) as s:
        s.add(DemoSnapshot(org_id=tenant["org"], data=SNAPSHOT))
    thread_id, user = await _thread(tenant)

    events = await _events(
        run_turn(
            tenant["org"],
            thread_id,
            user,
            message="Where are we wasting money?",
            model=OfflinePlanner(),
            include_mcp=False,
        )
    )
    ends = [e for e in events if e["event"] == "tool_end"]
    assert ends and ends[0]["data"]["tool"] == "list_findings"
    assert "f-batch-idle" in ends[0]["data"]["result"]  # tool results reach the trace
    answer = events[-1]["data"]["messages"][-1]["content"]
    assert "$3,400/mo" in answer and "Stop 12 idle batch workers" in answer

    events = await _events(
        run_turn(
            tenant["org"],
            thread_id,
            user,
            message="Approve the idle batch workers",
            model=OfflinePlanner(),
            include_mcp=False,
        )
    )
    pending = events[-1]["data"]["pending_approval"]
    assert pending["actions"][0] == {
        "tool_call_id": pending["actions"][0]["tool_call_id"],
        "tool": "approve_finding",
        "args": {"finding_id": "f-batch-idle"},
        "integration": "Martian",
    }
    events = await _events(
        run_turn(
            tenant["org"],
            thread_id,
            user,
            resume={"approved": True},
            model=OfflinePlanner(),
            include_mcp=False,
        )
    )
    end = next(e for e in events if e["event"] == "tool_end")
    assert json.loads(end["data"]["result"])["approved"] is True
    async with org_session(tenant["org"]) as s:
        snap = await s.get(DemoSnapshot, tenant["org"])
        assert next(f for f in snap.data["findings"] if f["id"] == "f-batch-idle")["status"] == "running"


async def test_start_workflow_runs_without_approval_in_demo_mode(tenant, monkeypatch):
    monkeypatch.setattr(get_settings(), "demo_mode", True)
    async with org_session(tenant["org"]) as s:
        s.add(DemoSnapshot(org_id=tenant["org"], data=SNAPSHOT))
    thread_id, user = await _thread(tenant)
    events = await _events(
        run_turn(
            tenant["org"],
            thread_id,
            user,
            message="Start a duplicate data sweep",
            model=OfflinePlanner(),
            include_mcp=False,
        )
    )
    assert not events[-1]["data"]["pending_approval"]
    end = next(e for e in events if e["event"] == "tool_end")
    assert end["data"]["tool"] == "start_workflow"
    assert json.loads(end["data"]["result"]) == {
        "started": True,
        "goal": "duplicate data sweep",
        "where": "Agents page",
    }


class CapturePrompt(OfflinePlanner):
    seen: list[str] = []

    def bind_tools(self, tools, **kw):  # type: ignore[override]
        return CapturePrompt(tool_names=[t.name for t in tools])

    def _generate(self, messages, stop=None, run_manager=None, **kw):
        CapturePrompt.seen.append(next(str(m.content) for m in messages if isinstance(m, SystemMessage)))
        return super()._generate(messages, stop, run_manager, **kw)


async def test_thread_context_and_skills_reach_the_system_prompt(client, signed_in, backend, monkeypatch):
    await run_scan(signed_in["org"], backend)
    real = chat.load_toolset
    monkeypatch.setattr(
        chat, "load_toolset", lambda org_id, include_mcp=True: real(org_id, include_mcp=False)
    )
    monkeypatch.setattr(chat, "get_chat_model", lambda: CapturePrompt())
    CapturePrompt.seen = []
    ctx = {"kind": "session", "session_id": "scan_123", "session_title": "Scheduled discovery scan"}
    r = await client.post("/chat/threads", json={"context": ctx})
    assert r.status_code == 201 and r.json()["context"] == ctx
    thread = r.json()
    assert (await client.get(f"/chat/threads/{thread['id']}")).json()["context"] == ctx
    async with client.stream(
        "POST", f"/chat/threads/{thread['id']}/messages", json={"content": "What happened?"}
    ) as s:
        [line async for line in s.aiter_lines()]
    prompt = CapturePrompt.seen[0]
    assert "session_id: scan_123" in prompt and "Scheduled discovery scan" in prompt
    assert "## Skill: writing-style" in prompt and "em dashes" in prompt
    # A thread without context keeps the plain prompt.
    plain = (await client.post("/chat/threads")).json()
    assert plain["context"] == {}


async def test_agent_runs_cover_scans_and_conversations(client, signed_in, backend, monkeypatch):
    await run_scan(signed_in["org"], backend)
    real = chat.load_toolset
    monkeypatch.setattr(
        chat, "load_toolset", lambda org_id, include_mcp=True: real(org_id, include_mcp=False)
    )
    thread = (await client.post("/chat/threads")).json()
    async with client.stream(
        "POST", f"/chat/threads/{thread['id']}/messages", json={"content": "Analyze my costs"}
    ) as s:
        [line async for line in s.aiter_lines()]

    sessions = (await client.get("/agents/sessions")).json()["sessions"]
    ids = {s["id"].split("_", 1)[0] for s in sessions}
    assert {"scan", "thr"} <= ids
    assert all(isinstance(s["startedAt"], int) for s in sessions)

    scan = next(s for s in sessions if s["id"].startswith("scan_"))
    detail = (await client.get(f"/agents/sessions/{scan['id']}")).json()
    assert detail["status"] == "completed" and detail["agents"][0]["name"] == "Discovery"
    assert {st["tool"] for st in detail["agents"][0]["steps"]} >= {"aws_inventory", "vcenter_inventory"}

    convo = (await client.get(f"/agents/sessions/thr_{thread['id']}")).json()
    steps = [st for a in convo["agents"] for st in a["steps"]]
    assert any(st.get("tool") == "list_findings" and st.get("result") for st in steps)
    assert (await client.get(f"/agents/sessions/thr_{uuid.uuid4()}")).status_code == 404
    assert (await client.get("/agents/sessions/nope")).status_code == 404


async def test_workflows_queue_a_scan(client, signed_in):
    r = await client.post("/agents/workflows", json={"goal": "Check the data warehouses"})
    assert r.status_code == 202 and r.json()["queued"] is True


async def test_inventory_graph_and_finding_placement(client, signed_in, backend):
    await run_scan(signed_in["org"], backend)
    g = (await client.get("/inventory/graph")).json()
    kinds = {n["kind"] for n in g["nodes"]}
    assert kinds == {"integration", "cluster", "service"}
    ids = {n["id"] for n in g["nodes"]}
    assert all(e["from"] in ids and e["to"] in ids for e in g["edges"])
    assert any(n["integration"] == "vmware" for n in g["nodes"] if n["kind"] == "integration")
    findings = (await client.get("/findings")).json()["findings"]
    placed = [f for f in findings if f["node_id"]]
    assert placed and all(f["node_id"] in ids for f in placed)
    assert {f["integration_kind"] for f in findings} <= {"aws", "vcenter", None}
    assert all(f["created_at"] for f in findings)


async def test_me_has_flat_fields_for_the_console(client, signed_in):
    me = (await client.get("/auth/me")).json()
    assert me["email"] == signed_in["email"] and me["org_name"] and me["name"] and me["role"] == "owner"
    assert (await client.get("/overview")).json()["realized_savings"] == 0
