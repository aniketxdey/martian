"""The Ask Martian agent: a LangGraph ReAct loop with a human approval gate.

    START → agent ─(tool calls?)→ gate ─(approved / read-only)→ tools → record → agent
                  └─(answer)→ END      └─(rejected)→ agent

The gate pauses the run with `interrupt()` whenever the model wants to call a write
tool on an integration that is not in `auto` mode. Graph state is checkpointed in
Postgres, so a pending approval survives restarts; `resume()` continues the run with
the user's decision.
"""

from __future__ import annotations

import json
import time
import uuid
from collections.abc import AsyncIterator
from typing import Annotated, Any, TypedDict

import structlog
from langchain_core.messages import (
    AIMessage,
    AIMessageChunk,
    AnyMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
)
from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode
from langgraph.types import Command, interrupt
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool
from sqlalchemy import select

from martian.agents.llm import get_chat_model
from martian.agents.tools import AgentToolset, ToolInfo, load_toolset
from martian.config import get_settings
from martian.db.base import org_session, utcnow
from martian.db.models import Action, Integration, PermissionMode
from martian.services import audit

log = structlog.get_logger()

SYSTEM_PROMPT = """You are Martian, an infrastructure optimization agent for enterprise IT, DevOps and finance teams.
You work through tools connected to the customer's AWS, Azure, Google Cloud, VMware and on-premises systems.

Rules:
- Ground every number in tool results. Never invent costs, counts or savings.
- Prefer `list_findings`, `get_overview` and `search_inventory` for questions about waste and spend; use
  integration tools for live detail; use forecast tools for demand or scaling questions.
- Changing infrastructure always goes through an approval card the user sees. Propose changes with
  `approve_finding` (for an existing finding) or the integration's write tool, and explain the impact first.
- Write for a mixed audience: lead with the answer and the dollar impact, then the detail an engineer needs.
- When summarizing savings, use this exact layout so the console can render it:
    Total Potential Monthly Savings: $X
    Daily Savings: $Y
    <Category>: $N/month
    • detail line
    • detail line
    ROI Analysis:
    • Annual Savings: $A
- Keep answers short. No emoji."""


class ChatState(TypedDict):
    messages: Annotated[list[AnyMessage], add_messages]


# --------------------------------------------------------------------------- checkpointer

_pool: AsyncConnectionPool | None = None
_saver: AsyncPostgresSaver | None = None


def _conninfo() -> str:
    return get_settings().database_url.replace("postgresql+psycopg://", "postgresql://")


async def get_checkpointer() -> AsyncPostgresSaver:
    global _pool, _saver
    if _saver is None:
        _pool = AsyncConnectionPool(
            _conninfo(),
            max_size=10,
            open=False,
            kwargs={"autocommit": True, "prepare_threshold": 0, "row_factory": dict_row},
        )
        await _pool.open()
        _saver = AsyncPostgresSaver(_pool)  # type: ignore[arg-type]
        await _saver.setup()
    return _saver


async def close_checkpointer() -> None:
    global _pool, _saver
    if _pool is not None:
        await _pool.close()
    _pool = None
    _saver = None


# --------------------------------------------------------------------------- graph


