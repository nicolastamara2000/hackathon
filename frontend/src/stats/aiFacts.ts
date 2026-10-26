/**
 * Facts sent to the AI writers. Every number here is computed by the engines in
 * the browser; the writers only explain them and are fact-checked against this
 * object on the server.
 */
import type { MatchEvent, MatchMeta } from "../feed/types";
import type { Locale } from "../i18n/strings";
import { tpText } from "../i18n/turning";
import { influence } from "./influence";
import { computeStats, type Side, type StatsSnapshot, type TeamStats } from "./engine";
import { findBreaks } from "./time";
import type { TurningPoint } from "./turning";

const r2 = (v: number) => Math.round(v * 100) / 100;
const pc = (v: number) => Math.round(v * 100);

function team(s: TeamStats) {
  return {
    possession_pct: pc(s.possession),
    field_tilt_pct: pc(s.fieldTilt),
    xg: r2(s.xg),
    shots: s.shots,
    shots_on_target: s.onTarget,
    passes: s.passes,
    pass_accuracy_pct: pc(s.passAccuracy),
    progressive_passes: s.progressive,
    avg_pass_difficulty: Math.round(s.avgDifficulty),
    ...(s.ppda5 !== null ? { ppda_last_5_min: r2(s.ppda5) } : {}),
  };
}

function tpFacts(tps: TurningPoint[], meta: MatchMeta, locale: Locale, limit: number) {
  return tps
    .filter((t) => t.status !== "faded" && t.impact !== "low")
    .sort((a, b) => b.strength - a.strength)
    .slice(0, limit)
    .sort((a, b) => a.minute - b.minute)
    .map((t) => {
      const x = tpText(t, meta, locale);
      return { minute: t.minute, team: meta[t.side].name, category: x.category, headline: x.headline, observed: x.observed, why: x.why, status: t.status, impact: t.impact };
    });
}

export function storyFacts(meta: MatchMeta, events: MatchEvent[], clock: number, stats: StatsSnapshot, tps: TurningPoint[], ended: boolean, locale: Locale) {
  const cut = events.filter((e) => e.clock_s <= clock);
  const breaks = findBreaks(cut);
  const ht = breaks.he1 !== undefined ? computeStats(meta, events, breaks.he1) : null;
  const name = (s?: Side) => (s ? meta[s].name : "");
  return {
    phase: ended ? "full_time" : ht ? "second_half" : "first_half",
    minute: stats.minute,
    teams: { home: { name: meta.home.name, formation: meta.home.formation }, away: { name: meta.away.name, formation: meta.away.formation } },
    score: { home: stats.score[0], away: stats.score[1] },
    stats: { home: team(stats.home), away: team(stats.away) },
    ...(ht ? { half_time: { score: { home: ht.score[0], away: ht.score[1] }, home: team(ht.home), away: team(ht.away) } } : {}),
    goals: stats.keyMoments.filter((k) => k.kind === "goal").map((k) => ({ minute: k.minute, team: name(k.side), scorer: k.player, xg: r2(k.xg ?? 0), win_probability_swing_pp: k.winSwing ?? null })),
    red_cards: stats.keyMoments.filter((k) => k.kind === "red").map((k) => ({ minute: k.minute, team: name(k.side), player: k.player })),
    win_probability_pct: { home: pc(stats.winProb.home), draw: pc(stats.winProb.draw), away: pc(stats.winProb.away) },
    turning_points: tpFacts(tps, meta, locale, 8),
    most_influential_players: influence(meta, cut).slice(0, 3).map((p) => ({ name: p.name, team: meta[p.side].name, threat_added_xt: r2(p.xt), xg: r2(p.xg), high_recoveries: p.rec })),
  };
}

