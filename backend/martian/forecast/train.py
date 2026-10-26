"""Train the LSTM forecaster.

    python -m martian.forecast.train                     # synthetic traces only
    python -m martian.forecast.train --csv traces.csv    # plus real traces (one series per column, hourly)

Synthetic traces cover the patterns we see in pilot environments: daily and weekly
seasonality, growth, batch spikes, regime shifts and noise. Reports MAE against
a seasonal-naive baseline (same hour yesterday) on held-out traces, and a capacity
simulation comparing reactive and forecast-driven scaling.
"""

from __future__ import annotations

import argparse
import csv
import math
import time

import numpy as np
import torch
from torch import nn

from martian.forecast.model import HORIZON, WEIGHTS, WINDOW, LSTMForecaster, features


def synthetic_trace(rng: np.random.Generator, hours: int) -> np.ndarray:
    t = np.arange(hours)
    base = rng.uniform(8, 55)
    daily = rng.uniform(3, 25) * np.sin(2 * np.pi * ((t % 24) - rng.uniform(6, 11)) / 24)
    weekly = np.where((t // 24) % 7 < 5, 1.0, rng.uniform(0.5, 0.95))
    trend = rng.uniform(-0.01, 0.05) * t
    noise = rng.normal(0, rng.uniform(0.5, 4), hours)
    s = (base + daily) * weekly + trend + noise
    if rng.random() < 0.4:  # nightly batch spikes
        hour = rng.integers(0, 24)
        s += np.where(t % 24 == hour, rng.uniform(10, 35), 0)
    if rng.random() < 0.25:  # regime shift (new release, migration)
        at = rng.integers(hours // 3, hours)
        s[at:] += rng.uniform(-15, 20)
    return np.clip(s, 0, 100).astype(np.float32)


def windows(trace: np.ndarray, stride: int = 6):
    xs, ys = [], []
    feats = features(trace)
    for i in range(0, len(trace) - WINDOW - HORIZON, stride):
        xs.append(feats[i : i + WINDOW])
        ys.append(trace[i + WINDOW : i + WINDOW + HORIZON] / 100.0)
    return xs, ys


def load_csv(path: str) -> list[np.ndarray]:
    with open(path) as f:
        rows = list(csv.reader(f))
    cols = list(zip(*rows[1:], strict=False))
    return [np.asarray([float(v) for v in c if v != ""], dtype=np.float32) for c in cols]


def seasonal_naive_mae(traces: list[np.ndarray]) -> float:
    errs = []
    for tr in traces:
        for i in range(WINDOW, len(tr) - HORIZON, 24):
            errs.append(np.abs(tr[i - 24 : i] - tr[i : i + HORIZON]).mean())
    return float(np.mean(errs))


def model_mae(model: nn.Module, traces: list[np.ndarray]) -> float:
    model.eval()
    errs = []
    with torch.no_grad():
        for tr in traces:
            xs, ys = windows(tr, stride=24)
            if not xs:
                continue
            pred = model(torch.from_numpy(np.stack(xs))).numpy() * 100
            errs.append(np.abs(pred - np.stack(ys) * 100).mean())
    return float(np.mean(errs))


def simulate_utilization(
    model: nn.Module, traces: list[np.ndarray], target: float = 60.0
) -> dict[str, float]:
    """Average utilization with reactive scaling (size for last day's peak) vs forecast scaling."""
    reactive, predictive = [], []
    model.eval()
    with torch.no_grad():
        for tr in traces:
            load = tr * 10 / 100.0  # demand in "instances at 100%" for a 10-instance baseline
            for i in range(WINDOW, len(tr) - HORIZON, 24):
                nxt = load[i : i + HORIZON]
                cap_r = max(1, math.ceil(load[i - 24 : i].max() * 1.25 / (target / 100)))
                x = torch.from_numpy(features(tr[i - WINDOW : i])).unsqueeze(0)
                pred = model(x)[0].numpy() * 10
                cap_p = max(1, math.ceil(pred.max() * 1.1 / (target / 100)))
                reactive.append(min(1.0, nxt.mean() / cap_r))
                predictive.append(min(1.0, nxt.mean() / cap_p))
    r, p = float(np.mean(reactive)) * 100, float(np.mean(predictive)) * 100
    return {
        "reactive_avg_utilization": round(r, 1),
        "predictive_avg_utilization": round(p, 1),
        "relative_gain_pct": round((p - r) / r * 100, 1),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv")
    ap.add_argument("--traces", type=int, default=600)
    ap.add_argument("--epochs", type=int, default=12)
    ap.add_argument("--seed", type=int, default=7)
    a = ap.parse_args()

    torch.manual_seed(a.seed)
    rng = np.random.default_rng(a.seed)
    traces = [synthetic_trace(rng, 24 * 35) for _ in range(a.traces)]
    if a.csv:
        traces += load_csv(a.csv)
    rng.shuffle(traces)
    split = int(len(traces) * 0.85)
    train, test = traces[:split], traces[split:]
    xs, ys = [], []
    for tr in train:
        x, y = windows(tr)
        xs += x
        ys += y
    X, Y = torch.from_numpy(np.stack(xs)), torch.from_numpy(np.stack(ys))
    print(f"training windows: {len(X):,}  test traces: {len(test)}")

    model = LSTMForecaster()
    opt = torch.optim.AdamW(model.parameters(), lr=2e-3, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=a.epochs)
    loss_fn = nn.HuberLoss(delta=0.05)
    best, best_state = math.inf, None
    for epoch in range(a.epochs):
        model.train()
        perm = torch.randperm(len(X))
        start, total = time.time(), 0.0
        for i in range(0, len(X), 256):
            idx = perm[i : i + 256]
            opt.zero_grad()
            loss = loss_fn(model(X[idx]), Y[idx])
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
            total += loss.item() * len(idx)
        sched.step()
        mae = model_mae(model, test)
        print(
            f"epoch {epoch + 1:2d}  loss {total / len(X):.5f}  test MAE {mae:.2f} pts  ({time.time() - start:.0f}s)"
        )
        if mae < best:
            best, best_state = mae, {k: v.clone() for k, v in model.state_dict().items()}

    assert best_state is not None
    model.load_state_dict(best_state)
    baseline = seasonal_naive_mae(test)
    sim = simulate_utilization(model, test)
    meta = {
        "window": WINDOW,
        "horizon": HORIZON,
        "test_mae": round(best, 2),
        "seasonal_naive_mae": round(baseline, 2),
        "improvement_vs_naive_pct": round((baseline - best) / baseline * 100, 1),
        "simulation": sim,
        "trained_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "traces": len(traces),
    }
    WEIGHTS.parent.mkdir(parents=True, exist_ok=True)
    torch.save({"state_dict": best_state, "meta": meta}, WEIGHTS)
    print("saved", WEIGHTS, meta)


if __name__ == "__main__":
    main()
