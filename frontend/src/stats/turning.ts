/**
 * Tactical Turning Point Engine. Deterministic: (meta, events, clock) -> insights.
 *
 * Every minute of play it compares the last window (10 min, 5 min early on) with
 * the window before it, per team, on eight signals. A signal that crosses its
 * rule becomes an insight; the insight then lives on: new -> developing ->
 * confirmed (held 3 checks) or no longer supported (failed 2 checks in a row).
 * History is kept, never rewritten. Numbers come from here; text only explains them.
 */
import type { MatchEvent, MatchMeta, XY } from "../feed/types";
import { xT } from "./geometry";
import { findBreaks, playTime } from "./time";
import type { Side } from "./engine";

export type TPKind =
  | "press_up" | "forward_drop" | "flank_shift" | "territory" | "threat_surge"
  | "sterile_possession" | "chaos" | "reaction";
export type TPStatus = "new" | "developing" | "confirmed" | "faded";
export type Impact = "high" | "medium" | "low";
export type Confidence = "high" | "medium" | "low";

export interface TPMetric {
  key: string; // i18n key in tpText
  prev: number;
  now: number;
  unit: "pct" | "n" | "dec";
}

export interface TurningPoint {
  id: string;
  kind: TPKind;
  side: Side;
  /** detection time, seconds of play */
  play_s: number;
  clock_s: number;
  minute: number;
  window: { prevFrom: number; prevTo: number; nowFrom: number; nowTo: number }; // minutes of play
  metrics: TPMetric[];
  /** effect size / detection threshold; >= 1 means the rule fired */
  strength: number;
  sample: number; // events behind the main signal in the current window
  impact: Impact;
  confidence: Confidence;
  status: TPStatus;
  history: { minute: number; status: TPStatus; strength: number }[];
  evidence: string[]; // event ids
  points: XY[]; // evidence locations, fixed frame (home attacks right)
  zone: { x0: number; y0: number; x1: number; y1: number } | null; // fixed frame
  extra: Record<string, string | number>;
}

const ON_BALL = new Set(["Pass", "Carry", "Dribble", "Shot"]);
const WIN_TYPES = new Set(["Ball Recovery", "Interception", "Tackle"]);

interface Bucket {
  hiRec: MatchEvent[];
  fwdAtt: number;
  fwdCmp: number;
  fwdIds: MatchEvent[];
  left: number;
  centre: number;
  right: number;
  flankIds: { left: MatchEvent[]; right: MatchEvent[] };
  ft: MatchEvent[]; // passes from the final third
  xt: number;
  xtIds: MatchEvent[];
  xg: number;
  shots: MatchEvent[];
  onBall: number;
}

const bucket = (): Bucket => ({
  hiRec: [], fwdAtt: 0, fwdCmp: 0, fwdIds: [], left: 0, centre: 0, right: 0,
  flankIds: { left: [], right: [] }, ft: [], xt: 0, xtIds: [], xg: 0, shots: [], onBall: 0,
});

interface Win {
  hiRec: MatchEvent[];
  fwdAtt: number;
  fwdCmp: number;
  fwdIds: MatchEvent[];
  left: number;
  centre: number;
  right: number;
  flankIds: { left: MatchEvent[]; right: MatchEvent[] };
  ft: MatchEvent[];
  xt: number;
  xtIds: MatchEvent[];
  xg: number;
  shots: MatchEvent[];
  onBall: number;
}

function sum(bs: Bucket[], from: number, to: number): Win {
  const w = bucket();
  for (let m = Math.max(0, from); m < Math.min(bs.length, to); m++) {
    const b = bs[m];
    w.hiRec.push(...b.hiRec);
    w.fwdAtt += b.fwdAtt;
    w.fwdCmp += b.fwdCmp;
    w.fwdIds.push(...b.fwdIds);
    w.left += b.left;
    w.centre += b.centre;
    w.right += b.right;
    w.flankIds.left.push(...b.flankIds.left);
    w.flankIds.right.push(...b.flankIds.right);
    w.ft.push(...b.ft);
    w.xt += b.xt;
    w.xtIds.push(...b.xtIds);
    w.xg += b.xg;
    w.shots.push(...b.shots);
    w.onBall += b.onBall;
  }
  return w;
}

