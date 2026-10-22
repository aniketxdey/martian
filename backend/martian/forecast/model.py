"""LSTM workload forecaster.

Input: the last WINDOW hours of CPU utilization (0-100) plus calendar features.
Output: the next HORIZON hours, predicted directly (multi-horizon head).
Uncertainty: Monte Carlo dropout gives p10/p90 bands, so scaling decisions can
plan for the high end of demand instead of the mean.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import torch
from torch import nn

WINDOW = 168  # 7 days of hourly data
HORIZON = 24
FEATURES = 5
WEIGHTS = Path(__file__).parent / "weights" / "lstm.pt"


class LSTMForecaster(nn.Module):
    def __init__(self, hidden: int = 64, layers: int = 2, dropout: float = 0.15, horizon: int = HORIZON):
        super().__init__()
        self.lstm = nn.LSTM(FEATURES, hidden, num_layers=layers, batch_first=True, dropout=dropout)
        self.drop = nn.Dropout(dropout)
        self.head = nn.Sequential(nn.Linear(hidden + 1, hidden), nn.GELU(), nn.Linear(hidden, horizon))

    def forward(self, x: torch.Tensor) -> torch.Tensor:  # x: (B, WINDOW, FEATURES)
        out, _ = self.lstm(x)
        last = self.drop(out[:, -1])
        level = x[:, -24:, 0].mean(dim=1, keepdim=True)  # recent level as a skip connection
        return level + self.head(torch.cat([last, level], dim=1))


def features(util: np.ndarray, start_hour: int = 0) -> np.ndarray:
    """util: (T,) in 0-100. Returns (T, FEATURES) with calendar encodings."""
    t = np.arange(len(util)) + start_hour
    hour = 2 * math.pi * (t % 24) / 24
    dow = 2 * math.pi * ((t // 24) % 7) / 7
    return np.stack([util / 100.0, np.sin(hour), np.cos(hour), np.sin(dow), np.cos(dow)], axis=1).astype(
        np.float32
    )


def prepare(series: list[float]) -> np.ndarray:
    """Pads short history by repeating the most recent day, then keeps the last WINDOW hours."""
    s = np.clip(np.asarray(series, dtype=np.float32), 0, 100)
    if len(s) < WINDOW:
        day = s[-24:] if len(s) >= 24 else np.full(24, s.mean() if len(s) else 0, dtype=np.float32)
        reps = math.ceil((WINDOW - len(s)) / 24)
        s = np.concatenate([np.tile(day, reps)[-(WINDOW - len(s)) :], s])
    return s[-WINDOW:]


@dataclass
class Forecast:
    mean: list[float]
    p10: list[float]
    p90: list[float]
    method: str
    history_hours: int

    def as_dict(self) -> dict[str, Any]:
        return {
            "mean": self.mean,
            "p10": self.p10,
            "p90": self.p90,
            "method": self.method,
            "history_hours": self.history_hours,
            "horizon_hours": len(self.mean),
        }


class Predictor:
    def __init__(self, weights: Path = WEIGHTS):
        self.model = LSTMForecaster()
        self.meta: dict[str, Any] = {}
        if weights.exists():
            ckpt = torch.load(weights, map_location="cpu", weights_only=False)
            self.model.load_state_dict(ckpt["state_dict"])
            self.meta = ckpt.get("meta", {})
        self.ready = weights.exists()
        self.model.eval()

    @torch.no_grad()
    def forecast(self, series: list[float], horizon: int = HORIZON, samples: int = 30) -> Forecast:
        n = len(series)
        if n < 48 or not self.ready:
            # Not enough history (or no trained model): seasonal naive (same hour yesterday).
            base = np.asarray(
                series[-24:] if n >= 24 else [np.mean(series) if n else 0.0] * 24, dtype=np.float32
            )
            mean = np.resize(base, horizon)
            spread = float(np.std(series)) if n > 1 else 5.0
            return Forecast(
                _r(mean),
                _r(np.clip(mean - spread, 0, 100)),
                _r(np.clip(mean + spread, 0, 100)),
                "seasonal_naive",
                n,
            )
        x = torch.from_numpy(features(prepare(series))).unsqueeze(0)
        self.model.train()  # enable dropout for Monte Carlo sampling
        draws = torch.stack([self.model(x)[0] for _ in range(samples)]).numpy() * 100
        self.model.eval()
        draws = np.clip(draws, 0, 100)
        reps = math.ceil(horizon / HORIZON)
        mean = np.tile(draws.mean(0), reps)[:horizon]
        p10 = np.tile(np.percentile(draws, 10, axis=0), reps)[:horizon]
        p90 = np.tile(np.percentile(draws, 90, axis=0), reps)[:horizon]
        return Forecast(_r(mean), _r(p10), _r(p90), "lstm", n)


def _r(a: np.ndarray) -> list[float]:
    return [round(float(v), 1) for v in a]


def recommend_capacity(
    fc: Forecast, current: int, minimum: int, maximum: int, target: float = 60.0
) -> dict[str, Any]:
    """Capacity that keeps the forecast's high band (p90) at or under the target utilization.

    Load is assumed proportional to utilization × capacity (horizontal scaling)."""
    current = max(1, current)
    peak = max(fc.p90) if fc.p90 else 0.0
    peak_load = peak * current / 100.0
    needed = math.ceil(peak_load / (target / 100.0)) if peak_load > 0 else minimum
    rec = max(minimum, min(maximum, needed))
    after = min(100.0, peak * current / max(1, rec))
    avg_after = (sum(fc.mean) / len(fc.mean)) * current / max(1, rec) if fc.mean else 0
    return {
        "recommended_desired": rec,
        "current_desired": current,
        "peak_utilization": round(peak, 1),
        "predicted_peak_after": round(after, 1),
        "predicted_avg_after": round(avg_after, 1),
        "target_utilization": target,
        "horizon_hours": len(fc.mean),
        "method": fc.method,
        "action": "scale_up" if rec > current else "scale_down" if rec < current else "hold",
    }
