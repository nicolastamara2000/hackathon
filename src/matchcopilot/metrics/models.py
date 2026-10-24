"""xG and pass difficulty models.

Both are small logistic regressions trained on synthetic matches only
(`python -m matchcopilot.metrics.models` refits them). Coefficients live in
data/models.json so the live path has no training step and no heavy deps.
"""

from __future__ import annotations

import json
import math
from importlib import resources
from pathlib import Path

import numpy as np

from ..generator.engine import generate_match, goal_geometry

XG_FEATURES = ["bias", "distance_m", "angle_rad", "header", "under_pressure"]
PASS_FEATURES = ["bias", "length_m", "under_pressure", "end_in_box", "end_final_third", "forward_m", "backward"]


def xg_features(e: dict) -> list[float]:
    x, y = e["location"]
    dist, angle = goal_geometry(x, y)
    return [1.0, dist, angle, float(e.get("body_part") == "Head"), float(e.get("under_pressure", False))]


def pass_features(e: dict) -> list[float]:
    (x, y), (ex, ey) = e["location"], e["end_location"]
    fwd = (ex - x) * 105 / 120
    return [1.0, e["pass_length_m"], float(e.get("under_pressure", False)),
            float(ex > 102 and 18 < ey < 62), float(ex > 80), max(fwd, 0.0), float(fwd < -5)]


def _fit_logistic(X: np.ndarray, y: np.ndarray, l2: float = 1e-3, iters: int = 50) -> np.ndarray:
    """Newton-Raphson logistic regression with light L2, standardising non-bias columns."""
    mu, sd = X.mean(0), X.std(0)
    mu[0], sd[0] = 0.0, 1.0
    sd[sd == 0] = 1.0
    Z = (X - mu) / sd
    w = np.zeros(X.shape[1])
    for _ in range(iters):
        p = 1 / (1 + np.exp(-Z @ w))
        g = Z.T @ (p - y) + l2 * w
        H = (Z * (p * (1 - p))[:, None]).T @ Z + l2 * np.eye(len(w))
        step = np.linalg.solve(H, g)
        w -= step
        if np.abs(step).max() < 1e-8:
            break
    beta = w / sd  # back to raw feature scale
    beta[0] = w[0] - np.sum(w[1:] * mu[1:] / sd[1:])
    return beta


def train(n_matches: int = 300, seed0: int = 10_000) -> dict:
    shots_X, shots_y, pass_X, pass_y = [], [], [], []
    for i in range(n_matches):
        _, events = generate_match(seed0 + i)
        for ev in events:
            e = ev.model_dump()
            if e["type"] == "Shot":
                shots_X.append(xg_features(e))
                shots_y.append(float(e["outcome"] == "Goal"))
            elif e["type"] == "Pass" and e["outcome"] != "Out" and e.get("end_location"):
                pass_X.append(pass_features(e))
                pass_y.append(float(e["outcome"] == "Complete"))
    xg = _fit_logistic(np.array(shots_X), np.array(shots_y))
    ps = _fit_logistic(np.array(pass_X), np.array(pass_y))
    return {
        "trained_on": {"matches": n_matches, "shots": len(shots_y), "passes": len(pass_y)},
        "xg": dict(zip(XG_FEATURES, map(float, xg))),
        "pass_completion": dict(zip(PASS_FEATURES, map(float, ps))),
    }


_MODELS: dict | None = None


def _models() -> dict:
    global _MODELS
    if _MODELS is None:
        with resources.files("matchcopilot.data").joinpath("models.json").open() as f:
            _MODELS = json.load(f)
    return _MODELS


def _predict(coefs: dict, names: list[str], feats: list[float]) -> float:
    z = sum(coefs[n] * v for n, v in zip(names, feats))
    return 1 / (1 + math.exp(-z))


def xg(e: dict) -> float:
    """Expected goals for a shot event (dict form)."""
    return _predict(_models()["xg"], XG_FEATURES, xg_features(e))


def pass_difficulty(e: dict) -> int:
    """0 (routine) to 100 (very hard): 100 x (1 - expected completion)."""
    if not e.get("end_location") or e.get("pass_length_m") is None:
        return 0
    p = _predict(_models()["pass_completion"], PASS_FEATURES, pass_features(e))
    return int(round(100 * (1 - p)))


if __name__ == "__main__":
    out = Path(__file__).resolve().parents[1] / "data" / "models.json"
    out.write_text(json.dumps(train(), indent=2))
    print(out.read_text())
