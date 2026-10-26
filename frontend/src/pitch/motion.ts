/**
 * Turns the event feed into motion: a ball path (keyframes) and target spots for
 * all 22 players. The feed is events only (no tracking data), so off-ball players
 * are placed from their formation slot, shifted with the ball and the phase of
 * play. The player on the ball is always at the event location.
 *
 * Display frame: 120 x 80, home attacks right in the 1st half, left in the 2nd.
 */
import type { MatchEvent, MatchMeta, Player, XY } from "../feed/types";
import { toM } from "../stats/geometry";

export interface BallKey {
  t: number; // match clock
  p: XY; // display frame
  kmh: number; // speed of the segment that ends here
  eventIndex: number;
}

const BALL_EVENTS = new Set([
  "Kick Off", "Pass", "Carry", "Dribble", "Shot", "Goal Keeper", "Interception", "Ball Recovery", "Tackle", "Foul Committed",
]);

export function toDisplay(p: XY, teamId: string | undefined, period: number, homeId: string): XY {
  const homeRight = period !== 2;
  const attackingRight = (teamId === homeId) === homeRight;
  return attackingRight ? [p[0], p[1]] : [120 - p[0], 80 - p[1]];
}

export function fromDisplay(p: XY, teamId: string, period: number, homeId: string): XY {
  return toDisplay(p, teamId, period, homeId); // the mirror is its own inverse
}

const distM = (a: XY, b: XY) => toM(b[0] - a[0], b[1] - a[1]);

export function buildBallPath(events: MatchEvent[], homeId: string): BallKey[] {
  const keys: BallKey[] = [];
  const onBall = events.filter((e) => BALL_EVENTS.has(e.type) && e.location);
  onBall.forEach((e, k) => {
    const start = toDisplay(e.location!, e.team_id, e.period, homeId);
    const prev = keys[keys.length - 1];
    const dt = prev ? e.clock_s - prev.t : 0;
    const kmh = prev && dt > 0.05 ? Math.min(140, (distM(prev.p, start) / dt) * 3.6) : 0;
    keys.push({ t: e.clock_s, p: start, kmh, eventIndex: e.index });
    if (!e.end_location) return;
    const end = toDisplay(e.end_location, e.team_id, e.period, homeId);
    const next = onBall[k + 1]?.clock_s ?? e.clock_s + 3;
    const d = distM(start, end);
    let arrive: number;
    let v: number;
    if ((e.type === "Pass" || e.type === "Shot") && e.ball_speed_kmh) {
      v = e.ball_speed_kmh;
      arrive = e.clock_s + d / (v / 3.6);
    } else {
      arrive = next - 0.2;
      v = (d / Math.max(0.3, arrive - e.clock_s)) * 3.6;
    }
    arrive = Math.min(arrive, next - 0.05);
    if (arrive > e.clock_s) keys.push({ t: arrive, p: end, kmh: Math.min(140, v), eventIndex: e.index });
  });
  return keys;
}

/** Index of the last item at or before t (items sorted by time). */
export function keyAt<T>(keys: T[], t: number, time: (k: T) => number = (k) => (k as { t: number }).t): number {
  let lo = 0, hi = keys.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (time(keys[mid]) <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

export function ballAt(keys: BallKey[], t: number): { p: XY; kmh: number; i: number } | null {
  const i = keyAt(keys, t);
  if (i < 0) return null;
  const a = keys[i], b = keys[i + 1];
  if (!b || b.t <= a.t) return { p: a.p, kmh: 0, i };
  const u = Math.min(1, (t - a.t) / (b.t - a.t));
  return { p: [a.p[0] + (b.p[0] - a.p[0]) * u, a.p[1] + (b.p[1] - a.p[1]) * u], kmh: b.kmh, i };
}

// 4-3-3 slots in the team's own frame, ball at the centre spot, team in possession
const SLOTS: Record<string, XY> = {
  GK: [6, 40], RB: [36, 70], RCB: [26, 50], LCB: [26, 30], LB: [36, 10], CDM: [42, 40],
  RCM: [56, 54], LCM: [56, 26], RW: [80, 68], LW: [80, 12], ST: [88, 40],
  // bench positions take over the slot of the player they replace
};

export interface OnPitch {
  player: Player;
  slot: XY;
  team: "home" | "away";
  teamId: string;
}

/** Who is on the pitch at clock t (subs and red cards applied). */
export function lineupAt(meta: MatchMeta, events: MatchEvent[], t: number): OnPitch[] {
  const all = new Map<string, Player>();
  for (const s of ["home", "away"] as const) for (const p of [...meta[s].lineup, ...meta[s].bench]) all.set(p.id, p);
  const on: OnPitch[] = [];
  for (const s of ["home", "away"] as const)
    for (const p of meta[s].lineup) on.push({ player: p, slot: SLOTS[p.position] ?? [50, 40], team: s, teamId: meta[s].id });
  const yellows = new Set<string>();
  for (const e of events) {
    if (e.clock_s > t) break;
    if (e.type === "Substitution" && e.player_id && e.sub_in_id) {
      const slot = on.find((o) => o.player.id === e.player_id);
      const incoming = all.get(e.sub_in_id);
      if (slot && incoming) slot.player = incoming;
    }
    if (e.type === "Card" && e.player_id) {
      const second = e.card === "Yellow" && yellows.has(e.player_id);
      yellows.add(e.player_id);
      if (e.card === "Red" || second) {
        const k = on.findIndex((o) => o.player.id === e.player_id);
        if (k >= 0) on.splice(k, 1);
      }
    }
  }
  return on;
}

/**
 * Target spot for an off-ball player. The block slides with the ball, pushes up
 * in possession and drops and narrows out of it. `wobble` adds a little life.
 */
export function slotTarget(o: OnPitch, ballOwn: XY, inPossession: boolean, wobble: number): XY {
  const [sx, sy] = o.slot;
  if (o.player.role === "GK") {
    const x = Math.max(2, Math.min(18, sx + (ballOwn[0] - 60) * 0.12));
    return [x, 40 + (ballOwn[1] - 40) * 0.12];
  }
  const depth = inPossession ? 1 : 0.72; // compact out of possession
  const push = inPossession ? 10 : -6;
  let x = 60 + (sx - 60) * depth + (ballOwn[0] - 60) * 0.55 + push;
  let y = 40 + (sy - 40) * (inPossession ? 1 : 0.8) + (ballOwn[1] - 40) * 0.3;
  x += Math.sin(wobble) * 1.2;
  y += Math.cos(wobble * 0.8) * 1.2;
  x = Math.max(3, Math.min(117, x));
  y = Math.max(2, Math.min(78, y));
  return [x, y];
}
