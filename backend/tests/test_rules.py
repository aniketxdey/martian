from martian.scans.rules import Res, evaluate
from tests.fakes import aws_resources


def _res(raw, integration="i1", provider="aws"):
    return Res(
        integration_id=integration,
        provider=provider,
        resource_id=raw["resource_id"],
        resource_type=raw["resource_type"],
        name=raw.get("name", ""),
        account=raw.get("account", ""),
        region=raw.get("region", ""),
        state=raw.get("state", ""),
        monthly_cost=raw.get("monthly_cost", 0),
        attributes=raw.get("attributes", {}),
        tags=raw.get("tags", {}),
        metrics=raw.get("metrics", {}),
    )


def test_rules_produce_expected_findings():
    findings = {
        f.rule: f
        for f in evaluate(
            [_res(r) for r in aws_resources()],
            {"web-asg": {"recommended_desired": 8, "peak_utilization": 86}},
        )
    }

    idle = findings["idle_compute"]
    assert sorted(idle.resource_ids) == [f"i-idle{i}" for i in range(5)]  # busy and protected excluded
    assert idle.est_monthly_savings == 500.0
    assert idle.plan[0]["tool"] == "aws_stop_instances"
    assert idle.plan[0]["rollback"]["tool"] == "aws_start_instances"

    vols = findings["unattached_volumes"]
    assert vols.est_monthly_savings == 120.0 - 300 * 0.05  # minus the snapshot that's kept

    db = findings["overprovisioned_databases"]
    assert db.plan[0]["args"]["target_class"] == "db.r5.xlarge"
    assert db.plan[0]["rollback"]["args"]["target_class"] == "db.r5.2xlarge"

    scale = findings["predictive_scaling"]
    assert scale.plan[0]["args"]["desired"] == 8 and scale.est_monthly_savings == 0


def test_fingerprint_is_stable_and_scoped():
    a = evaluate([_res(r) for r in aws_resources()])
    b = evaluate([_res(r) for r in aws_resources()])
    assert [f.fingerprint for f in a] == [f.fingerprint for f in b]
    other = evaluate([_res(r, integration="i2") for r in aws_resources()])
    assert not {f.fingerprint for f in a} & {f.fingerprint for f in other}


def test_host_consolidation_needs_two_hosts():
    one = [Res("v", "vcenter", "h1", "host", monthly_cost=900, metrics={"cpu_avg_14d": 5})]
    assert evaluate(one) == []
    two = one + [Res("v", "vcenter", "h2", "host", monthly_cost=900, metrics={"cpu_avg_14d": 5})]
    [f] = evaluate(two)
    assert f.rule == "underutilized_hosts" and f.plan == [] and f.est_monthly_savings == 900
