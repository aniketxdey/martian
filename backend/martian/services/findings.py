"""Approving, executing, dismissing and rolling back findings."""

from __future__ import annotations

import uuid
from decimal import Decimal
from typing import Any

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from martian.db.base import org_session, utcnow
from martian.db.models import Action, Finding, Integration, Organization, Role
from martian.jobs.queue import enqueue
from martian.services import audit
from martian.services.mcp import ToolBackend
from martian.services.policy import PolicyError, check_write_allowed, require_role

log = structlog.get_logger()


class FindingStateError(ValueError):
    pass


async def approve_finding(
    s: AsyncSession,
    org_id: uuid.UUID,
    finding_id: uuid.UUID,
    actor: audit.Actor,
    role: str,
    user_id: uuid.UUID | None,
) -> Finding:
    require_role(role, Role.approver)
    finding = await s.get(Finding, finding_id, with_for_update=True)
    if finding is None or finding.org_id != org_id:
        raise LookupError("That finding doesn't exist anymore.")
    if finding.status != "open":
        raise FindingStateError(f"This finding is already {finding.status}.")
    if not finding.plan:
        raise FindingStateError("This finding needs a person to make the change. Martian has nothing to run.")
    for step in finding.plan:
        integration = await s.get(Integration, uuid.UUID(step["integration_id"]))
        if integration is None:
            raise FindingStateError("The integration for this finding was removed.")
        check_write_allowed(integration, step["tool"])
    now = utcnow()
    for step in finding.plan:
        s.add(
            Action(
                org_id=org_id,
                finding_id=finding.id,
                integration_id=uuid.UUID(step["integration_id"]),
                tool=step["tool"],
                args=step["args"],
                description=step.get("description", ""),
                status="approved",
                requested_by="finding",
                approved_by=user_id,
                approved_at=now,
                rollback=step.get("rollback"),
            )
        )
    finding.status = "approved"
    await enqueue(
        s,
        "execute_finding",
        {"finding_id": str(finding.id)},
        org_id=org_id,
        dedupe_key=f"execute:{finding.id}",
        max_attempts=1,
    )
    await audit.record(
        s,
        org_id,
        actor,
        "finding.approved",
        target_type="finding",
        target_id=str(finding.id),
        summary=f"approved “{finding.title}” (${finding.est_monthly_savings:,.0f}/mo)",
    )
    return finding


async def dismiss_finding(
    s: AsyncSession, org_id: uuid.UUID, finding_id: uuid.UUID, actor: audit.Actor, role: str, reason: str = ""
) -> Finding:
    require_role(role, Role.approver)
    finding = await s.get(Finding, finding_id)
    if finding is None or finding.org_id != org_id:
        raise LookupError("That finding doesn't exist anymore.")
    if finding.status not in {"open", "failed"}:
        raise FindingStateError(f"This finding is already {finding.status}.")
    finding.status = "dismissed"
    await audit.record(
        s,
        org_id,
        actor,
        "finding.dismissed",
        target_type="finding",
        target_id=str(finding.id),
        summary=f"dismissed “{finding.title}”",
        details={"reason": reason},
    )
    return finding


