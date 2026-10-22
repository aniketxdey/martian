"""The approval gate: a write tool call pauses the run until a person decides."""

import uuid
from typing import Any

from langchain_core.messages import AIMessage, ToolMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from sqlalchemy import select

from martian.agents.chat import run_turn, thread_view
from martian.agents.llm import OfflinePlanner
from martian.db.base import org_session
from martian.db.models import ChatThread, Finding
from martian.scans.scan import run_scan


class ProposeApproval(OfflinePlanner):
    """Asks to approve a specific finding, then summarizes the tool result."""

    finding_id: str = ""

    def bind_tools(self, tools, **kw):  # type: ignore[override]
        return ProposeApproval(finding_id=self.finding_id, tool_names=[t.name for t in tools])

    def _generate(self, messages, stop=None, run_manager=None, **kw: Any) -> ChatResult:
        last = messages[-1]
        if isinstance(last, ToolMessage):
            msg = AIMessage(content=f"Result: {last.content}")
        else:
            msg = AIMessage(content="", tool_calls=[{"name": "approve_finding", "args": {"finding_id": self.finding_id},
                                                     "id": "call_approve_1"}])
        return ChatResult(generations=[ChatGeneration(message=msg)])


async def _events(gen):
    return [e async for e in gen]


async def _setup(tenant, backend):
    await run_scan(tenant["org"], backend)
    async with org_session(tenant["org"]) as s:
        f = (await s.execute(select(Finding).where(Finding.rule == "idle_compute"))).scalar_one()
        user_id = (await s.execute(select(ChatThread.user_id))).first()
        t = ChatThread(org_id=tenant["org"], user_id=user_id[0] if user_id else await _owner(tenant))
        s.add(t)
        await s.flush()
        return f.id, t.id


async def _owner(tenant):
    from martian.db.base import system_session
    from martian.db.models import Membership

    async with system_session() as s:
        return (await s.execute(select(Membership.user_id).where(Membership.org_id == tenant["org"]))).scalar_one()


async def test_write_tool_pauses_then_runs_after_approval(tenant, backend):
    finding_id, thread_id = await _setup(tenant, backend)
    model = ProposeApproval(finding_id=str(finding_id))
    user = {"user_id": str(await _owner(tenant)), "role": "owner", "email": "owner"}

    events = await _events(run_turn(tenant["org"], thread_id, user, message="approve the idle VMs",
                                    model=model, include_mcp=False))
    kinds = [e["event"] for e in events]
    assert "interrupt" in kinds
    pending = (await thread_view(tenant["org"], thread_id))["pending_approval"]
    assert pending["actions"][0]["tool"] == "approve_finding"
    async with org_session(tenant["org"]) as s:
        assert (await s.get(Finding, finding_id)).status == "open"  # nothing happened yet

    events = await _events(run_turn(tenant["org"], thread_id, user, resume={"approved": True},
                                    model=model, include_mcp=False))
    done = events[-1]["data"]
    assert done["pending_approval"] is None
    assert "approved" in done["messages"][-1]["content"]
    async with org_session(tenant["org"]) as s:
        assert (await s.get(Finding, finding_id)).status == "approved"


async def test_rejection_leaves_finding_untouched(tenant, backend):
    finding_id, thread_id = await _setup(tenant, backend)
    model = ProposeApproval(finding_id=str(finding_id))
    user = {"user_id": str(uuid.uuid4()), "role": "owner", "email": "owner"}
    await _events(run_turn(tenant["org"], thread_id, user, message="go", model=model, include_mcp=False))
    events = await _events(run_turn(tenant["org"], thread_id, user, resume={"approved": False, "comment": "not now"},
                                    model=model, include_mcp=False))
    assert "declined" in events[-1]["data"]["messages"][-1]["content"]
    async with org_session(tenant["org"]) as s:
        assert (await s.get(Finding, finding_id)).status == "open"
