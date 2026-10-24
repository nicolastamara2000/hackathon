"""Command line: generate synthetic matches or replay one as a live stream.

    matchgen generate --seed 7 --out data/samples
    matchgen replay data/samples/SYN-000007-*.events.jsonl --speed 30
    matchgen validate --matches 40
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

from .engine import generate_match
from .validate import validate


def _generate(args) -> None:
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    for i in range(args.matches):
        meta, events = generate_match(args.seed + i, matchday=i + 1)
        (out / f"{meta.match_id}.meta.json").write_text(meta.model_dump_json(indent=2))
        with (out / f"{meta.match_id}.events.jsonl").open("w") as f:
            for e in events:
                f.write(e.model_dump_json(exclude_none=True) + "\n")
        last = next(e for e in reversed(events) if e.score)
        print(f"{meta.match_id}: {meta.home.name} {last.score[0]}-{last.score[1]} {meta.away.name}, "
              f"{len(events)} events")


def _replay(args) -> None:
    """Print events to stdout at match-clock speed divided by --speed."""
    prev = None
    with open(args.file) as f:
        for line in f:
            ev = json.loads(line)
            if prev is not None and args.speed > 0:
                time.sleep(max(0.0, (ev["clock_s"] - prev) / args.speed))
            prev = ev["clock_s"]
            sys.stdout.write(line)
            sys.stdout.flush()


def _validate(args) -> None:
    report = validate(args.matches)
    bad = 0
    for k, v in report.items():
        bad += not v["ok"]
        print(f"{'OK ' if v['ok'] else 'BAD'} {k:24s} {v['mean']:>9} target [{v['min']}, {v['max']}]")
    sys.exit(1 if bad else 0)


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="matchgen", description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    g = sub.add_parser("generate", help="generate matches to JSONL")
    g.add_argument("--seed", type=int, default=1)
    g.add_argument("--matches", type=int, default=1)
    g.add_argument("--out", default="data/samples")
    g.set_defaults(func=_generate)
    r = sub.add_parser("replay", help="stream a match to stdout")
    r.add_argument("file")
    r.add_argument("--speed", type=float, default=30.0, help="x times faster than real time, 0 = no wait")
    r.set_defaults(func=_replay)
    v = sub.add_parser("validate", help="check realism against target ranges")
    v.add_argument("--matches", type=int, default=40)
    v.set_defaults(func=_validate)
    args = p.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
