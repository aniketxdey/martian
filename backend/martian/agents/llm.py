"""Chat model selection: Claude when ANTHROPIC_API_KEY is set, otherwise a deterministic
offline planner that uses the same tools (for demos, CI and air-gapped evaluation).

The offline planner routes on keywords, calls one tool (or a short chain), and writes the
answer in the same style the writing-style skill asks of Claude.
"""

from __future__ import annotations

import json
import re
import uuid
from collections.abc import Sequence
from typing import Any

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from langchain_core.tools import BaseTool

from martian.config import get_settings


def get_chat_model() -> BaseChatModel:
    s = get_settings()
    if s.anthropic_api_key:
        from langchain_anthropic import ChatAnthropic

        return ChatAnthropic(model=s.anthropic_model, api_key=s.anthropic_api_key, max_tokens=4096)
    return OfflinePlanner()


def _money(v: Any) -> str:
    try:
        return f"${float(v):,.0f}"
    except (TypeError, ValueError):
        return str(v)


def _pct(v: Any) -> str:
    try:
        return f"{float(v):.0f}%"
    except (TypeError, ValueError):
        return "n/a"


APPROVE_WORDS = ("approve", "apply", "go ahead", "run it", "do it")
START_WORDS = (
    "start a",
    "start the",
    "kick off",
    "launch",
    "run a",
    "run another",
    "scan",
    "sweep",
    "workflow",
)
STOP_WORDS = {
    "the",
    "top",
    "quick",
    "win",
    "finding",
    "findings",
    "for",
    "and",
    "please",
    "on",
    "my",
    "all",
    "biggest",
}
SESSION_RE = re.compile(r"session_id: ([\w.:-]+)")


def _load(msg: ToolMessage) -> Any:
    try:
        return json.loads(msg.content if isinstance(msg.content, str) else json.dumps(msg.content))
    except (json.JSONDecodeError, TypeError):
        return None


