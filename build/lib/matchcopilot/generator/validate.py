"""Check synthetic matches against realistic per-match targets (data/priors.json)."""

from __future__ import annotations

import json
from importlib import resources

import numpy as np

from .engine import generate_match, shot_quality
from .schema import Event, MatchMeta


def load_priors() -> dict:
    with resources.files("matchcopilot.data").joinpath("priors.json").open() as f:
        data = json.load(f)
    data.pop("_about", None)
    return data


def match_stats(meta: MatchMeta, events: list[Event]) -> dict[str, float]:
    by_type: dict[str, list[Event]] = {}
    for e in events:
        by_type.setdefault(e.type, []).append(e)
    passes = by_type.get("Pass", [])
    shots = by_type.get("Shot", [])
    last_phys = next(e for e in reversed(events) if e.type == "Physical Update")
    roles = {p.id: p.role for t in (meta.home, meta.away) for p in t.lineup + t.bench}
    full_90 = [p for p in last_phys.physical if roles[p.player_id] != "GK" and p.distance_m > 8000]
    return {
        "passes": len(passes),
        "pass_completion": sum(p.outcome == "Complete" for p in passes) / max(len(passes), 1),
        "pass_length_m_mean": float(np.mean([p.pass_length_m for p in passes])),
        "shots": len(shots),
        "shots_on_target_share": sum(s.outcome in ("Goal", "Saved") for s in shots) / max(len(shots), 1),
        "goals": sum(s.outcome == "Goal" for s in shots),
        "xg_per_shot": float(np.mean([shot_quality(*s.location, s.under_pressure, s.body_part == "Head")
                                      for s in shots])) if shots else 0.0,
        "tackles": len(by_type.get("Tackle", [])),
        "interceptions": len(by_type.get("Interception", [])),
        "pressures": len(by_type.get("Pressure", [])),
        "fouls": len(by_type.get("Foul Committed", [])),
        "possessions": len({e.possession for e in events if e.possession_team_id}),
        "outfield_distance_km": float(np.mean([p.distance_m for p in full_90])) / 1000,
        "top_speed_kmh": max(p.top_speed_kmh for p in last_phys.physical),
        "shot_speed_kmh": float(np.mean([s.ball_speed_kmh for s in shots])) if shots else 0.0,
    }


def validate(n_matches: int = 40, seed0: int = 1) -> dict[str, dict]:
    """Average stats over n matches and compare with the target ranges."""
    priors = load_priors()
    rows = [match_stats(*generate_match(seed0 + i)) for i in range(n_matches)]
    report = {}
    for key, rng in priors.items():
        mean = float(np.mean([r[key] for r in rows]))
        report[key] = {"mean": round(mean, 3), "min": rng["min"], "max": rng["max"],
                       "ok": rng["min"] <= mean <= rng["max"]}
    return report


if __name__ == "__main__":
    rep = validate()
    for k, v in rep.items():
        print(f"{'OK ' if v['ok'] else 'BAD'} {k:24s} {v['mean']:>9} target [{v['min']}, {v['max']}]")