const other = (s: Side): Side => (s === "home" ? "away" : "home");
const share = (a: number, b: number) => (a + b > 0 ? a / (a + b) : 0.5);

interface Hit {
  kind: TPKind;
  side: Side;
  strength: number;
  sample: number;
  metrics: TPMetric[];
  evidence: MatchEvent[];
  zone: TurningPoint["zone"];
  extra?: Record<string, string | number>;
}

/** All turning points known at `clock`, in detection order. */
export function turningPoints(meta: MatchMeta, all: MatchEvent[], clock: number): TurningPoint[] {
  const events = all.filter((e) => e.clock_s <= clock);
  if (!events.length) return [];
  const breaks = findBreaks(events);
  const sideOf = (team?: string): Side | null => (team === meta.home.id ? "home" : team === meta.away.id ? "away" : null);
  const fixed = (p: XY, s: Side): XY => (s === "home" ? p : [120 - p[0], 80 - p[1]]);
  const nowPlay = playTime(clock, breaks);
  const minutes = Math.floor(nowPlay / 60);
  const B: Record<Side, Bucket[]> = { home: [], away: [] };
  const turnovers: number[] = [];
  const triggers: { minute: number; side: Side; e: MatchEvent }[] = [];
  const minuteOf: number[] = []; // match minute shown for each play-minute
  let lastPoss: string | undefined;

  for (const e of events) {
    const m = Math.floor(playTime(e.clock_s, breaks) / 60);
    for (const s of ["home", "away"] as Side[]) while (B[s].length <= m) B[s].push(bucket());
    while (turnovers.length <= m) turnovers.push(0);
    minuteOf[m] = e.minute;
    if (e.possession_team_id && e.possession_team_id !== lastPoss && ON_BALL.has(e.type)) {
      if (lastPoss) turnovers[m]++;
      lastPoss = e.possession_team_id;
    }
    const s = sideOf(e.team_id);
    if (!s) continue;
    const b = B[s][m];
    if (e.type === "Shot" && e.outcome === "Goal") triggers.push({ minute: m, side: s, e });
    if (e.type === "Substitution" || (e.type === "Card" && e.card === "Red")) triggers.push({ minute: m, side: s, e });
    if (!e.location) continue;
    const [x, y] = e.location;
    if (WIN_TYPES.has(e.type) && x >= 60 && e.outcome !== "Lost") b.hiRec.push(e);
    if (ON_BALL.has(e.type)) {
      b.onBall++;
      if (y < 80 / 3) {
        b.left++;
        b.flankIds.left.push(e);
      } else if (y > 160 / 3) {
        b.right++;
        b.flankIds.right.push(e);
      } else b.centre++;
    }
    if (e.type === "Pass" && e.end_location) {
      if (e.end_location[0] - x >= 10) {
        b.fwdAtt++;
        b.fwdIds.push(e);
        if (e.outcome === "Complete") b.fwdCmp++;
      }
      if (x >= 80) b.ft.push(e);
    }
    if ((e.type === "Pass" && e.outcome === "Complete") || e.type === "Carry") {
      if (e.end_location) {
        const d = Math.max(0, xT(e.end_location) - xT(e.location));
        if (d > 0) {
          b.xt += d;
          if (d > 0.01) b.xtIds.push(e);
        }
      }
    }
    if (e.type === "Shot") {
      b.xg += e.xg ?? 0;
      b.shots.push(e);
    }
  }

  const detect = (m: number): Hit[] => {
    const W = winAt(m);
    const hits: Hit[] = [];
    const nowW = { home: sum(B.home, m - W, m), away: sum(B.away, m - W, m) };
    const prevW = { home: sum(B.home, m - 2 * W, m - W), away: sum(B.away, m - 2 * W, m - W) };
    const scale = W / 10;
    for (const s of ["home", "away"] as Side[]) {
      const N = nowW[s], P = prevW[s], O = nowW[other(s)], OP = prevW[other(s)];
      // 1. pressing: high recoveries up
      {
        const n = N.hiRec.length, p = P.hiRec.length;
        if (n >= 6 * scale && n >= p + 4 * scale && n >= 2 * Math.max(1, p))
          hits.push({
            kind: "press_up", side: s, strength: n / Math.max(6 * scale, p + 4 * scale), sample: n,
            metrics: [
              { key: "hiRec", prev: p, now: n, unit: "n" },
              { key: "oppFwd", prev: OP.fwdAtt ? OP.fwdCmp / OP.fwdAtt : 0, now: O.fwdAtt ? O.fwdCmp / O.fwdAtt : 0, unit: "pct" },
            ],
            evidence: N.hiRec, zone: s === "home" ? { x0: 60, y0: 0, x1: 120, y1: 80 } : { x0: 0, y0: 0, x1: 60, y1: 80 },
          });
      }
      // 2. forward passing breaks down
      {
        const pn = N.fwdAtt ? N.fwdCmp / N.fwdAtt : 0, pp = P.fwdAtt ? P.fwdCmp / P.fwdAtt : 0;
        if (N.fwdAtt >= 8 * scale && P.fwdAtt >= 8 * scale && pp - pn >= 0.2)
          hits.push({
            kind: "forward_drop", side: s, strength: (pp - pn) / 0.2, sample: N.fwdAtt,
            metrics: [
              { key: "fwdPct", prev: pp, now: pn, unit: "pct" },
              { key: "fwdAtt", prev: P.fwdAtt, now: N.fwdAtt, unit: "n" },
              { key: "oppHiRec", prev: OP.hiRec.length, now: O.hiRec.length, unit: "n" },
            ],
            evidence: N.fwdIds.filter((e) => e.outcome !== "Complete"), zone: null,
          });
      }
      // 3. possession drifts to one flank
      for (const f of ["left", "right"] as const) {
        const tn = N.left + N.centre + N.right, tp = P.left + P.centre + P.right;
        if (tn < 20 * scale || tp < 20 * scale) continue;
        const sn = N[f] / tn, sp = P[f] / tp;
        if (sn - sp >= 0.2 && sn >= 0.45)
          hits.push({
            kind: "flank_shift", side: s, strength: (sn - sp) / 0.2, sample: N[f],
            metrics: [{ key: f === "left" ? "leftShare" : "rightShare", prev: sp, now: sn, unit: "pct" }],
            evidence: N.flankIds[f],
            // own-frame flank to the fixed frame: home keeps y, away mirrors it
            zone: (s === "home") === (f === "left") ? { x0: 0, y0: 0, x1: 120, y1: 80 / 3 } : { x0: 0, y0: 160 / 3, x1: 120, y1: 80 },
            extra: { flank: f },
          });
      }
      // 4. territory: share of final-third passes
      {
        const tn = share(N.ft.length, O.ft.length), tp = share(P.ft.length, OP.ft.length);
        if (N.ft.length + O.ft.length >= 10 * scale && tn - tp >= 0.25 && tn >= 0.65)
          hits.push({
            kind: "territory", side: s, strength: (tn - tp) / 0.25, sample: N.ft.length,
            metrics: [
              { key: "fieldTilt", prev: tp, now: tn, unit: "pct" },
              { key: "ftPasses", prev: P.ft.length, now: N.ft.length, unit: "n" },
            ],
            evidence: N.ft, zone: s === "home" ? { x0: 80, y0: 0, x1: 120, y1: 80 } : { x0: 0, y0: 0, x1: 40, y1: 80 },
          });
      }
      // 5. attacking threat surges
      {
        const xtUp = N.xt >= 0.5 * scale && N.xt >= 2.5 * Math.max(0.1, P.xt);
        const xgUp = N.xg >= 0.6 * scale && N.xg >= 3 * Math.max(0.1, P.xg);
        if (xtUp || xgUp)
          hits.push({
            kind: "threat_surge", side: s, strength: Math.max(N.xt / (2.5 * Math.max(0.2, P.xt)), N.xg / (3 * Math.max(0.2, P.xg))),
            sample: N.xtIds.length + N.shots.length,
            metrics: [
              { key: "xt", prev: P.xt, now: N.xt, unit: "dec" },
              { key: "xg", prev: P.xg, now: N.xg, unit: "dec" },
              { key: "shots", prev: P.shots.length, now: N.shots.length, unit: "n" },
            ],
            evidence: [...N.shots, ...N.xtIds], zone: s === "home" ? { x0: 80, y0: 18, x1: 120, y1: 62 } : { x0: 0, y0: 18, x1: 40, y1: 62 },
          });
      }
      // 6. the ball without the threat
      {
        const poss = share(N.onBall, O.onBall);
        if (W === 10 && poss >= 0.6 && N.xg < 0.1 && N.shots.length <= 1 && N.onBall >= 40)
          hits.push({
            kind: "sterile_possession", side: s, strength: (poss - 0.5) / 0.1, sample: N.onBall,
            metrics: [
              { key: "possShare", prev: share(P.onBall, OP.onBall), now: poss, unit: "pct" },
              { key: "xg", prev: P.xg, now: N.xg, unit: "dec" },
              { key: "ftPasses", prev: P.ft.length, now: N.ft.length, unit: "n" },
            ],
            evidence: N.ft.length ? N.ft : N.fwdIds, zone: null,
          });
      }
    }
    // 7. control -> chaos: turnovers per minute (match-wide, credited to nobody: side = the one under more threat)
    {
      const tn = turnovers.slice(Math.max(0, m - W), m).reduce((a, b) => a + b, 0) / W;
      const tp = turnovers.slice(Math.max(0, m - 2 * W), Math.max(0, m - W)).reduce((a, b) => a + b, 0) / W;
      if (tn >= 2.5 && tn >= tp * 1.5 + 0.3) {
        const s: Side = nowW.home.xg + nowW.home.xt >= nowW.away.xg + nowW.away.xt ? "home" : "away";
        hits.push({
          kind: "chaos", side: s, strength: tn / (tp * 1.5 + 0.3), sample: Math.round(tn * W),
          metrics: [
            { key: "turnovers", prev: tp, now: tn, unit: "dec" },
            { key: "shotsBoth", prev: prevW.home.shots.length + prevW.away.shots.length, now: nowW.home.shots.length + nowW.away.shots.length, unit: "n" },
          ],
          evidence: [...nowW.home.hiRec, ...nowW.away.hiRec], zone: { x0: 30, y0: 0, x1: 90, y1: 80 },
        });
      }
    }
    // 8. reaction to a goal, sub or red: 10 min after vs 10 min before, checked once
    for (const tr of triggers) {
      if (m !== tr.minute + 10) continue;
      for (const s of ["home", "away"] as Side[]) {
        const before = { me: sum(B[s], tr.minute - 10, tr.minute), op: sum(B[other(s)], tr.minute - 10, tr.minute) };
        const after = { me: sum(B[s], tr.minute + 1, m + 1), op: sum(B[other(s)], tr.minute + 1, m + 1) };
        const tb = share(before.me.ft.length, before.op.ft.length), ta = share(after.me.ft.length, after.op.ft.length);
        if (ta - tb >= 0.2 && after.me.ft.length >= 6)
          hits.push({
            kind: "reaction", side: s, strength: (ta - tb) / 0.2, sample: after.me.ft.length,
            metrics: [
              { key: "fieldTilt", prev: tb, now: ta, unit: "pct" },
              { key: "xt", prev: before.me.xt, now: after.me.xt, unit: "dec" },
            ],
            evidence: [tr.e, ...after.me.ft], zone: s === "home" ? { x0: 80, y0: 0, x1: 120, y1: 80 } : { x0: 0, y0: 0, x1: 40, y1: 80 },
            extra: {
              trigger: tr.e.type === "Shot" ? "goal" : tr.e.type === "Substitution" ? "sub" : "red",
              triggerSide: sideOf(tr.e.team_id) ?? "home",
              triggerMinute: tr.e.minute,
              triggerPlayer: tr.e.type === "Substitution" ? tr.e.sub_in_name ?? "" : tr.e.player_name ?? "",
            },
          });
      }
    }
    return hits;
  };

  const out: TurningPoint[] = [];
  const open = new Map<string, { tp: TurningPoint; held: number; missed: number }>();
  const closed = new Map<string, number>(); // key -> play-minute it closed (10 min cooldown)
  for (let m = 14; m <= minutes; m++) {
    const hits = detect(m);
    const seen = new Set<string>();
    for (const h of hits) {
      const key = `${h.kind}|${h.side}|${h.extra?.flank ?? ""}`;
      seen.add(key);
      const o = open.get(key);
      const W = winAt(m);
      if (!o && m - (closed.get(key) ?? -99) < 10) continue;
      if (o && h.kind !== "reaction") {
        o.held++;
        o.missed = 0;
        const status: TPStatus = o.held >= 3 ? "confirmed" : "developing";
        if (status !== o.tp.status) o.tp.history.push({ minute: minuteOf[m - 1] ?? m, status, strength: round(h.strength) });
        o.tp.status = status;
        o.tp.strength = Math.max(o.tp.strength, round(h.strength));
        continue;
      }
      const ev = dedupe(h.evidence);
      const strength = round(h.strength);
      const tp: TurningPoint = {
        id: `tp-${key}-${m}`,
        kind: h.kind,
        side: h.side,
        play_s: m * 60,
        clock_s: ev.length ? Math.max(...ev.map((e) => e.clock_s)) : 0,
        minute: minuteOf[m - 1] ?? m,
        window: h.kind === "reaction"
          ? { prevFrom: m - 20, prevTo: m - 10, nowFrom: m - 10, nowTo: m }
          : { prevFrom: m - 2 * W, prevTo: m - W, nowFrom: m - W, nowTo: m },
        metrics: h.metrics.map((x) => ({ ...x, prev: round(x.prev), now: round(x.now) })),
        strength,
        sample: h.sample,
        impact: impactOf(h.kind, strength),
        confidence: h.sample >= 12 && strength >= 1.5 ? "high" : h.sample >= 6 ? "medium" : "low",
        status: h.kind === "reaction" ? "confirmed" : "new",
        history: [{ minute: minuteOf[m - 1] ?? m, status: "new", strength }],
        evidence: ev.map((e) => e.id),
        points: ev.filter((e) => e.location).map((e) => fixed(e.location!, sideOf(e.team_id) ?? h.side)),
        zone: h.zone,
        extra: h.extra ?? {},
      };
      out.push(tp);
      if (h.kind !== "reaction") open.set(key, { tp, held: 1, missed: 0 });
    }
    for (const [key, o] of open) {
      if (seen.has(key)) continue;
      o.missed++;
      if (o.missed >= 2) {
        // a confirmed pattern that ends is history, not a mistake: only unconfirmed ones lose support
        if (o.tp.status !== "confirmed") {
          o.tp.status = "faded";
          o.tp.history.push({ minute: minuteOf[m - 1] ?? m, status: "faded", strength: 0 });
        }
        open.delete(key);
        closed.set(key, m);
      }
    }
  }
  return out;
}

/** Window length in minutes of play: 7 early on, 10 from minute 20. */
const winAt = (m: number) => (m >= 20 ? 10 : 7);

const round = (v: number) => Math.round(v * 100) / 100;
const dedupe = (es: MatchEvent[]) => [...new Map(es.map((e) => [e.id, e])).values()].sort((a, b) => a.clock_s - b.clock_s).slice(-40);

function impactOf(kind: TPKind, strength: number): Impact {
  const base = kind === "threat_surge" || kind === "reaction" ? 0.5 : 0;
  const v = strength + base;
  return v >= 2.2 ? "high" : v >= 1.4 ? "medium" : "low";
}
