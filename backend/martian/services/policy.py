"""Who and what may change infrastructure."""

from __future__ import annotations

from decimal import Decimal
from typing import Any

from martian.db.models import Integration, Organization, PermissionMode, Role

DEFAULT_AUTO_APPROVE_MAX = Decimal("1000")


class PolicyError(PermissionError):
    pass


def tool_meta(integration: Integration, tool: str) -> dict[str, Any] | None:
    return next((t for t in integration.tools or [] if t.get("name") == tool), None)


def is_write_tool(integration: Integration, tool: str) -> bool:
    meta = tool_meta(integration, tool)
    # Unknown tools are treated as writes: fail closed.
    return True if meta is None else bool(meta.get("write", True))


def check_write_allowed(integration: Integration, tool: str) -> None:
    if not integration.enabled:
        raise PolicyError(f"{integration.name} is disabled")
    if integration.mode == PermissionMode.read.value:
        raise PolicyError(f"{integration.name} is read-only; change its permission mode to allow changes")
    if tool in (integration.disabled_tools or []):
        raise PolicyError(f"Tool {tool} is turned off for {integration.name}")
    if integration.tools and tool_meta(integration, tool) is None:
        raise PolicyError(f"{integration.name} does not provide the tool {tool}")


def check_read_allowed(integration: Integration, tool: str) -> None:
    if not integration.enabled:
        raise PolicyError(f"{integration.name} is disabled")
    if tool in (integration.disabled_tools or []):
        raise PolicyError(f"Tool {tool} is turned off for {integration.name}")


def auto_approve_limit(org: Organization) -> Decimal:
    return Decimal(str((org.settings or {}).get("auto_approve_max_monthly", DEFAULT_AUTO_APPROVE_MAX)))


def can_auto_approve(
    org: Organization, integration: Integration, risk: str, monthly_savings: Decimal
) -> bool:
    return (
        integration.mode == PermissionMode.auto.value
        and risk == "low"
        and monthly_savings <= auto_approve_limit(org)
    )


def require_role(role: str, minimum: Role) -> None:
    if Role(role).rank < minimum.rank:
        raise PolicyError(f"Requires {minimum.value} role")
