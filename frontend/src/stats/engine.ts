/**
 * The live stats object. In production the backend pushes it on the socket; the
 * mock feed builds it with this same function, and the UI reuses it when the
 * viewer scrubs back in time. Pure: (meta, events, clock) -> snapshot.
 *
 * Every stat records the event ids behind it in `sources`, so any number on
 * screen can open the evidence.
 */
import type { MatchEvent, MatchMeta, XY } from "../feed/types";
import { goalDist, isProgressive, xT } from "./geometry";
import { findBreaks, playTime } from "./time";
import { scoringRates, winProbability, type WinProb } from "./winprob";

export type Side = "home" | "away";
export const SIDES: Side[] = ["home", "away"];
export const other = (s: Side): Side => (s === "home" ? "away" : "home");

export interface TeamStats {
  possession: number; // 0..1, share of possession time
  fieldTilt: number; // 0..1, share of final-third passes
  ppda5: number | null; // opponent passes per defensive action, last 5 min
  xg: number;
  xt: number;
  shots: number;
  onTarget: number;
  passes: number;
  passAccuracy: number; // 0..1
  passDistanceM: number; // average
  progressive: number;
  avgDifficulty: number; // 0..100
  topShotKmh: number;
  reds: number;
}

export type MomentKind = "goal" | "big_chance" | "shot" | "yellow" | "red" | "sub" | "half";

export interface KeyMoment {
  id: string;
  clock_s: number;
  play_s: number;
  minute: number;
  second: number;
  kind: MomentKind;
  side?: Side;
  player?: string;
  detail?: string;
  xg?: number;
  winSwing?: number; // change in the scoring side's win probability, pp
}

export interface Point {
  play_s: number;
  minute: number;
}

export type Rhythm = "fast" | "slow" | "broken";

export interface StatsSnapshot {
  clock_s: number;
  play_s: number;
  minute: number;
  period: number;
  score: [number, number];
  home: TeamStats;
  away: TeamStats;
  winProb: WinProb;
  winProbHistory: (Point & WinProb)[];
  xgTimeline: (Point & { home: number; away: number })[];
  momentum: { play_s: number; home: number; away: number }[]; // per minute of play, 0..1
  /** −100 chaos .. +100 control, and who holds the control. */
  controlChaos: number;
  controlSide: Side | null;
  rhythm: Rhythm;
  pressureShift: { side: Side; from: number; to: number } | null;
  lastBallKmh: number | null;
  possessionSide: Side | null;
  keyMoments: KeyMoment[];
  sources: Record<string, string[]>;
}

const WINDOW_S = 300;
const DEF_ACTIONS = new Set(["Tackle", "Interception", "Foul Committed"]);
const ON_BALL = new Set(["Pass", "Carry", "Dribble", "Shot"]);
const STOPPAGES = new Set(["Foul Committed", "Card", "Substitution"]);

interface Acc {
  possS: number;
  ftPasses: number;
  xg: number;
  xt: number;
  shots: number;
  onTarget: number;
  passes: number;
  complete: number;
  passM: number;
  progressive: number;
  diffSum: number;
  topShot: number;
  reds: number;
}

const acc = (): Acc => ({
  possS: 0, ftPasses: 0, xg: 0, xt: 0, shots: 0, onTarget: 0, passes: 0, complete: 0,
  passM: 0, progressive: 0, diffSum: 0, topShot: 0, reds: 0,
});

/** Threat added by a completed pass or carry. */
function threat(e: MatchEvent): number {
  if (!e.location || !e.end_location) return 0;
  if (e.type === "Pass" && e.outcome !== "Complete") return 0;
  if (e.type !== "Pass" && e.type !== "Carry") return 0;
  return Math.max(0, xT(e.end_location) - xT(e.location));
}

function ppda(window: MatchEvent[], defending: string, attacking: string, src?: string[]): number | null {
  // passes the attacking side plays in its own 60 % / defensive actions in that zone
  const passes = window.filter((e) => e.type === "Pass" && e.team_id === attacking && e.location && e.location[0] < 72).length;
  const acts = window.filter((e) => DEF_ACTIONS.has(e.type) && e.team_id === defending && e.location && e.location[0] >= 48);
  if (src) src.push(...acts.map((e) => e.id));
  return acts.length ? passes / acts.length : null;
}

