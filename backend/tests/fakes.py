"""An in-memory ToolBackend that mimics the connector's sandbox contract."""

from __future__ import annotations

import math
from typing import Any

from martian.services.mcp import ToolError

AWS_TOOLS = [
    {"name": "aws_inventory", "description": "", "write": False},
    {"name": "aws_verify_access", "description": "", "write": False},
    {"name": "aws_stop_instances", "description": "", "write": True},
    {"name": "aws_start_instances", "description": "", "write": True},
    {"name": "aws_snapshot_and_delete_volumes", "description": "", "write": True},
    {"name": "aws_modify_db_instance_class", "description": "", "write": True},
    {"name": "aws_delete_load_balancers", "description": "", "write": True},
    {"name": "aws_delete_nat_gateways", "description": "", "write": True},
    {"name": "aws_delete_snapshots", "description": "", "write": True},
    {"name": "aws_set_asg_desired_capacity", "description": "", "write": True},
]
VCENTER_TOOLS = [{"name": "vcenter_inventory", "description": "", "write": False}]


def aws_resources() -> list[dict[str, Any]]:
    rs: list[dict[str, Any]] = []
    for i in range(5):  # idle
        rs.append(
            {
                "resource_id": f"i-idle{i}",
                "resource_type": "vm",
                "name": f"idle-{i}",
                "account": "111",
                "region": "us-east-1",
                "state": "running",
                "monthly_cost": 100.0,
                "attributes": {"instance_type": "m5.large"},
                "metrics": {"cpu_avg_14d": 1.5, "cpu_p95_14d": 4},
            }
        )
    rs.append(
        {
            "resource_id": "i-busy",
            "resource_type": "vm",
            "name": "busy",
            "account": "111",
            "region": "us-east-1",
            "state": "running",
            "monthly_cost": 300.0,
            "metrics": {"cpu_avg_14d": 55, "cpu_p95_14d": 90},
        }
    )
    rs.append(
        {
            "resource_id": "i-protected",
            "resource_type": "vm",
            "name": "keep",
            "account": "111",
            "region": "us-east-1",
            "state": "running",
            "monthly_cost": 80.0,
            "tags": {"martian:protect": "true"},
            "metrics": {"cpu_avg_14d": 0.5, "cpu_p95_14d": 1},
        }
    )
    for i in range(3):
        rs.append(
            {
                "resource_id": f"vol-{i}",
                "resource_type": "volume",
                "account": "111",
                "region": "us-east-1",
                "state": "available",
                "monthly_cost": 40.0,
                "attributes": {"attached": False, "unattached_days": 30, "size_gb": 100},
            }
        )
    rs.append(
        {
            "resource_id": "db-1",
            "resource_type": "database",
            "name": "orders",
            "account": "111",
            "region": "us-east-1",
            "state": "available",
            "monthly_cost": 800.0,
            "attributes": {"instance_class": "db.r5.2xlarge", "downsize_to": "db.r5.xlarge"},
            "metrics": {"cpu_avg_14d": 6, "cpu_p95_14d": 20},
        }
    )
    series = [50 + 30 * math.sin(i / 24 * 2 * math.pi) for i in range(14 * 24)]
    rs.append(
        {
            "resource_id": "web-asg",
            "resource_type": "asg",
            "name": "web",
            "account": "111",
            "region": "us-east-1",
            "state": "active",
            "monthly_cost": 600.0,
            "attributes": {"desired": 6, "min": 2, "max": 12},
            "metrics": {"cpu_series": series},
        }
    )
    return rs


class FakeBackend:
    def __init__(self, fail_tools: set[str] | None = None):
        self.calls: list[tuple[str, str, dict[str, Any]]] = []
        self.fail_tools = fail_tools or set()
        self.inventory: dict[str, list[dict[str, Any]]] = {
            "aws": aws_resources(),
            "vcenter": [
                {
                    "resource_id": f"host-{i}",
                    "resource_type": "host",
                    "name": f"esx-{i}",
                    "environment": "dc",
                    "monthly_cost": 900.0,
                    "metrics": {"cpu_avg_14d": 12},
                }
                for i in range(4)
            ],
        }

    async def list_tools(self, integration_id: str) -> list[dict[str, Any]]:
        return AWS_TOOLS + VCENTER_TOOLS

    async def call_tool(self, integration_id: str, tool: str, args: dict[str, Any]) -> Any:
        self.calls.append((integration_id, tool, args))
        if tool in self.fail_tools:
            raise ToolError(f"{tool} failed: AccessDenied")
        if tool.endswith("_inventory"):
            return {"resources": self.inventory.get(tool.split("_")[0], [])}
        return {"ok": True, "tool": tool, "verified": True}

    async def forecast(self, tool: str, args: dict[str, Any]) -> Any:
        self.calls.append(("forecast", tool, args))
        return {"recommended_desired": 8, "peak_utilization": 86.0, "horizon_hours": 24}
