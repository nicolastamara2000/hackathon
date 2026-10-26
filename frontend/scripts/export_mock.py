"""Export one generated match as the frontend's mock feed.

The events are the generator's own schema (src/matchcopilot/generator/schema.py),
plus two enrichment fields the live analyzer already computes server side:
`xg` on shots and `pass_difficulty` on passes, from the same models.

    python frontend/scripts/export_mock.py --seed 7
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from matchcopilot.generator.engine import generate_match
from matchcopilot.metrics.models import pass_difficulty, xg

OUT = Path(__file__).resolve().parents[1] / "src" / "mock" / "data"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()
    meta, events = generate_match(args.seed)
    rows = []
    for e in events:
        d = e.model_dump(exclude_none=True)
        d.pop("match_id", None)  # same for every event, kept once in meta
        if d["type"] == "Shot":
            d["xg"] = round(xg(d), 3)
        elif d["type"] == "Pass":
            d["pass_difficulty"] = pass_difficulty(d)
        rows.append(d)
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"match-{args.seed}.json"
    path.write_text(json.dumps({"meta": meta.model_dump(), "events": rows}, separators=(",", ":")))
    print(f"{path} {len(rows)} events {path.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
