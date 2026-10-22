"""End-to-end behavior against Postgres: tenancy, scans, approvals, execution, audit."""

import uuid

import pytest
from sqlalchemy import select, text

from martian.db.base import org_session, system_session
from martian.db.models import Action, Finding, Integration, Resource
from martian.jobs import queue
from martian.scans.scan import run_scan
from martian.services import audit, findings
from tests.fakes import FakeBackend


async def test_row_level_security_isolates_tenants(tenant, backend):
    await run_scan(tenant["org"], backend)
    other = uuid.uuid4()
    async with org_session(other) as s:
        # No org filter at all: RLS alone must hide the first tenant's rows.
        assert (await s.execute(select(Resource))).first() is None
        assert (await s.execute(select(Integration))).first() is None
    async with org_session(tenant["org"]) as s:
        assert (await s.execute(select(Resource))).first() is not None


async def test_scan_creates_findings_and_is_idempotent(tenant, backend):
    first = await run_scan(tenant["org"], backend)
    assert first["opened"] >= 5 and first["resources"] > 10
    assert first["forecasts"] == 1
    second = await run_scan(tenant["org"], backend)
    assert second["opened"] == 0 and second["updated"] == first["findings"]
    async with org_session(tenant["org"]) as s:
        rules = {f.rule for f in (await s.execute(select(Finding))).scalars()}
    assert {"idle_compute", "unattached_volumes", "overprovisioned_databases", "underutilized_hosts",
            "predictive_scaling"} <= rules


async def test_resolved_when_waste_disappears_and_dismissed_stays_dismissed(tenant, backend):
    await run_scan(tenant["org"], backend)
    async with org_session(tenant["org"]) as s:
        vols = (await s.execute(select(Finding).where(Finding.rule == "unattached_volumes"))).scalar_one()
        db = (await s.execute(select(Finding).where(Finding.rule == "overprovisioned_databases"))).scalar_one()
        db.status = "dismissed"
    backend.inventory["aws"] = [r for r in backend.inventory["aws"] if r["resource_type"] != "volume"]
    await run_scan(tenant["org"], backend)
    async with org_session(tenant["org"]) as s:
        assert (await s.get(Finding, vols.id)).status == "resolved"
        assert (await s.get(Finding, db.id)).status == "dismissed"


async def test_approve_execute_and_rollback(tenant, backend):
    await run_scan(tenant["org"], backend)
    actor = audit.Actor("user", "u", "owner")
    async with org_session(tenant["org"]) as s:
        f = (await s.execute(select(Finding).where(Finding.rule == "idle_compute"))).scalar_one()
        await findings.approve_finding(s, tenant["org"], f.id, actor, "owner", None)
    result = await findings.execute_finding(tenant["org"], f.id, backend)
    assert result["status"] == "applied"
    assert ("aws_stop_instances" in [c[1] for c in backend.calls])
    async with org_session(tenant["org"]) as s:
        f = await s.get(Finding, f.id)
        assert f.status == "applied" and f.realized_monthly_savings == f.est_monthly_savings
        action = (await s.execute(select(Action).where(Action.finding_id == f.id))).scalar_one()
        assert action.status == "succeeded"
    await findings.rollback_action(tenant["org"], action.id, backend)
    assert backend.calls[-1][1] == "aws_start_instances"
    async with org_session(tenant["org"]) as s:
        assert (await s.get(Action, action.id)).status == "rolled_back"
        assert (await s.get(Finding, f.id)).status == "open"


async def test_failed_step_rolls_back_earlier_steps(tenant):
    backend = FakeBackend()
    backend.inventory["aws"].append({  # second database so the plan has two steps
        "resource_id": "db-2", "resource_type": "database", "account": "111", "region": "us-east-1",
        "monthly_cost": 500, "attributes": {"instance_class": "db.m5.xlarge", "downsize_to": "db.m5.large"},
        "metrics": {"cpu_avg_14d": 3, "cpu_p95_14d": 9}})
    await run_scan(tenant["org"], backend)
    async with org_session(tenant["org"]) as s:
        f = (await s.execute(select(Finding).where(Finding.rule == "overprovisioned_databases"))).scalar_one()
        assert len(f.plan) == 2
        await findings.approve_finding(s, tenant["org"], f.id, audit.Actor.system(), "owner", None)

    calls = {"n": 0}
    original = backend.call_tool

    async def flaky(iid, tool, args):
        if tool == "aws_modify_db_instance_class" and args["db_instance_id"] == "db-2" and calls["n"] == 0:
            calls["n"] += 1
            raise RuntimeError("InvalidDBInstanceState")
        return await original(iid, tool, args)

    backend.call_tool = flaky
    result = await findings.execute_finding(tenant["org"], f.id, backend)
    assert result["status"] == "failed"
    # db-1 was resized, then rolled back to its original class
    rollback = [c for c in backend.calls if c[2].get("db_instance_id") == "db-1"]
    assert [c[2]["target_class"] for c in rollback] == ["db.r5.xlarge", "db.r5.2xlarge"]


async def test_read_only_integration_blocks_approval(tenant, backend):
    await run_scan(tenant["org"], backend)
    async with org_session(tenant["org"]) as s:
        (await s.get(Integration, tenant["aws"])).mode = "read"
    async with org_session(tenant["org"]) as s:
        f = (await s.execute(select(Finding).where(Finding.rule == "idle_compute"))).scalar_one()
        with pytest.raises(PermissionError):
            await findings.approve_finding(s, tenant["org"], f.id, audit.Actor.system(), "owner", None)


async def test_audit_chain_is_tamper_evident(tenant):
    async with org_session(tenant["org"]) as s:
        for i in range(3):
            await audit.record(s, tenant["org"], audit.Actor.system(), "test.event", summary=f"event {i}")
    async with org_session(tenant["org"]) as s:
        assert await audit.verify_chain(s, tenant["org"])
    async with org_session(tenant["org"]) as s:
        with pytest.raises(Exception, match="append-only"):
            await s.execute(text("UPDATE audit_log SET summary = 'tampered'"))


async def test_job_queue_claims_once_and_retries(tenant):
    async with system_session() as s:
        await s.execute(text("UPDATE jobs SET status = 'done' WHERE status IN ('queued', 'running')"))
        job = await queue.enqueue(s, "scan", {}, org_id=tenant["org"], dedupe_key=f"t:{tenant['org']}")
        dup = await queue.enqueue(s, "scan", {}, org_id=tenant["org"], dedupe_key=f"t:{tenant['org']}")
    assert job is not None and dup is None
    claimed = await queue.claim("w1")
    assert claimed is not None and claimed.id == job.id
    assert await queue.claim("w2") is None  # already claimed; nothing else queued
    await queue.fail(claimed, "boom")
    async with system_session() as s:
        from martian.db.models import Job

        row = await s.get(Job, job.id)
        assert row.status == "queued" and row.attempts == 1 and "boom" in row.last_error
