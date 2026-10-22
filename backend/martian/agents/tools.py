"""Tools available to the chat agent: internal read models, approvals, plus the MCP
tools of each enabled integration and the forecast service."""

from __future__ import annotations

import json
import re
import uuid
from dataclasses import dataclass, field
from typing import Any

from langchain_core.runnables import RunnableConfig
from langchain_core.tools import BaseTool, StructuredTool
from langchain_mcp_adapters.client import MultiServerMCPClient
from sqlalchemy import or_, select

from martian.config import get_settings
from martian.db.base import org_session
from martian.db.models import Finding, Integration, PermissionMode, Resource
from martian.services.mcp import gateway_headers, integration_url
from martian.services.overview import finding_dict, overview


@dataclass
class ToolInfo:
    write: bool
    integration_id: str | None = None
    integration_name: str = ""
    mcp_name: str = ""


@dataclass
class AgentToolset:
    tools: list[BaseTool]
    info: dict[str, ToolInfo] = field(default_factory=dict)


def _internal_tools(org_id: uuid.UUID) -> list[BaseTool]:
    async def get_overview() -> str:
        """Current monthly cost, waste identified, open findings, resource count and health score."""
        async with org_session(org_id) as s:
            return json.dumps(await overview(s, org_id))

    async def list_findings(
        status: str = "open", category: str | None = None, min_monthly_savings: float = 0
    ) -> str:
        """List optimization findings. status: open|applied|dismissed|all. category: compute|storage|database|network|scaling|data."""
        async with org_session(org_id) as s:
            q = select(Finding).where(Finding.org_id == org_id)
            if status != "all":
                q = q.where(Finding.status == status)
            if category:
                q = q.where(Finding.category == category)
            rows = (await s.execute(q.order_by(Finding.est_monthly_savings.desc()).limit(50))).scalars()
            items = [finding_dict(f) for f in rows if float(f.est_monthly_savings) >= min_monthly_savings]
            for i in items:
                i.pop("evidence", None)
            return json.dumps({"findings": items})

    async def get_finding(finding_id: str) -> str:
        """Full details and evidence for one finding."""
        async with org_session(org_id) as s:
            f = await s.get(Finding, uuid.UUID(finding_id))
            if f is None or f.org_id != org_id:
                return json.dumps({"error": "not found"})
            return json.dumps(finding_dict(f))

    async def search_inventory(
        query: str = "", resource_type: str | None = None, provider: str | None = None, limit: int = 25
    ) -> str:
        """Search tracked resources by name/id. resource_type: vm|volume|snapshot|database|load_balancer|nat_gateway|asg|host|file_share."""
        async with org_session(org_id) as s:
            q = select(Resource).where(Resource.org_id == org_id)
            if query:
                like = f"%{query}%"
                q = q.where(or_(Resource.name.ilike(like), Resource.resource_id.ilike(like)))
            if resource_type:
                q = q.where(Resource.resource_type == resource_type)
            if provider:
                q = q.where(Resource.provider == provider)
            rows = (
                await s.execute(q.order_by(Resource.monthly_cost.desc()).limit(min(limit, 100)))
            ).scalars()
            return json.dumps(
                {
                    "resources": [
                        {
                            "id": r.resource_id,
                            "name": r.name,
                            "type": r.resource_type,
                            "provider": r.provider,
                            "region": r.region,
                            "state": r.state,
                            "monthly_cost": float(r.monthly_cost),
                            "metrics": r.metrics,
                            "integration_id": str(r.integration_id),
                        }
                        for r in rows
                    ]
                }
            )

    async def approve_finding(finding_id: str, config: RunnableConfig) -> str:
        """Approve a finding so Martian applies its plan. The user confirms before this runs."""
        from martian.services import audit
        from martian.services import findings as svc
        from martian.services.policy import PolicyError

        c = (config or {}).get("configurable", {})
        user_id = c.get("user_id")
        actor = audit.Actor("user", str(user_id or ""), c.get("user_label", "user"))
        try:
            async with org_session(org_id) as s:
                f = await svc.approve_finding(
                    s,
                    org_id,
                    uuid.UUID(finding_id),
                    actor,
                    c.get("role", "viewer"),
                    uuid.UUID(user_id) if user_id else None,
                )
                return json.dumps(
                    {
                        "approved": True,
                        "title": f.title,
                        "status": "queued for execution",
                        "est_monthly_savings": float(f.est_monthly_savings),
                    }
                )
        except (LookupError, ValueError, PolicyError) as exc:
            return json.dumps({"approved": False, "error": str(exc)})

    return [
        StructuredTool.from_function(coroutine=get_overview, name="get_overview"),
        StructuredTool.from_function(coroutine=list_findings, name="list_findings"),
        StructuredTool.from_function(coroutine=get_finding, name="get_finding"),
        StructuredTool.from_function(coroutine=search_inventory, name="search_inventory"),
        StructuredTool.from_function(coroutine=approve_finding, name="approve_finding"),
    ]


def _server_names(integrations: list[Integration]) -> dict[str, str]:
    counts: dict[str, int] = {}
    names = {}
    for i in integrations:
        base = re.sub(r"[^a-z0-9]", "", i.kind.lower()) or "mcp"
        counts[base] = counts.get(base, 0) + 1
        names[str(i.id)] = base if counts[base] == 1 else f"{base}{counts[base]}"
    return names


async def load_toolset(org_id: uuid.UUID, include_mcp: bool = True) -> AgentToolset:
    tools = _internal_tools(org_id)
    info: dict[str, ToolInfo] = {t.name: ToolInfo(write=False) for t in tools}
    info["approve_finding"] = ToolInfo(write=True, integration_name="Martian")
    if not include_mcp:
        return AgentToolset(tools, info)

    async with org_session(org_id) as s:
        integrations = list(
            (
                await s.execute(
                    select(Integration).where(
                        Integration.org_id == org_id,
                        Integration.enabled.is_(True),
                        Integration.status == "connected",
                    )
                )
            ).scalars()
        )
    names = _server_names(integrations)
    connections: dict[str, Any] = {
        names[str(i.id)]: {
            "transport": "streamable_http",
            "url": integration_url(i.id),
            "headers": gateway_headers(org_id),
            "timeout": 60,
        }
        for i in integrations
    }
    s_ = get_settings()
    connections["forecast"] = {
        "transport": "streamable_http",
        "url": s_.forecast_url,
        "headers": {"Authorization": f"Bearer {s_.internal_token}"},
        "timeout": 60,
    }
    by_name = {names[str(i.id)]: i for i in integrations}
    client = MultiServerMCPClient(
        connections, tool_name_prefix=len(integrations) > len({i.kind for i in integrations})
    )
    for server, integration in [*by_name.items(), ("forecast", None)]:
        try:
            server_tools = await client.get_tools(server_name=server)
        except Exception:  # noqa: BLE001 - an offline connector must not break chat
            continue
        for t in server_tools:
            md = t.metadata or {}
            meta = md.get("_meta") or {}
            write = bool(meta.get("martian/write", not md.get("readOnlyHint", False)))
            if integration is not None:
                if t.name.split("_", 1)[-1] in (integration.disabled_tools or []) or t.name in (
                    integration.disabled_tools or []
                ):
                    continue
                if write and integration.mode == PermissionMode.read.value:
                    continue
            tools.append(t)
            info[t.name] = ToolInfo(
                write=write,
                integration_id=str(integration.id) if integration else None,
                integration_name=integration.name if integration else "Forecast",
                mcp_name=t.name,
            )
    return AgentToolset(tools, info)
