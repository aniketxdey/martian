"""Chat model selection: Claude when ANTHROPIC_API_KEY is set, otherwise a deterministic
offline planner that uses the same tools (for demos, CI and air-gapped evaluation)."""

from __future__ import annotations

import json
import uuid
from collections.abc import Sequence
from typing import Any

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, ToolMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from langchain_core.tools import BaseTool

from martian.config import get_settings


def get_chat_model() -> BaseChatModel:
    s = get_settings()
    if s.anthropic_api_key:
        from langchain_anthropic import ChatAnthropic

        return ChatAnthropic(
            model=s.anthropic_model, api_key=s.anthropic_api_key, max_tokens=4096, temperature=0
        )
    return OfflinePlanner()


def _money(v: Any) -> str:
    try:
        return f"${float(v):,.0f}"
    except (TypeError, ValueError):
        return str(v)


APPROVE_WORDS = ("approve", "apply", "start cloud optimization", "run it")
STOP_WORDS = {"the", "top", "quick", "win", "finding", "findings", "for", "and", "please", "on", "my", "all"}


class OfflinePlanner(BaseChatModel):
    """Keyword-routed planner: picks one internal tool, then writes a structured answer."""

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
        if isinstance(last, ToolMessage):
            asked = next((str(m.content) for m in reversed(messages) if isinstance(m, HumanMessage)), "")
            follow_up = self._follow_up(asked, last)
            msg = follow_up or AIMessage(content=self._answer(last))
        elif isinstance(last, HumanMessage):
            msg = self._plan(str(last.content))
        else:
            msg = AIMessage(content="How can I help with your infrastructure?")
        return ChatResult(generations=[ChatGeneration(message=msg)])

    def _call(self, name: str, args: dict[str, Any] | None = None) -> AIMessage:
        if name not in self.tool_names:
            return AIMessage(content="That capability isn't available in this workspace yet.")
        return AIMessage(
            content="", tool_calls=[{"name": name, "args": args or {}, "id": f"call_{uuid.uuid4().hex[:12]}"}]
        )

    @staticmethod
    def _wants_change(text: str) -> bool:
        return any(k in text.lower() for k in APPROVE_WORDS)

    def _follow_up(self, asked: str, tool_msg: ToolMessage) -> AIMessage | None:
        """For "approve ..." requests: after listing findings, approve the best match.

        The approve_finding call is a write, so the graph's approval gate pauses it until a
        person confirms, exactly as it would with Claude planning.
        """
        if tool_msg.name != "list_findings" or not self._wants_change(asked):
            return None
        try:
            findings = json.loads(str(tool_msg.content)).get("findings", [])
        except (json.JSONDecodeError, AttributeError):
            return None
        candidates = [f for f in findings if f.get("automatable") and f.get("status") == "open"]
        if not candidates:
            return None
        words = (
            {w.strip(".,?!'\"").lower() for w in asked.split() if len(w) > 2}
            - set(APPROVE_WORDS)
            - STOP_WORDS
        )

        def score(f: dict[str, Any]) -> tuple[int, float]:
            hay = f"{f.get('title', '')} {f.get('description', '')} {f.get('scope', '')}".lower()
            return (sum(1 for w in words if w in hay), float(f.get("est_monthly_savings", 0)))

        best = max(candidates, key=score)
        return self._call("approve_finding", {"finding_id": best["id"]})

    def _plan(self, text: str) -> AIMessage:
        t = text.lower()
        if self._wants_change(t):
            return self._call("list_findings", {"status": "open"})
        if any(k in t for k in ("security", "compliance", "posture")):
            return AIMessage(
                content=(
                    "Security and compliance checks run alongside every scan.\n\n"
                    "What I check:\n"
                    "• Read-only access - agents verify credentials cannot change resources during discovery\n"
                    "• Public exposure - storage buckets and load balancers open to the internet\n"
                    "• Encryption - unencrypted volumes and databases\n"
                    "• Stale credentials - access keys unused for 90+ days\n\n"
                    "Connect an integration with security tools enabled to see results here."
                )
            )
        if any(k in t for k in ("forecast", "predict", "scale", "scaling", "spike")):
            return self._call("list_findings", {"category": "scaling"})
        if any(k in t for k in ("inventory", "resources", "what do we run", "topology")):
            return self._call("get_overview")
        return self._call("list_findings", {"status": "open"})

    def _answer(self, tool_msg: ToolMessage) -> str:
        try:
            data = json.loads(
                tool_msg.content if isinstance(tool_msg.content, str) else json.dumps(tool_msg.content)
            )
        except (json.JSONDecodeError, TypeError):
            return str(tool_msg.content)
        if isinstance(data, dict) and "approved" in data:
            if data["approved"]:
                return (
                    f"Approved \u201c{data['title']}\u201d. Martian is applying it now and will record "
                    f"realized savings (est. {_money(data['est_monthly_savings'])}/month) on the Overview."
                )
            return f"I couldn't approve that: {data.get('error', 'unknown error')}."
        if isinstance(data, dict) and "findings" in data:
            findings = data["findings"]
            if not findings:
                return (
                    "No open optimizations right now. I'll keep monitoring and flag new waste as it appears."
                )
            total = sum(float(f["est_monthly_savings"]) for f in findings)
            lines = [
                "Infrastructure cost analysis complete",
                "",
                f"Total Potential Monthly Savings: {_money(total)}",
                f"Daily Savings: {_money(total / 30)}",
                "",
                "Key optimization opportunities:",
                "",
            ]
            for f in findings[:6]:
                lines.append(f"{f['title']}: {_money(f['est_monthly_savings'])}/month")
                lines.append(f"• {f['description']}")
                lines.append(
                    f"• {f['scope']} · {f['effort'].replace('easy', 'quick win').replace('medium', 'review needed')}"
                )
            lines += [
                "",
                "ROI Analysis:",
                f"• Annual Savings: {_money(total * 12)}",
                f"• 3-Year Savings: {_money(total * 36)}",
                "• Break-even: Immediate (no upfront costs)",
            ]
            return "\n".join(lines)
        if isinstance(data, dict) and "monthly_cost" in data:
            return "\n".join(
                [
                    "Here's your infrastructure at a glance.",
                    "",
                    f"• Monthly cost - {_money(data['monthly_cost'])} across {data.get('accounts', 0)} accounts",
                    f"• Waste identified - {_money(data.get('waste_identified', 0))} in {data.get('open_findings', 0)} open findings",
                    f"• Resources - {data.get('resources', 0):,} tracked",
                    f"• Health score - {data.get('health_score', 0)}/100",
                ]
            )
        return json.dumps(data, indent=2)[:4000]
