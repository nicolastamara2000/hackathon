/**
 * Mirrors src/matchcopilot/generator/schema.py. Coordinates are 120 x 80 in the
 * frame of the team performing the action (it attacks towards x = 120).
 * `xg` and `pass_difficulty` are enrichment fields from the server-side models.
 */

export type EventType =
  | "Kick Off" | "Pass" | "Carry" | "Dribble" | "Pressure" | "Tackle" | "Interception"
  | "Ball Recovery" | "Shot" | "Goal Keeper" | "Foul Committed" | "Card" | "Substitution"
  | "Physical Update" | "Half Start" | "Half End";

export type Role = "GK" | "DEF" | "MID" | "FWD";

export interface Player {
  id: string;
  name: string;
  number: number;
  position: string;
  role: Role;
  top_speed_kmh: number;
  work_rate: number;
}

export interface Team {
  id: string;
  name: string;
  short_name: string;
  city: string;
  colors: [string, string];
  formation: string;
  strength: number;
  pressing: number;
  directness: number;
  lineup: Player[];
  bench: Player[];
}

export interface MatchMeta {
  match_id: string;
  seed: number;
  competition: string;
  matchday: number;
  kickoff_utc: string;
  venue: string;
  referee: string;
  weather: string;
  home: Team;
  away: Team;
}

export interface PlayerPhysical {
  player_id: string;
  distance_m: number;
  top_speed_kmh: number;
  sprints: number;
}

export type XY = [number, number];

export interface MatchEvent {
  id: string;
  index: number;
  match_id?: string;
  period: number;
  clock_s: number;
  minute: number;
  second: number;
  type: EventType;
  team_id?: string;
  player_id?: string;
  player_name?: string;
  possession: number;
  possession_team_id?: string;
  location?: XY;
  end_location?: XY;
  outcome?: string;
  under_pressure: boolean;
  recipient_id?: string;
  recipient_name?: string;
  pass_length_m?: number;
  pass_height?: "Ground" | "Low" | "High";
  ball_speed_kmh?: number;
  player_speed_kmh?: number;
  body_part?: string;
  card?: "Yellow" | "Red";
  sub_in_id?: string;
  sub_in_name?: string;
  score?: [number, number];
  physical?: PlayerPhysical[];
  // enrichment
  xg?: number;
  pass_difficulty?: number;
}

/** Messages on the live socket. Same envelope as the FastAPI SSE stream ("hello", "event"). */
export type FeedMessage =
  | { type: "hello"; meta: MatchMeta; speed: number }
  | { type: "event"; event: MatchEvent }
  | { type: "stats"; stats: import("../stats/engine").StatsSnapshot }
  | { type: "clock"; clock_s: number }
  | { type: "end" };
