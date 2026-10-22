import json

from martian.db.base import system_session
from martian.db.models import Membership
from martian.scans.scan import run_scan


async def test_login_and_me(client, tenant):
    bad = await client.post("/auth/login", json={"email": tenant["email"], "password": "nope"})
    assert bad.status_code == 401
    ok = await client.post("/auth/login", json={"email": tenant["email"], "password": tenant["password"]})
    assert ok.status_code == 200 and ok.json()["role"] == "owner"
    me = await client.get("/auth/me")
    assert me.json()["user"]["email"] == tenant["email"]


async def test_requires_auth(client):
    assert (await client.get("/overview")).status_code == 401


async def test_cross_origin_writes_are_blocked(client, signed_in):
    r = await client.post("/scans", headers={"Origin": "https://evil.example"})
    assert r.status_code == 403


async def test_overview_findings_and_topology(client, signed_in, backend):
    await run_scan(signed_in["org"], backend)
    ov = (await client.get("/overview")).json()
    assert ov["monthly_cost"] > 0 and ov["waste_identified"] > 0 and 0 <= ov["health_score"] <= 100
    fs = (await client.get("/findings")).json()["findings"]
    assert fs and fs[0]["est_monthly_savings"] >= fs[-1]["est_monthly_savings"]
    assert all("evidence" in f for f in fs)
    topo = (await client.get("/inventory/topology")).json()
    assert {g["key"] for g in topo["groups"]} >= {"cloud", "dc"}
    activity = (await client.get("/activity")).json()["activity"]
    assert any("mapped" in a["text"] for a in activity)


async def test_viewer_cannot_approve(client, signed_in, backend):
    await run_scan(signed_in["org"], backend)
    async with system_session() as s:
        m = (await s.execute(Membership.__table__.select().where(Membership.org_id == signed_in["org"]))).first()
        await s.execute(Membership.__table__.update().where(Membership.org_id == signed_in["org"])
                        .values(role="viewer"))
    fid = (await client.get("/findings")).json()["findings"][0]["id"]
    r = await client.post(f"/findings/{fid}/approve")
    assert r.status_code == 403
    async with system_session() as s:
        await s.execute(Membership.__table__.update().where(Membership.org_id == signed_in["org"])
                        .values(role=m.role))


async def test_approve_via_api_queues_execution(client, signed_in, backend):
    await run_scan(signed_in["org"], backend)
    fs = (await client.get("/findings")).json()["findings"]
    idle = next(f for f in fs if f["rule"] == "idle_compute")
    r = await client.post(f"/findings/{idle['id']}/approve")
    assert r.status_code == 200 and r.json()["status"] == "approved"
    again = await client.post(f"/findings/{idle['id']}/approve")
    assert again.status_code == 409
    manual = next(f for f in fs if not f["automatable"])
    assert (await client.post(f"/findings/{manual['id']}/approve")).status_code == 409


async def test_integration_policy_and_connector_token(client, signed_in):
    lst = (await client.get("/integrations")).json()
    aws = next(i for i in lst["integrations"] if i["kind"] == "aws")
    r = await client.patch(f"/integrations/{aws['id']}", json={"mode": "read", "disabled_tools": ["aws_stop_instances"]})
    assert r.status_code == 200 and r.json()["mode"] == "read"
    created = (await client.post("/connectors", json={"name": "prod"})).json()
    assert created["token"].startswith("mct_") and "docker run" in created["install"]["docker"]
    listed = (await client.get("/connectors")).json()["connectors"]
    assert all("token" not in c for c in listed)


async def test_internal_endpoints_require_service_token(client, signed_in):
    assert (await client.post("/internal/connectors/auth", json={"token": "x"})).status_code == 401
    r = await client.post("/internal/connectors/auth", json={"token": "x"},
                          headers={"Authorization": "Bearer dev-internal-token-change-me"})
    assert r.status_code == 401  # valid service token, unknown connector token


async def test_chat_offline_answers_with_savings(client, signed_in, backend, monkeypatch):
    await run_scan(signed_in["org"], backend)
    # No MCP connections in tests: internal tools only.
    from martian.agents import chat

    real = chat.load_toolset
    monkeypatch.setattr(chat, "load_toolset", lambda org_id, include_mcp=True: real(org_id, include_mcp=False))
    thread = (await client.post("/chat/threads")).json()
    async with client.stream("POST", f"/chat/threads/{thread['id']}/messages",
                             json={"content": "Analyze my costs"}) as r:
        events = [line async for line in r.aiter_lines() if line.startswith("event:") or line.startswith("data:")]
    names = [e.split(": ", 1)[1] for e in events if e.startswith("event:")]
    assert "tool_start" in names and names[-1] == "done"
    done = json.loads(events[-1].split(": ", 1)[1])
    ai = [m for m in done["messages"] if m["type"] == "ai"]
    assert "Total Potential Monthly Savings" in ai[-1]["content"]
    assert done["run"] and done["run"][0]["tool"] == "list_findings"
