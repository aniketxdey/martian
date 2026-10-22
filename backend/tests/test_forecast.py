import math

import httpx
import pytest
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

from martian.forecast.model import Forecast, Predictor, recommend_capacity

torch = pytest.importorskip("torch")


def daily(days=14, base=50, amp=20, trend=0.0):
    return [base + amp * math.sin((h % 24 - 8) / 24 * 2 * math.pi) + trend * h for h in range(days * 24)]


def test_lstm_tracks_daily_pattern():
    p = Predictor()
    assert p.ready, "trained weights should ship with the package"
    series = daily()
    fc = p.forecast(series)
    assert fc.method == "lstm" and len(fc.mean) == 24
    actual = daily(days=15)[-24:]
    mae = sum(abs(a - b) for a, b in zip(fc.mean, actual, strict=True)) / 24
    assert mae < 8
    assert all(lo <= m <= hi for lo, m, hi in zip(fc.p10, fc.mean, fc.p90, strict=True))


def test_short_history_falls_back_to_seasonal_naive():
    fc = Predictor().forecast([40.0] * 30)
    assert fc.method == "seasonal_naive" and len(fc.mean) == 24


def test_recommend_capacity_scales_up_and_down():
    hot = Forecast(mean=[70] * 24, p10=[60] * 24, p90=[85] * 24, method="lstm", history_hours=336)
    up = recommend_capacity(hot, current=6, minimum=2, maximum=16, target=60)
    assert up["action"] == "scale_up" and up["recommended_desired"] == 9  # ceil(0.85*6/0.6)
    cold = Forecast(mean=[12] * 24, p10=[8] * 24, p90=[15] * 24, method="lstm", history_hours=336)
    down = recommend_capacity(cold, current=10, minimum=2, maximum=20, target=60)
    assert down["action"] == "scale_down" and down["recommended_desired"] == 3
    capped = recommend_capacity(hot, current=6, minimum=2, maximum=7, target=60)
    assert capped["recommended_desired"] == 7


async def test_mcp_server_requires_token_and_serves_tools(monkeypatch):
    from asgi_lifespan import LifespanManager

    from martian.forecast import server

    monkeypatch.setenv("MARTIAN_INTERNAL_TOKEN", "t0k")
    app = server.app()
    async with LifespanManager(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://f") as anon:
            assert (await anon.post("/mcp", json={})).status_code == 401
        async with httpx.AsyncClient(
            transport=transport, base_url="http://f", headers={"Authorization": "Bearer t0k"}
        ) as http:
            async with streamable_http_client("http://f/mcp", http_client=http) as (r, w, _):
                async with ClientSession(r, w) as s:
                    await s.initialize()
                    tools = {t.name: t for t in (await s.list_tools()).tools}
                    assert tools["recommend_scaling"].annotations.readOnlyHint
                    res = await s.call_tool(
                        "recommend_scaling",
                        {
                            "series": daily(trend=0.05),
                            "current_capacity": 6,
                            "min_capacity": 2,
                            "max_capacity": 16,
                        },
                    )
                    assert res.structuredContent["action"] in {"scale_up", "hold", "scale_down"}
                    assert res.structuredContent["method"] == "lstm"
