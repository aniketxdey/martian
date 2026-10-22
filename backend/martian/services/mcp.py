"""Calling MCP tools on integrations (through the gateway) and on the forecast service.

The scan pipeline and the executor call tools directly with `ToolBackend`. The chat
agent loads the same tools as LangChain tools via langchain-mcp-adapters.
"""

from __future__ import annotations

import json
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import timedelta
from typing import Any, Protocol

import httpx
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

from martian.config import get_settings


class ToolError(RuntimeError):
    pass


class ToolBackend(Protocol):
    async def call_tool(self, integration_id: str, tool: str, args: dict[str, Any]) -> Any: ...

    async def list_tools(self, integration_id: str) -> list[dict[str, Any]]: ...

    async def forecast(self, tool: str, args: dict[str, Any]) -> Any: ...


def integration_url(integration_id: str | uuid.UUID) -> str:
    return f"{get_settings().gateway_url.rstrip('/')}/mcp/{integration_id}"


def gateway_headers(org_id: str | uuid.UUID | None = None) -> dict[str, str]:
    headers = {"Authorization": f"Bearer {get_settings().internal_token}"}
    if org_id:
        headers["X-Martian-Org"] = str(org_id)
    return headers


def _parse_result(result: Any) -> Any:
    if result.isError:
        text = " ".join(getattr(c, "text", "") for c in result.content).strip()
        raise ToolError(text or "tool returned an error")
    if result.structuredContent is not None:
        sc = result.structuredContent
        # Servers that only return text get wrapped as {"result": ...} by some SDKs.
        return sc.get("result", sc) if isinstance(sc, dict) and set(sc) == {"result"} else sc
    texts = [getattr(c, "text", "") for c in result.content]
    joined = "\n".join(t for t in texts if t)
    try:
        return json.loads(joined)
    except (json.JSONDecodeError, TypeError):
        return joined


@asynccontextmanager
async def _session(url: str, headers: dict[str, str], timeout: float = 120) -> AsyncIterator[ClientSession]:
    async with httpx.AsyncClient(headers=headers, timeout=httpx.Timeout(timeout, read=timeout)) as http:
        async with streamable_http_client(url, http_client=http) as (read, write, _):
            async with ClientSession(read, write) as session:
                await session.initialize()
                yield session


class MCPBackend:
    """Talks to real MCP servers over Streamable HTTP."""

    def __init__(self, org_id: str | uuid.UUID | None = None, timeout: float = 120):
        self.org_id = org_id
        self.timeout = timeout

    async def call_tool(self, integration_id: str, tool: str, args: dict[str, Any]) -> Any:
        async with _session(integration_url(integration_id), gateway_headers(self.org_id), self.timeout) as s:
            result = await s.call_tool(tool, args, read_timeout_seconds=timedelta(seconds=self.timeout))
            return _parse_result(result)

    async def list_tools(self, integration_id: str) -> list[dict[str, Any]]:
        async with _session(integration_url(integration_id), gateway_headers(self.org_id), self.timeout) as s:
            listed = await s.list_tools()
            return [describe_tool(t) for t in listed.tools]

    async def forecast(self, tool: str, args: dict[str, Any]) -> Any:
        s = get_settings()
        async with _session(
            s.forecast_url, {"Authorization": f"Bearer {s.internal_token}"}, self.timeout
        ) as sess:
            return _parse_result(await sess.call_tool(tool, args))


def describe_tool(t: Any) -> dict[str, Any]:
    ann = getattr(t, "annotations", None)
    read_only = bool(getattr(ann, "readOnlyHint", False)) if ann else False
    meta = getattr(t, "meta", None) or {}
    write = bool(meta.get("martian/write", not read_only))
    return {"name": t.name, "description": (t.description or "").strip(), "write": write}