def build_graph(org_id: uuid.UUID, toolset: AgentToolset, model=None) -> StateGraph:
    model = (model or get_chat_model()).bind_tools(toolset.tools)
    tool_node = ToolNode(toolset.tools, handle_tool_errors=True)

    async def agent(state: ChatState, config: RunnableConfig) -> dict[str, Any]:
        response = await model.ainvoke([SystemMessage(SYSTEM_PROMPT), *state["messages"]], config)
        return {"messages": [response]}

    def route(state: ChatState) -> str:
        last = state["messages"][-1]
        return "gate" if isinstance(last, AIMessage) and last.tool_calls else END

    async def gate(state: ChatState, config: RunnableConfig) -> Command:
        last = state["messages"][-1]
        assert isinstance(last, AIMessage)
        writes = [tc for tc in last.tool_calls if toolset.info.get(tc["name"], ToolInfo(write=True)).write]
        if not writes:
            return Command(goto="tools")

        modes = await _integration_modes(
            org_id, {toolset.info[tc["name"]].integration_id for tc in writes if tc["name"] in toolset.info}
        )
        needs_approval = [
            tc
            for tc in writes
            if modes.get(toolset.info.get(tc["name"], ToolInfo(write=True)).integration_id)
            != PermissionMode.auto.value
        ]
        approved_by = "auto"
        if needs_approval:
            decision = interrupt(
                {
                    "type": "approval",
                    "actions": [
                        {
                            "tool_call_id": tc["id"],
                            "tool": tc["name"],
                            "args": tc["args"],
                            "integration": toolset.info.get(
                                tc["name"], ToolInfo(write=True)
                            ).integration_name,
                        }
                        for tc in needs_approval
                    ],
                }
            )
            if not (isinstance(decision, dict) and decision.get("approved")):
                note = (decision or {}).get("comment") if isinstance(decision, dict) else None
                text = "The user declined this change." + (f" Their note: {note}" if note else "")
                return Command(
                    goto="agent",
                    update={
                        "messages": [
                            ToolMessage(content=text, tool_call_id=tc["id"], name=tc["name"], status="error")
                            for tc in last.tool_calls
                        ]
                    },
                )
            approved_by = str(decision.get("user_id") or "user")

        await _record_actions(org_id, config, toolset, writes, approved_by)
        return Command(goto="tools")

    async def record(state: ChatState, config: RunnableConfig) -> dict[str, Any]:
        results = {}
        for m in reversed(state["messages"]):
            if not isinstance(m, ToolMessage):
                break
            results[m.tool_call_id] = m
        await _finish_actions(org_id, results)
        return {}

    g = StateGraph(ChatState)
    g.add_node("agent", agent)
    g.add_node("gate", gate, destinations=("tools", "agent"))
    g.add_node("tools", tool_node)
    g.add_node("record", record)
    g.add_edge(START, "agent")
    g.add_conditional_edges("agent", route, {"gate": "gate", END: END})
    g.add_edge("tools", "record")
    g.add_edge("record", "agent")
    return g


async def _integration_modes(org_id: uuid.UUID, ids: set[str | None]) -> dict[str | None, str]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    async with org_session(org_id) as s:
        rows = await s.execute(
            select(Integration.id, Integration.mode).where(Integration.id.in_([uuid.UUID(i) for i in ids]))
        )
        return {str(i): m for i, m in rows}


async def _record_actions(
    org_id: uuid.UUID,
    config: RunnableConfig,
    toolset: AgentToolset,
    calls: list[dict[str, Any]],
    approved_by: str,
) -> None:
    c = config.get("configurable", {})
    thread_id = c.get("thread_id")
    async with org_session(org_id) as s:
        for tc in calls:
            info = toolset.info.get(tc["name"])
            if not info or not info.integration_id:
                continue  # internal tools (approve_finding) audit themselves
            s.add(
                Action(
                    org_id=org_id,
                    thread_id=uuid.UUID(thread_id) if thread_id else None,
                    integration_id=uuid.UUID(info.integration_id),
                    tool=tc["name"],
                    args=tc["args"],
                    description=f"{tc['name']} via Ask Martian",
                    status="running",
                    requested_by="agent",
                    approved_by=uuid.UUID(approved_by) if _is_uuid(approved_by) else None,
                    approved_at=utcnow(),
                    result={"tool_call_id": tc["id"]},
                )
            )
            await audit.record(
                s,
                org_id,
                audit.Actor("user", approved_by, c.get("user_label", ""))
                if approved_by != "auto"
                else audit.Actor("system", "auto-approve", "Auto-approve policy"),
                "action.approved",
                target_type="tool",
                target_id=tc["name"],
                summary=f"approved {tc['name']} on {info.integration_name}",
                details={"args": tc["args"]},
            )