function controlIndex(window: MatchEvent[], home: string, away: string) {
  if (window.length < 10) return { control: 0, chaos: 0 };
  const poss: Record<string, number> = { [home]: 0, [away]: 0 };
  for (let i = 0; i + 1 < window.length; i++) {
    const t = window[i].possession_team_id;
    if (t && t in poss) poss[t] += Math.min(30, window[i + 1].clock_s - window[i].clock_s);
  }
  const possH = poss[home] / (poss[home] + poss[away] || 1);
  const side = (team: string) => {
    const passes = window.filter((e) => e.type === "Pass" && e.team_id === team);
    const comp = passes.length ? passes.filter((e) => e.outcome === "Complete").length / passes.length : 0;
    const ft = window.filter((e) => e.team_id === team && e.location && e.location[0] > 80 && ON_BALL.has(e.type)).length;
    const xg = window.filter((e) => e.team_id === team && e.type === "Shot").reduce((s, e) => s + (e.xg ?? 0), 0);
    const presses = window.filter((e) => e.type === "Pressure" && e.team_id === team).length;
    return { comp, ft, xg, presses };
  };
  const h = side(home), a = side(away);
  const territory = (h.ft - a.ft) / Math.max(h.ft + a.ft, 1);
  const control = 0.45 * (2 * possH - 1) + 0.4 * (h.comp - a.comp) + 0.25 * territory + 0.1 * Math.tanh((h.xg - a.xg) * 3);
  const minutes = Math.max((window[window.length - 1].clock_s - window[0].clock_s) / 60, 1);
  const turnovers = window.filter((e) => ["Interception", "Ball Recovery", "Tackle"].includes(e.type)).length / minutes;
  const duels = window.filter((e) => ["Dribble", "Tackle", "Foul Committed"].includes(e.type)).length / minutes;
  const chaos = Math.min(1, 0.12 * turnovers + 0.1 * duels + (0.02 * (h.presses + a.presses)) / minutes);
  return { control: Math.max(-1, Math.min(1, control)), chaos };
}

function rhythmOf(window3: MatchEvent[], clock: number): Rhythm {
  const stoppages = window3.filter((e) => STOPPAGES.has(e.type) || (e.type === "Shot" && e.outcome !== "Saved")).length;
  const lastPass = [...window3].reverse().find((e) => e.type === "Pass");
  if (stoppages >= 4 || !lastPass || clock - lastPass.clock_s > 40) return "broken";
  const span = Math.max(1, Math.min(3, (clock - window3[0].clock_s) / 60));
  const passesPerMin = window3.filter((e) => e.type === "Pass").length / span;
  return passesPerMin >= RHYTHM_FAST ? "fast" : "slow";
}
// passes per minute, both teams, last 3 min: the median over 40 generated matches
const RHYTHM_FAST = 10.3;

