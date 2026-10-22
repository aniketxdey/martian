"""Forecast service: the LSTM model exposed to agents as MCP tools over Streamable HTTP.

martian-forecast        # listens on :8790, path /mcp, requires the internal token
"""

from __future__ import annotations

import os
from typing import Annotated, Any

from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings
from mcp.types import ToolAnnotations
from pydantic import Field
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from martian.forecast.model import HORIZON, Predictor, recommend_capacity

mcp = FastMCP(
    "martian-forecast",
    instructions="LSTM workload forecasts and predictive scaling recommendations.",
    stateless_http=True,
    json_response=True,
    # Internal service behind the load balancer and the internal token (InternalAuth below);
    # DNS-rebinding checks target browser-reachable local servers and would reject service hostnames.
    transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False),
)
_predictor: Predictor | None = None
READ_ONLY = ToolAnnotations(readOnlyHint=True, openWorldHint=False)


def predictor() -> Predictor:
    global _predictor
    if _predictor is None:
        _predictor = Predictor()
    return _predictor


Series = Annotated[
    list[float], Field(description="Hourly CPU utilization (0-100), oldest first; 7+ days is best")
]


@mcp.tool(annotations=READ_ONLY, meta={"martian/write": False}, structured_output=True)
def forecast_utilization(series: Series, horizon_hours: int = HORIZON) -> dict[str, Any]:
    """Forecast hourly CPU utilization with an LSTM model. Returns mean and p10/p90 bands."""
    fc = predictor().forecast(series, max(1, min(horizon_hours, 168)))
    return {**fc.as_dict(), "peak": max(fc.mean) if fc.mean else 0, "model": predictor().meta}


@mcp.tool(annotations=READ_ONLY, meta={"martian/write": False}, structured_output=True)
def recommend_scaling(
    series: Series,
    current_capacity: int,
    min_capacity: int = 1,
    max_capacity: int = 100,
    target_utilization: float = 60.0,
    horizon_hours: int = HORIZON,
) -> dict[str, Any]:
    """Recommend instance count for the next horizon so forecast peak demand stays at the target utilization."""
    fc = predictor().forecast(series, max(1, min(horizon_hours, 168)))
    return recommend_capacity(fc, current_capacity, min_capacity, max_capacity, target_utilization)


class InternalAuth(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        token = os.environ.get("MARTIAN_INTERNAL_TOKEN", "dev-internal-token-change-me")
        if request.url.path != "/healthz" and request.headers.get("authorization") != f"Bearer {token}":
            return JSONResponse({"detail": "unauthorized"}, status_code=401)
        return await call_next(request)


def app():
    application = mcp.streamable_http_app()
    application.add_middleware(InternalAuth)

    async def healthz(_: Request):
        return JSONResponse({"ok": True, "model": predictor().meta})

    application.add_route("/healthz", healthz)
    return application


def run() -> None:
    import uvicorn

    uvicorn.run(app(), host="0.0.0.0", port=int(os.environ.get("PORT", "8790")))