export function playerNumbers(events: MatchEvent[], clock: number, id: string) {
  const n = {
    touches: 0, passes_attempted: 0, passes_completed: 0, progressive_passes: 0, hard_passes_completed: 0,
    shots: 0, xg: 0, dribbles_attempted: 0, dribbles_completed: 0, tackles_and_interceptions: 0,
    high_recoveries: 0, pressures: 0, touches_in_opponent_half: 0, distance_km: 0, sprints: 0, top_speed_kmh: 0,
  };
  for (const e of events) {
    if (e.clock_s > clock) break;
    if (e.type === "Physical Update") {
      const me = e.physical?.find((x) => x.player_id === id);
      if (me) {
        n.distance_km = Math.round(me.distance_m / 100) / 10;
        n.sprints = me.sprints;
        n.top_speed_kmh = Math.max(n.top_speed_kmh, Math.round(me.top_speed_kmh * 10) / 10);
      }
      continue;
    }
    if (e.player_id !== id) continue;
    if (e.type === "Pressure") {
      n.pressures++;
      continue;
    }
    n.touches++;
    if (e.location && e.location[0] >= 60) n.touches_in_opponent_half++;
    if (e.type === "Pass") {
      n.passes_attempted++;
      if (e.outcome === "Complete") {
        n.passes_completed++;
        if (e.location && e.end_location && e.end_location[0] - e.location[0] >= 25) n.progressive_passes++;
        if ((e.pass_difficulty ?? 0) >= 55) n.hard_passes_completed++;
      }
    }
    if (e.type === "Shot") {
      n.shots++;
      n.xg += e.xg ?? 0;
    }
    if (e.type === "Dribble") {
      n.dribbles_attempted++;
      if (e.outcome === "Complete") n.dribbles_completed++;
    }
    if (e.type === "Tackle" || e.type === "Interception") n.tackles_and_interceptions++;
    if ((e.type === "Ball Recovery" || e.type === "Interception" || e.type === "Tackle") && e.location && e.location[0] >= 60) n.high_recoveries++;
    n.top_speed_kmh = Math.max(n.top_speed_kmh, Math.round((e.player_speed_kmh ?? 0) * 10) / 10);
  }
  n.xg = r2(n.xg);
  return {
    ...n,
    pass_completion_pct: n.passes_attempted ? pc(n.passes_completed / n.passes_attempted) : null,
    opponent_half_touch_pct: n.touches ? pc(n.touches_in_opponent_half / n.touches) : null,
  };
}

export function playerFacts(meta: MatchMeta, events: MatchEvent[], clock: number, minute: number, playerId: string, tps: TurningPoint[], locale: Locale) {
  const side: Side = meta.home.lineup.concat(meta.home.bench).some((p) => p.id === playerId) ? "home" : "away";
  const t = meta[side];
  const p = [...t.lineup, ...t.bench].find((x) => x.id === playerId);
  if (!p) return null;
  const opp = meta[side === "home" ? "away" : "home"];
  const rival = opp.lineup.find((x) => x.position === p.position) ?? opp.lineup.find((x) => x.role === p.role);
  const actions = events
    .filter((e) => e.clock_s <= clock && e.player_id === p.id && ["Shot", "Dribble", "Tackle", "Interception", "Card", "Substitution"].includes(e.type))
    .slice(-12)
    .map((e) => ({ minute: e.minute, type: e.type, outcome: e.outcome ?? null, ...(e.type === "Shot" ? { xg: r2(e.xg ?? 0) } : {}) }));
  return {
    minute,
    player: { name: p.name, number: p.number, position: p.position, role: p.role, team: t.name, team_formation: t.formation },
    numbers: playerNumbers(events, clock, p.id),
    opponent_same_position: rival ? { name: rival.name, position: rival.position, team: opp.name, numbers: playerNumbers(events, clock, rival.id) } : null,
    key_actions: actions,
    team_turning_points: tpFacts(tps.filter((x) => x.side === side), meta, locale, 4).map(({ minute, headline, observed }) => ({ minute, headline, observed })),
  };
}