async def _finish_actions(org_id: uuid.UUID, results: dict[str, ToolMessage]) -> None:
    if not results:
        return
    async with org_session(org_id) as s:
        rows = (
            await s.execute(
                select(Action).where(
                    Action.org_id == org_id, Action.status == "running", Action.requested_by == "agent"
                )
            )
        ).scalars()
        for a in rows:
            msg = results.get((a.result or {}).get("tool_call_id", ""))
            if msg is None:
                continue
            failed = getattr(msg, "status", "success") == "error"
            a.status = "failed" if failed else "succeeded"
            a.result = {"tool_call_id": msg.tool_call_id, "output": str(msg.content)[:20000]}
            a.error = str(msg.content)[:2000] if failed else None
            a.finished_at = utcnow()
            await audit.record(
                s,
                org_id,
                audit.Actor("agent", "martian", "Martian"),
                "action.failed" if failed else "action.succeeded",
                target_type="action",
                target_id=str(a.id),
                summary=f"{a.tool} {'failed' if failed else 'completed'}",
            )


def _is_uuid(v: str) -> bool:
    try:
        uuid.UUID(v)
        return True
    except ValueError:
        return False


# --------------------------------------------------------------------------- running


def _config(thread_id: uuid.UUID, user: dict[str, Any]) -> RunnableConfig:
    return {
        "configurable": {
            "thread_id": str(thread_id),
            "user_id": user.get("user_id"),
            "role": user.get("role", "viewer"),
            "user_label": user.get("email", ""),
        },
        "recursion_limit": 30,
    }


async def run_turn(
    org_id: uuid.UUID,
    thread_id: uuid.UUID,
    user: dict[str, Any],
    *,
    message: str | None = None,
    resume: dict[str, Any] | None = None,
    model=None,
    include_mcp: bool = True,
) -> AsyncIterator[dict[str, Any]]:
    """Streams events: token, tool_start, tool_end, interrupt, done, error."""
    toolset = await load_toolset(org_id, include_mcp=include_mcp)
    graph = build_graph(org_id, toolset, model).compile(checkpointer=await get_checkpointer())
    config = _config(thread_id, user)
    if resume is not None:
        inputs: Any = Command(resume={**resume, "user_id": user.get("user_id")})
    else:
        inputs = {"messages": [HumanMessage(content=message or "")]}
    started: dict[str, float] = {}
    try:
        async for mode, chunk in graph.astream(inputs, config, stream_mode=["messages", "updates"]):
            if mode == "messages":
                msg, meta = chunk
                if meta.get("langgraph_node") == "agent" and isinstance(msg, AIMessageChunk | AIMessage):
                    text = _text(msg.content)
                    if text:
                        yield {"event": "token", "data": {"text": text}}
                    for tc in getattr(msg, "tool_calls", None) or []:
                        if tc.get("name"):
                            started[tc.get("id", "")] = time.monotonic()
                            yield {
                                "event": "tool_start",
                                "data": {"id": tc.get("id"), "tool": tc["name"], "args": tc.get("args", {})},
                            }
            elif mode == "updates":
                if "__interrupt__" in chunk:
                    for intr in chunk["__interrupt__"]:
                        yield {"event": "interrupt", "data": intr.value}
                for node, update in chunk.items():
                    if node == "tools" and isinstance(update, dict):
                        for m in update.get("messages", []):
                            if isinstance(m, ToolMessage):
                                dt = time.monotonic() - started.get(m.tool_call_id, time.monotonic())
                                yield {
                                    "event": "tool_end",
                                    "data": {
                                        "id": m.tool_call_id,
                                        "tool": m.name,
                                        "ok": getattr(m, "status", "success") != "error",
                                        "seconds": round(dt, 1),
                                    },
                                }
    except Exception as exc:  # noqa: BLE001
        log.exception("chat_turn_failed", thread=str(thread_id))
        yield {"event": "error", "data": {"message": str(exc)[:500]}}
    yield {"event": "done", "data": await thread_view(org_id, thread_id, graph=graph, config=config)}