export function computeStats(meta: MatchMeta, all: MatchEvent[], clock: number): StatsSnapshot {
  const H = meta.home.id, A = meta.away.id;
  const sideOf = (team?: string): Side | null => (team === H ? "home" : team === A ? "away" : null);
  const events = all.filter((e) => e.clock_s <= clock);
  const breaks = findBreaks(events);
  const last = events[events.length - 1];
  const minute = last?.minute ?? 0;

  const t: Record<Side, Acc> = { home: acc(), away: acc() };
  const score: [number, number] = [0, 0];
  const sources: Record<string, string[]> = {};
  const src = (k: string) => (sources[k] ??= []);
  const keyMoments: KeyMoment[] = [];
  const winProbHistory: StatsSnapshot["winProbHistory"] = [];
  const xgTimeline: StatsSnapshot["xgTimeline"] = [{ play_s: 0, minute: 0, home: 0, away: 0 }];
  const buckets: { home: number; away: number }[] = [];
  const yellows = new Set<string>();
  let lastMinute = -1;
  let lastBallKmh: number | null = null;

  const wp = (m: number) =>
    winProbability(score, m, ...scoringRates(meta.home.strength, meta.away.strength, m, t.home.xg, t.away.xg));

  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const s = sideOf(e.team_id);
    const play = playTime(e.clock_s, breaks);
    const pt = { play_s: play, minute: e.minute };
    if (e.minute !== lastMinute) {
      winProbHistory.push({ ...pt, ...wp(e.minute) });
      lastMinute = e.minute;
    }
    // possession time until the next event (capped so stoppages don't count)
    const ps = sideOf(e.possession_team_id);
    if (ps && e.possession !== events[i - 1]?.possession) src(`${ps}.possession`).push(e.id);
    const next = events[i + 1]?.clock_s ?? clock;
    if (ps && e.type !== "Half End") t[ps].possS += Math.max(0, Math.min(30, next - e.clock_s));
    if (e.ball_speed_kmh) lastBallKmh = e.ball_speed_kmh;

    const b = Math.floor(play / 60);
    while (buckets.length <= b) buckets.push({ home: 0, away: 0 });

    if (!s) {
      if (e.type === "Half End" || (e.type === "Half Start" && e.period === 2))
        keyMoments.push({ id: e.id, clock_s: e.clock_s, play_s: play, minute: e.minute, second: e.second, kind: "half", detail: e.type });
      continue;
    }
    const T = t[s];
    const dt = threat(e);
    if (dt > 0) {
      T.xt += dt;
      buckets[b][s] += dt;
      src(`${s}.xt`).push(e.id);
    }
    switch (e.type) {
      case "Pass": {
        T.passes++;
        src(`${s}.passes`).push(e.id);
        T.passM += e.pass_length_m ?? 0;
        T.diffSum += e.pass_difficulty ?? 0;
        if (e.outcome === "Complete") {
          T.complete++;
          if (e.location && e.end_location && isProgressive(e.location, e.end_location)) {
            T.progressive++;
            src(`${s}.progressive`).push(e.id);
          }
        }
        if (e.location && e.location[0] > 80) {
          T.ftPasses++;
          src(`${s}.fieldTilt`).push(e.id);
        }
        break;
      }
      case "Shot": {
        const x = e.xg ?? 0;
        const before = wp(e.minute);
        T.shots++;
        T.xg += x;
        buckets[b][s] += x;
        T.topShot = Math.max(T.topShot, e.ball_speed_kmh ?? 0);
        src(`${s}.xg`).push(e.id);
        src(`${s}.shots`).push(e.id);
        if (e.outcome === "Goal" || e.outcome === "Saved") T.onTarget++;
        xgTimeline.push({ ...pt, home: t.home.xg, away: t.away.xg });
        if (e.outcome === "Goal") {
          score[s === "home" ? 0 : 1]++;
          const after = wp(e.minute);
          winProbHistory.push({ ...pt, ...after });
          src("score").push(e.id);
          keyMoments.push({
            id: e.id, clock_s: e.clock_s, play_s: play, minute: e.minute, second: e.second, kind: "goal", side: s,
            player: e.player_name, xg: x, detail: `${Math.round(e.ball_speed_kmh ?? 0)} km/h`,
            winSwing: Math.round(100 * (after[s] - before[s])),
          });
        } else {
          keyMoments.push({
            id: e.id, clock_s: e.clock_s, play_s: play, minute: e.minute, second: e.second,
            kind: x >= 0.25 ? "big_chance" : "shot", side: s, player: e.player_name, xg: x, detail: e.outcome,
          });
        }
        break;
      }
      case "Card": {
        const second = e.card === "Yellow" && yellows.has(e.player_id ?? "");
        if (e.card === "Yellow") yellows.add(e.player_id ?? "");
        const red = e.card === "Red" || second;
        if (red) T.reds++;
        keyMoments.push({
          id: e.id, clock_s: e.clock_s, play_s: play, minute: e.minute, second: e.second, kind: red ? "red" : "yellow",
          side: s, player: e.player_name, detail: second ? "2nd yellow" : e.card,
        });
        break;
      }
      case "Substitution":
        keyMoments.push({
          id: e.id, clock_s: e.clock_s, play_s: play, minute: e.minute, second: e.second, kind: "sub", side: s,
          player: e.sub_in_name, detail: e.player_name,
        });
        break;
    }
  }

  // rolling windows
  const now = clock;
  const w5 = events.filter((e) => e.clock_s > now - WINDOW_S && e.type !== "Physical Update");
  const wPrev = events.filter((e) => e.clock_s > now - 2 * WINDOW_S && e.clock_s <= now - WINDOW_S);
  const w3 = events.filter((e) => e.clock_s > now - 180 && e.type !== "Physical Update");
  const ppdaH = ppda(w5, H, A, src("home.ppda5"));
  const ppdaA = ppda(w5, A, H, src("away.ppda5"));
  let pressureShift: StatsSnapshot["pressureShift"] = null;
  for (const [s, d, o, cur] of [["home", H, A, ppdaH], ["away", A, H, ppdaA]] as const) {
    const prev = ppda(wPrev, d, o);
    // PPDA down 40 % or more = pressing much higher than five minutes ago
    if (prev !== null && cur !== null && prev >= 6 && cur <= prev * 0.6) pressureShift = { side: s, from: prev, to: cur };
  }
  const ctrl = controlIndex(w5, H, A);
  sources.control = w5.filter((e) => e.type !== "Pressure").map((e) => e.id);
  sources.winProb = [...(sources.score ?? [])];
  const controlChaos = Math.round(100 * Math.max(-1, Math.min(1, Math.abs(ctrl.control) * 2.2 - ctrl.chaos * 1.6 + 0.35)));
  const controlSide: Side | null = Math.abs(ctrl.control) < 0.08 ? null : ctrl.control > 0 ? "home" : "away";

  const possTot = t.home.possS + t.away.possS || 1;
  const ftTot = t.home.ftPasses + t.away.ftPasses || 1;
  const build = (s: Side, pp: number | null): TeamStats => {
    const T = t[s];
    return {
      possession: T.possS / possTot,
      fieldTilt: T.ftPasses / ftTot,
      ppda5: pp,
      xg: T.xg,
      xt: T.xt,
      shots: T.shots,
      onTarget: T.onTarget,
      passes: T.passes,
      passAccuracy: T.passes ? T.complete / T.passes : 0,
      passDistanceM: T.passes ? T.passM / T.passes : 0,
      progressive: T.progressive,
      avgDifficulty: T.passes ? T.diffSum / T.passes : 0,
      topShotKmh: T.topShot,
      reds: T.reds,
    };
  };

  // momentum: threat per minute of play, smoothed, scaled to the match max so far
  let mh = 0, ma = 0;
  const smooth = buckets.map((b, i) => {
    mh = 0.55 * b.home + 0.45 * mh;
    ma = 0.55 * b.away + 0.45 * ma;
    return { play_s: i * 60, home: mh, away: ma };
  });
  const peak = Math.max(0.08, ...smooth.map((m) => Math.max(m.home, m.away)));
  const momentum = smooth.map((m) => ({ play_s: m.play_s, home: m.home / peak, away: m.away / peak }));

  const play_s = playTime(clock, breaks);
  const winProb = wp(minute);
  winProbHistory.push({ play_s, minute, ...winProb });
  xgTimeline.push({ play_s, minute, home: t.home.xg, away: t.away.xg });
  // keep evidence lists short and newest first
  for (const k of Object.keys(sources)) sources[k] = sources[k].slice(-40).reverse();

  return {
    clock_s: clock,
    play_s,
    minute,
    period: last?.period ?? 1,
    score,
    home: build("home", ppdaH),
    away: build("away", ppdaA),
    winProb,
    winProbHistory,
    xgTimeline,
    momentum,
    controlChaos,
    controlSide,
    rhythm: w3.length ? rhythmOf(w3, clock) : "slow",
    pressureShift,
    lastBallKmh,
    possessionSide: sideOf(last?.possession_team_id),
    keyMoments,
    sources,
  };
}

/** Distance helper re-exported for components. */
export const shotDistanceM = (p: XY) => goalDist(p);
