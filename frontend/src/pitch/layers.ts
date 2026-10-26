/**
 * Event maps drawn on the pitch: shots by xG, passes by difficulty, control zones,
 * sprints and touches. Pure builders: (meta, events up to now, filter) -> marks.
 *
 * Maps use a fixed frame (home attacks right all match) so both halves read
 * the same way, as on a broadcast or analyst board.
 */
import type { MatchEvent, MatchMeta, XY } from "../feed/types";
import type { Side } from "../stats/engine";
import { toDisplay } from "./motion";

export type Layer = "live" | "shots" | "passes" | "zones" | "speed" | "touches";
export const LAYERS: Layer[] = ["live", "shots", "passes", "zones", "speed", "touches"];

/** The setup metric picks the map that explains it. */
export const layerForMetric = (metric: string): Layer =>
  (({ xg: "shots", control: "zones", pass_difficulty: "passes", speed: "speed", distance: "touches" }) as Record<string, Layer>)[metric] ?? "live";

export interface MapFilter {
  side?: Side; // one team only
  playerId?: string; // one player only
}

const ON_BALL = new Set(["Pass", "Carry", "Dribble", "Shot", "Ball Recovery", "Interception", "Tackle"]);

export const fixed = (p: XY, teamId: string | undefined, meta: MatchMeta): XY => toDisplay(p, teamId, 1, meta.home.id);

export function sideOf(meta: MatchMeta, teamId?: string): Side | null {
  return teamId === meta.home.id ? "home" : teamId === meta.away.id ? "away" : null;
}

function keep(e: MatchEvent, meta: MatchMeta, f: MapFilter): boolean {
  if (f.playerId) return e.player_id === f.playerId;
  if (f.side) return sideOf(meta, e.team_id) === f.side;
  return true;
}

export interface ShotMark {
  id: string;
  clock_s: number;
  side: Side;
  p: XY;
  xg: number;
  outcome: string;
  player: string;
  minute: number;
}

export function shotMarks(meta: MatchMeta, events: MatchEvent[], f: MapFilter): ShotMark[] {
  return events
    .filter((e) => e.type === "Shot" && e.location && keep(e, meta, f))
    .map((e) => ({
      id: e.id,
      clock_s: e.clock_s,
      side: sideOf(meta, e.team_id) ?? "home",
      p: fixed(e.location!, e.team_id, meta),
      xg: e.xg ?? 0,
      outcome: e.outcome ?? "",
      player: e.player_name ?? "",
      minute: e.minute,
    }));
}

export interface PassMark {
  id: string;
  side: Side;
  a: XY;
  b: XY;
  difficulty: number;
  complete: boolean;
  progressive: boolean;
}

/** The most recent passes (all of them for one player), newest last. */
export function passMarks(meta: MatchMeta, events: MatchEvent[], f: MapFilter, limit = 160): PassMark[] {
  const out: PassMark[] = [];
  for (let i = events.length - 1; i >= 0 && out.length < limit; i--) {
    const e = events[i];
    if (e.type !== "Pass" || !e.location || !e.end_location || !keep(e, meta, f)) continue;
    out.push({
      id: e.id,
      side: sideOf(meta, e.team_id) ?? "home",
      a: fixed(e.location, e.team_id, meta),
      b: fixed(e.end_location, e.team_id, meta),
      difficulty: e.pass_difficulty ?? 0,
      complete: e.outcome === "Complete",
      progressive: e.end_location[0] - e.location[0] >= 25,
    });
  }
  return out.reverse();
}

export interface ZoneCell {
  col: number;
  row: number;
  home: number;
  away: number;
}

export const ZONE_COLS = 6;
export const ZONE_ROWS = 3;

/** Who owns each of 18 zones: on-ball actions per team over the last `windowS` of match clock. */
export function zoneControl(meta: MatchMeta, events: MatchEvent[], now: number, windowS = 600): ZoneCell[] {
  const cells: ZoneCell[] = [];
  for (let r = 0; r < ZONE_ROWS; r++) for (let c = 0; c < ZONE_COLS; c++) cells.push({ col: c, row: r, home: 0, away: 0 });
  for (const e of events) {
    if (now - e.clock_s > windowS || !ON_BALL.has(e.type) || !e.location) continue;
    const s = sideOf(meta, e.team_id);
    if (!s) continue;
    const [x, y] = fixed(e.location, e.team_id, meta);
    const c = Math.min(ZONE_COLS - 1, Math.floor((x / 120) * ZONE_COLS));
    const r = Math.min(ZONE_ROWS - 1, Math.floor((y / 80) * ZONE_ROWS));
    cells[r * ZONE_COLS + c][s]++;
  }
  return cells;
}

export interface SpeedMark {
  id: string;
  side: Side;
  p: XY;
  kmh: number;
  player: string;
  playerId: string;
}

export function speedMarks(meta: MatchMeta, events: MatchEvent[], f: MapFilter, min = 20): SpeedMark[] {
  return events
    .filter((e) => (e.player_speed_kmh ?? 0) >= min && e.location && e.player_id && keep(e, meta, f))
    .map((e) => ({
      id: e.id,
      side: sideOf(meta, e.team_id) ?? "home",
      p: fixed(e.location!, e.team_id, meta),
      kmh: e.player_speed_kmh!,
      player: e.player_name ?? "",
      playerId: e.player_id!,
    }));
}

export interface TouchCell {
  col: number;
  row: number;
  home: number;
  away: number;
}

export const TOUCH_COLS = 16;
export const TOUCH_ROWS = 10;

/** Touch density on a 16 x 10 grid, per team. */
export function touchGrid(meta: MatchMeta, events: MatchEvent[], f: MapFilter): TouchCell[] {
  const cells: TouchCell[] = [];
  for (let r = 0; r < TOUCH_ROWS; r++) for (let c = 0; c < TOUCH_COLS; c++) cells.push({ col: c, row: r, home: 0, away: 0 });
  for (const e of events) {
    if (!ON_BALL.has(e.type) || !e.location || !keep(e, meta, f)) continue;
    const s = sideOf(meta, e.team_id);
    if (!s) continue;
    const [x, y] = fixed(e.location, e.team_id, meta);
    const c = Math.min(TOUCH_COLS - 1, Math.floor((x / 120) * TOUCH_COLS));
    const r = Math.min(TOUCH_ROWS - 1, Math.floor((y / 80) * TOUCH_ROWS));
    cells[r * TOUCH_COLS + c][s]++;
  }
  return cells;
}

/** Latest physical snapshot per player id. */
export function physicalAt(events: MatchEvent[]) {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === "Physical Update" && e.physical) return new Map(e.physical.map((p) => [p.player_id, p]));
  }
  return new Map<string, NonNullable<MatchEvent["physical"]>[number]>();
}