async def thread_view(org_id: uuid.UUID, thread_id: uuid.UUID, *, graph=None, config=None) -> dict[str, Any]:
    if graph is None:
        toolset = await load_toolset(org_id, include_mcp=False)
        graph = build_graph(org_id, toolset).compile(checkpointer=await get_checkpointer())
        config = _config(thread_id, {})
    snapshot = await graph.aget_state(config)
    messages: list[AnyMessage] = snapshot.values.get("messages", []) if snapshot and snapshot.values else []
    pending = []
    for task in snapshot.tasks if snapshot else []:
        for intr in getattr(task, "interrupts", []) or []:
            pending.append(intr.value)
    return {
        "messages": to_ui_messages(messages),
        "pending_approval": pending[0] if pending else None,
        "run": last_run(messages),
    }


def _text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text")
    return ""


def to_ui_messages(messages: list[AnyMessage]) -> list[dict[str, Any]]:
    out = []
    for i, m in enumerate(messages):
        ts = (m.additional_kwargs or {}).get("ts")
        if isinstance(m, HumanMessage):
            out.append({"id": m.id or f"m{i}", "type": "user", "content": _text(m.content), "timestamp": ts})
        elif isinstance(m, AIMessage) and not m.tool_calls and _text(m.content).strip():
            text = _text(m.content)
            out.append(
                {
                    "id": m.id or f"m{i}",
                    "type": "ai",
                    "content": text,
                    "timestamp": ts,
                    "quickActions": suggestions(text),
                }
            )
    return out


def last_run(messages: list[AnyMessage]) -> list[dict[str, Any]]:
    """Tool steps since the latest user message, for the agent run panel."""
    steps: list[dict[str, Any]] = []
    results: dict[str, ToolMessage] = {}
    start = max((i for i, m in enumerate(messages) if isinstance(m, HumanMessage)), default=-1)
    for m in messages[start + 1 :]:
        if isinstance(m, ToolMessage):
            results[m.tool_call_id] = m
    for m in messages[start + 1 :]:
        if isinstance(m, AIMessage):
            for tc in m.tool_calls:
                res = results.get(tc["id"])
                steps.append(
                    {
                        "tool": tc["name"],
                        "title": tc["name"].replace("_", " ").capitalize(),
                        "detail": ", ".join(f"{k}={v}" for k, v in list(tc["args"].items())[:2])
                        or "no arguments",
                        "status": "pending"
                        if res is None
                        else ("failed" if getattr(res, "status", "") == "error" else "done"),
                    }
                )
    return steps


def suggestions(text: str) -> list[dict[str, str]]:
    if "Total Potential Monthly Savings" in text:
        labels = [
            "Approve the top quick win",
            "Show idle VM details",
            "Forecast next week's demand",
            "Generate an executive summary",
        ]
    elif "security" in text.lower():
        labels = ["Run a security check", "Show integrations"]
    else:
        labels = ["Analyze my costs", "What changed this week?"]
    return [{"text": label, "action": label} for label in labels]


async def ensure_thread_title(org_id: uuid.UUID, thread_id: uuid.UUID, first_message: str) -> None:
    from martian.db.models import ChatThread

    async with org_session(org_id) as s:
        t = await s.get(ChatThread, thread_id)
        if t is not None:
            if t.title == "New conversation" and first_message:
                t.title = first_message[:80]
            t.updated_at = utcnow()


def encode_sse(event: dict[str, Any]) -> bytes:
    return f"event: {event['event']}\ndata: {json.dumps(event['data'], default=str)}\n\n".encode()