class OfflinePlanner(BaseChatModel):
    """Keyword-routed planner: picks a tool (or a short chain of them), then writes the answer."""

    tool_names: list[str] = []

    @property
    def _llm_type(self) -> str:
        return "martian-offline"

    def bind_tools(self, tools: Sequence[BaseTool | Any], **kwargs: Any) -> OfflinePlanner:  # type: ignore[override]
        names = [getattr(t, "name", None) or t.get("name") for t in tools]
        return OfflinePlanner(tool_names=[n for n in names if n])

    def _generate(
        self, messages: list[BaseMessage], stop: Any = None, run_manager: Any = None, **kw: Any
    ) -> ChatResult:
        last = messages[-1]
        session = self._session(messages)
        if isinstance(last, ToolMessage):
            asked = next((str(m.content) for m in reversed(messages) if isinstance(m, HumanMessage)), "")
            msg = self._follow_up(asked, last, messages) or AIMessage(content=self._answer(last))
        elif isinstance(last, HumanMessage):
            msg = self._plan(str(last.content), session)
        else:
            msg = AIMessage(content="What would you like to know about your infrastructure?")
        return ChatResult(generations=[ChatGeneration(message=msg)])

    @staticmethod
    def _session(messages: list[BaseMessage]) -> str | None:
        system = next((str(m.content) for m in messages if isinstance(m, SystemMessage)), "")
        m = SESSION_RE.search(system)
        return m.group(1).rstrip(").") if m else None

    def _has(self, name: str) -> bool:
        return name in self.tool_names

    def _call(self, name: str, args: dict[str, Any] | None = None) -> AIMessage:
        if not self._has(name):
            return AIMessage(content="That isn't available in this workspace yet.")
        return AIMessage(
            content="", tool_calls=[{"name": name, "args": args or {}, "id": f"call_{uuid.uuid4().hex[:12]}"}]
        )

    @staticmethod
    def _wants_change(text: str) -> bool:
        # "Approve X" is a request; "what can I approve?" is a question and gets a list.
        t = text.lower().strip()
        question = t.endswith("?") or t.split(" ", 1)[0] in {
            "what",
            "which",
            "how",
            "can",
            "could",
            "should",
            "show",
        }
        return not question and any(k in t for k in APPROVE_WORDS)

    # ------------------------------------------------------------------ planning

    def _plan(self, text: str, session: str | None) -> AIMessage:
        t = text.lower()
        if self._wants_change(t):
            return self._call("list_findings", {"status": "open"})
        if any(k in t for k in START_WORDS) and self._has("start_workflow"):
            goal = re.sub(
                r"^(please\s+)?(start|kick off|launch|run)\s+(a|an|the|another)?\s*(workflow:?)?\s*",
                "",
                text,
                flags=re.I,
            )
            return self._call("start_workflow", {"goal": goal.strip() or text.strip()})
        if session and self._has("get_agent_session"):
            return self._call("get_agent_session", {"session_id": session})
        if any(k in t for k in ("security", "compliance", "posture")):
            return AIMessage(
                content=(
                    "Martian checks access on every scan before it reads anything. Each integration's credential "
                    "has to prove it's read-only, and write tools stay off unless an integration allows them.\n\n"
                    "For posture checks (public buckets, unencrypted volumes, stale keys), connect a security "
                    "integration and turn its tools on; results then show up here."
                )
            )
        if any(k in t for k in ("forecast", "predict", "peak", "tomorrow", "next week", "spike")):
            if self._has("search_inventory") and self._has("get_resource_telemetry"):
                return self._call("search_inventory", {"sort": "cpu", "limit": 3})
            return self._call("list_findings", {"category": "scaling"})
        if any(k in t for k in ("integration", "connected", "access")) and self._has("list_integrations"):
            return self._call("list_integrations")
        if any(k in t for k in ("agent", "run", "session", "history", "happened")) and self._has(
            "list_agent_sessions"
        ):
            return self._call("list_agent_sessions", {"limit": 8})
        if any(k in t for k in ("topology", "what do we run", "inventory", "map", "depend")):
            if self._has("describe_topology"):
                return self._call("describe_topology")
            return self._call("get_overview")
        if any(k in t for k in ("overview", "spend", "health", "summary", "status")):
            return self._call("get_overview")
        return self._call("list_findings", {"status": "open"})

    def _follow_up(self, asked: str, tool_msg: ToolMessage, messages: list[BaseMessage]) -> AIMessage | None:
        """Short chains: approve the best match after listing findings, and fetch telemetry
        (then a forecast) after finding the busiest services."""
        data = _load(tool_msg)
        if tool_msg.name == "list_findings" and self._wants_change(asked) and isinstance(data, dict):
            candidates = [
                f for f in data.get("findings", []) if f.get("automatable") and f.get("status") == "open"
            ]
            if not candidates:
                return None
            if "quick win" in asked.lower():
                candidates = [f for f in candidates if f.get("effort") == "easy"] or candidates
            words = (
                {w.strip(".,?!'\"").lower() for w in asked.split() if len(w) > 2}
                - set(APPROVE_WORDS)
                - STOP_WORDS
            )

            def score(f: dict[str, Any]) -> tuple[int, float]:
                hay = f"{f.get('title', '')} {f.get('description', '')} {f.get('scope', '')}".lower()
                return (sum(1 for w in words if w in hay), float(f.get("est_monthly_savings", 0)))

            # The approve call is a write, so the approval gate pauses it until a person confirms.
            return self._call("approve_finding", {"finding_id": max(candidates, key=score)["id"]})
        if (
            tool_msg.name == "search_inventory"
            and isinstance(data, dict)
            and self._has("get_resource_telemetry")
        ):
            top = next((r for r in data.get("resources", []) if r.get("cpu") is not None), None)
            if top:
                return self._call("get_resource_telemetry", {"node_id": top["node_id"]})
        if tool_msg.name == "get_resource_telemetry" and isinstance(data, dict) and data.get("cpu_24h"):
            if self._has("forecast_utilization") and not any(
                isinstance(m, ToolMessage) and m.name == "forecast_utilization" for m in messages
            ):
                return self._call("forecast_utilization", {"series": data["cpu_24h"], "horizon_hours": 24})
        return None

    # ------------------------------------------------------------------ answers

    def _answer(self, tool_msg: ToolMessage) -> str:
        data = _load(tool_msg)
        if data is None:
            return str(tool_msg.content)[:2000]
        if isinstance(data, dict) and data.get("error"):
            return f"I couldn't get that: {data['error']}"
        name = tool_msg.name or ""
        if isinstance(data, dict) and "approved" in data:
            if data["approved"]:
                return (
                    f"Approved “{data.get('title', 'the finding')}”. Martian is applying it now, and the "
                    f"saving (about {_money(data.get('est_monthly_savings', 0))}/mo) moves to realized savings on "
                    "the Overview once it's done."
                )
            return f"I couldn't approve that: {data.get('error', 'unknown error')}."
        if isinstance(data, dict) and "started" in data:
            if data["started"]:
                return (
                    f"Started a workflow to {data['goal'].rstrip('.')}. Agents are on it now; follow each step "
                    "on the Agents page. Anything that would change infrastructure will wait for you."
                )
            return f"I couldn't start that: {data.get('error', 'unknown error')}."
        if isinstance(data, dict) and "findings" in data:
            return self._findings(data["findings"])
        if isinstance(data, dict) and "monthly_cost" in data:
            return self._overview(data)
        if isinstance(data, dict) and "clusters" in data:
            return self._topology(data["clusters"])
        if isinstance(data, dict) and "integrations" in data:
            return self._integrations(data["integrations"])
        if isinstance(data, dict) and "sessions" in data:
            return self._sessions(data["sessions"])
        if isinstance(data, dict) and "agents" in data and "goal" in data:
            return self._session_detail(data)
        if name == "forecast_utilization" or (isinstance(data, dict) and "peak" in data and "mean" in data):
            return self._forecast(data)
        if isinstance(data, dict) and "cpu_24h" in data:
            return self._telemetry(data)
        if isinstance(data, dict) and "resources" in data:
            return self._resources(data["resources"])
        return "```json\n" + json.dumps(data, indent=2)[:3000] + "\n```"

    @staticmethod
    def _findings(findings: list[dict[str, Any]]) -> str:
        if not findings:
            return "Nothing open right now. Martian keeps watching and will flag new waste when it shows up."
        total = sum(float(f.get("est_monthly_savings") or 0) for f in findings)
        quick = [f for f in findings if f.get("effort") == "easy"]
        rows = [
            f"| {f['title']} | {f.get('scope', '')} | {_money(f.get('est_monthly_savings'))} | "
            f"{'Quick win' if f.get('effort') == 'easy' else 'Needs planning'} |"
            for f in findings[:5]
        ]
        lead = f"You could save **{_money(total)}/mo** across {len(findings)} open findings" + (
            f", and {len(quick)} of them are quick wins." if quick else "."
        )
        return "\n".join(
            [
                lead,
                "",
                "| Finding | Where | Saves per month | Effort |",
                "|---|---|--:|---|",
                *rows,
                "",
                f"That's {_money(total * 12)} a year. Say which one to approve and I'll show you the change "
                "before anything runs.",
            ]
        )

    @staticmethod
    def _overview(d: dict[str, Any]) -> str:
        org = (d.get("org") or {}).get("name")
        return (
            f"{org + ' spends' if org else 'You spend'} **{_money(d['monthly_cost'])}/mo** across "
            f"{d.get('accounts', 0)} cloud accounts and {d.get('resources', 0):,} tracked resources. "
            f"Open findings add up to **{_money(d.get('waste_identified', 0))}/mo**"
            + (
                f", and approved changes already save {_money(d.get('realized_savings') or d.get('realized_monthly_savings'))}/mo."
                if (d.get("realized_savings") or d.get("realized_monthly_savings"))
                else "."
            )
            + f"\n\nThe health score is {d.get('health_score', 0)} out of 100; it drops as waste grows relative to "
            "spend and when integrations need attention."
        )

    @staticmethod
    def _topology(clusters: list[dict[str, Any]]) -> str:
        if not clusters:
            return "No clusters in that environment."
        rows = [
            f"| {c['name']} | {c.get('location', '')} | {len(c.get('services', []))} | {_money(c.get('monthly_cost', 0))} |"
            for c in sorted(clusters, key=lambda c: -float(c.get("monthly_cost") or 0))[:8]
        ]
        busiest = max(
            (s for c in clusters for s in c.get("services", []) if s.get("cpu") is not None),
            key=lambda s: s["cpu"],
            default=None,
        )
        tail = (
            f"\n\nThe busiest service is {busiest['name']} at {_pct(busiest['cpu'])} CPU. "
            "Open the Infrastructure map to see how everything depends on it."
            if busiest
            else ""
        )
        return (
            f"You run {len(clusters)} clusters, listed by monthly cost:\n\n"
            "| Cluster | Location | Services | Monthly |\n|---|---|--:|--:|\n" + "\n".join(rows) + tail
        )

    @staticmethod
    def _integrations(items: list[dict[str, Any]]) -> str:
        if not items:
            return (
                "No integrations are connected yet. Add one on the Integrations page; each starts read-only."
            )
        bad = [i for i in items if i.get("status") != "connected"]
        rows = [
            f"| {i.get('name')} | {i.get('status')} | {i.get('mode')} | {len(i.get('write_tools', []))} |"
            for i in items
        ]
        lead = f"{len(items) - len(bad)} of {len(items)} integrations are connected" + (
            f"; {', '.join(i.get('name', '') for i in bad)} need{'s' if len(bad) == 1 else ''} attention."
            if bad
            else "."
        )
        return (
            lead
            + "\n\n| Integration | Status | Mode | Write tools on |\n|---|---|---|--:|\n"
            + "\n".join(rows)
        )

    @staticmethod
    def _sessions(sessions: list[dict[str, Any]]) -> str:
        if not sessions:
            return "No agent runs yet."
        running = [s for s in sessions if s.get("status") in ("running", "waiting")]
        lines = [
            f"- **{s.get('title')}** ({s.get('status')}): {s.get('summary') or s.get('goal', '')}"
            for s in sessions[:6]
        ]
        lead = (
            f"{len(running)} run{'s are' if len(running) != 1 else ' is'} in progress. " if running else ""
        ) + "The latest agent runs:"
        return (
            lead + "\n\n" + "\n".join(lines) + "\n\nOpen any of them on the Agents page for the full trace."
        )

    @staticmethod
    def _session_detail(s: dict[str, Any]) -> str:
        agents = s.get("agents", [])
        calls = sum(1 for a in agents for x in a.get("steps", []) if x.get("tool"))
        failed = [x for a in agents for x in a.get("steps", []) if x.get("status") == "failed"]
        lines = [
            f"- **{a.get('name')}**: "
            + (
                next(
                    (x.get("text") for x in reversed(a.get("steps", [])) if x.get("text")), a.get("role", "")
                )
            )
            for a in agents[:6]
        ]
        state = {
            "running": "is still running",
            "waiting": "is waiting for an approval",
            "failed": "failed",
        }.get(s.get("status", ""), "finished")
        head = f"“{s.get('title')}” {state}. {len(agents)} agents made {calls} tool calls" + (
            f", and {len(failed)} of them failed." if failed else "."
        )
        tail = f"\n\n{s['summary']}" if s.get("summary") else ""
        return head + "\n\n" + "\n".join(lines) + tail

    @staticmethod
    def _forecast(d: dict[str, Any]) -> str:
        mean = d.get("mean") or []
        p90 = d.get("p90") or []
        peak = d.get("peak") or (max(mean) if mean else 0)
        hi = max(p90) if p90 else peak
        call = (
            "capacity can come down"
            if hi < 40
            else ("scale up before the peak" if hi > 80 else "current capacity fits")
        )
        return (
            f"The LSTM forecast puts the next 24-hour peak at **{_pct(peak)}** CPU, and {_pct(hi)} at p90 "
            f"(the level it should only pass one day in ten). So {call}."
        )

    @staticmethod
    def _telemetry(d: dict[str, Any]) -> str:
        cpu = d.get("cpu_24h") or []
        if not cpu:
            return "No CPU data for that one."
        return (
            f"{d.get('name', 'That service')} peaked at **{_pct(max(cpu))}** CPU in the last 24 hours and sits at "
            f"{_pct(cpu[-1])} now (average {_pct(sum(cpu) / len(cpu))}). The forecast service isn't reachable, "
            "so that's history, not a prediction."
        )

    @staticmethod
    def _resources(rows: list[dict[str, Any]]) -> str:
        if not rows:
            return "Nothing matches that search."
        lines = [
            f"| {r.get('name')} | {r.get('cluster') or r.get('region', '')} | {r.get('count', 1)} | "
            f"{_pct(r.get('cpu')) if r.get('cpu') is not None else 'n/a'} | {_money(r.get('monthly_cost', 0))} |"
            for r in rows[:8]
        ]
        return (
            f"Found {len(rows)} matches.\n\n| Name | Where | Count | CPU | Monthly |\n|---|---|--:|--:|--:|\n"
            + "\n".join(lines)
        )