async def execute_finding(org_id: uuid.UUID, finding_id: uuid.UUID, backend: ToolBackend) -> dict[str, Any]:
    """Runs a finding's approved actions in order. On failure, rolls back the steps that succeeded."""
    async with org_session(org_id) as s:
        finding = await s.get(Finding, finding_id)
        if finding is None or finding.status not in {"approved", "running"}:
            return {"skipped": True}
        finding.status = "running"
        actions = list(
            (
                await s.execute(
                    select(Action)
                    .where(Action.finding_id == finding_id, Action.status.in_(["approved", "running"]))
                    .order_by(Action.created_at)
                )
            ).scalars()
        )
        title = finding.title

    done: list[Action] = []
    failure: str | None = None
    for action in actions:
        error = await run_action(org_id, action.id, backend)
        if error:
            failure = error
            break
        done.append(action)

    if failure:
        for action in reversed(done):
            await rollback_action(org_id, action.id, backend, reason="later step failed")

    async with org_session(org_id) as s:
        finding = await s.get(Finding, finding_id)
        assert finding is not None
        if failure:
            finding.status = "failed"
            summary = f"could not apply “{title}”: {failure[:200]}"
            action_name = "finding.failed"
        else:
            finding.status = "applied"
            finding.realized_monthly_savings = finding.est_monthly_savings
            finding.resolved_at = utcnow()
            summary = f"applied “{title}”, saving ${finding.est_monthly_savings:,.0f}/mo"
            action_name = "finding.applied"
        await audit.record(
            s,
            org_id,
            audit.Actor("agent", "martian-1", "Martian 1"),
            action_name,
            target_type="finding",
            target_id=str(finding_id),
            summary=summary,
        )
    return {"status": "failed" if failure else "applied", "error": failure}


async def run_action(org_id: uuid.UUID, action_id: uuid.UUID, backend: ToolBackend) -> str | None:
    """Executes one approved action. Returns an error message, or None on success."""
    async with org_session(org_id) as s:
        action = await s.get(Action, action_id)
        assert action is not None
        integration = await s.get(Integration, action.integration_id)
        try:
            if integration is None:
                raise PolicyError("That integration was removed.")
            check_write_allowed(integration, action.tool)  # policy may have changed since approval
        except PolicyError as exc:
            action.status = "failed"
            action.error = str(exc)
            action.finished_at = utcnow()
            return str(exc)
        action.status = "running"
        tool, args, iid = action.tool, dict(action.args), str(action.integration_id)
    try:
        result = await backend.call_tool(iid, tool, args)
        error = None
    except Exception as exc:  # noqa: BLE001
        result, error = None, str(exc)
    async with org_session(org_id) as s:
        action = await s.get(Action, action_id)
        assert action is not None
        action.status = "failed" if error else "succeeded"
        action.result = result if isinstance(result, dict) else {"result": result}
        action.error = error
        action.finished_at = utcnow()
        await audit.record(
            s,
            org_id,
            audit.Actor("agent", "martian-1", "Martian 1"),
            "action.failed" if error else "action.succeeded",
            target_type="action",
            target_id=str(action_id),
            summary=f"{action.description or tool}" + (f" failed: {error[:200]}" if error else ""),
            details={"tool": tool, "args": args},
        )
    return error


async def rollback_action(
    org_id: uuid.UUID, action_id: uuid.UUID, backend: ToolBackend, reason: str = ""
) -> str | None:
    async with org_session(org_id) as s:
        action = await s.get(Action, action_id)
        if action is None or action.status != "succeeded" or not action.rollback:
            return "nothing to roll back"
        rb = dict(action.rollback)
        iid = str(action.integration_id)
    try:
        await backend.call_tool(iid, rb["tool"], rb["args"])
        error = None
    except Exception as exc:  # noqa: BLE001
        error = str(exc)
    async with org_session(org_id) as s:
        action = await s.get(Action, action_id)
        assert action is not None
        if not error:
            action.status = "rolled_back"
        await audit.record(
            s,
            org_id,
            audit.Actor("agent", "martian-1", "Martian 1"),
            "action.rolled_back" if not error else "action.rollback_failed",
            target_type="action",
            target_id=str(action_id),
            summary=f"rolled back {action.description or action.tool}" + (f" ({reason})" if reason else "")
            if not error
            else f"rollback of {action.tool} failed: {error[:200]}",
        )
        if not error and action.finding_id:
            finding = await s.get(Finding, action.finding_id)
            if finding and finding.status == "applied":
                finding.status = "open"
                finding.realized_monthly_savings = Decimal(0)
                finding.resolved_at = None
    return error


async def org_of(s: AsyncSession, org_id: uuid.UUID) -> Organization:
    org = await s.get(Organization, org_id)
    if org is None:
        raise LookupError("organization not found")
    return org
