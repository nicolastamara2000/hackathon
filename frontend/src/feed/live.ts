/**
 * The real feed: FastAPI's Server-Sent Events stream for one broadcast
 * (GET /api/live/{seed}/stream). Events arrive in the generator schema; the
 * stats object is built here with the same engine the mock uses.
 */
import { computeStats } from "../stats/engine";
import type { FeedSocket } from "./mockSocket";
import type { FeedMessage, MatchEvent, MatchMeta, MomentCard } from "./types";

export interface Profile {
  mode: "fan" | "analyst" | "player";
  lang: "en" | "es";
  team?: string;
  player?: string;
  metric?: string;
}

const STATS_DELAY_MS = 150;

export class LiveSocket implements FeedSocket {
  onmessage: ((m: FeedMessage) => void) | null = null;
  private es: EventSource | null = null;
  private meta: MatchMeta | null = null;
  private events: MatchEvent[] = [];
  private seen = new Set<number>();
  private statsTimer: number | undefined;

  constructor(
    private seed: number,
    private profile: Profile,
    private speed: number,
  ) {}

  start() {
    const q = new URLSearchParams({ mode: this.profile.mode, lang: this.profile.lang, events: "true", speed: String(this.speed) });
    if (this.profile.team) q.set("team", this.profile.team);
    if (this.profile.player) q.set("player", this.profile.player);
    if (this.profile.metric) q.set("metric", this.profile.metric);
    this.es = new EventSource(`/api/live/${this.seed}/stream?${q}`);
    this.es.onmessage = (ev) => this.handle(JSON.parse(ev.data));
  }

  setSpeed(speed: number) {
    // the broadcast keeps running; every viewer of it follows the new pace
    this.speed = speed;
    fetch(`/api/live/${this.seed}/speed?speed=${speed}`, { method: "POST" }).catch(() => {});
  }

  close() {
    this.es?.close();
    window.clearTimeout(this.statsTimer);
    this.onmessage = null;
  }

  private emit(m: FeedMessage) {
    this.onmessage?.(m);
  }

  private handle(msg: { type: string; [k: string]: unknown }) {
    switch (msg.type) {
      case "hello":
        this.meta = msg.meta as MatchMeta;
        this.events = [];
        this.seen.clear();
        this.emit({ type: "hello", meta: this.meta, speed: this.speed, agents: Boolean(msg.agents) });
        break;
      case "event": {
        const e = msg.event as MatchEvent;
        if (this.seen.has(e.index)) return; // history and live can overlap by a message
        this.seen.add(e.index);
        e.id ??= `${this.meta?.match_id}-${String(e.index).padStart(5, "0")}`;
        e.under_pressure ??= false;
        this.events.push(e);
        this.emit({ type: "event", event: e });
        this.emit({ type: "clock", clock_s: e.clock_s });
        this.scheduleStats();
        break;
      }
      case "card":
        this.emit({ type: "card", card: msg.card as MomentCard });
        break;
      case "end":
        this.pushStats();
        this.emit({ type: "end" });
        this.es?.close();
        break;
    }
  }

  // stats a few times a second at most: one timer per batch of events, so a goal shows within ~0.15 s
  private scheduleStats() {
    if (this.statsTimer !== undefined) return;
    this.statsTimer = window.setTimeout(() => {
      this.statsTimer = undefined;
      this.pushStats();
    }, STATS_DELAY_MS);
  }

  private pushStats() {
    if (!this.meta || !this.events.length) return;
    const clock = this.events[this.events.length - 1].clock_s;
    this.emit({ type: "stats", stats: computeStats(this.meta, this.events, clock) });
  }
}

/** POST /api/live/{seed}/start. `restart` begins the match again from kick-off. */
export async function startBroadcast(seed: number, speed: number, restart: boolean) {
  const r = await fetch(`/api/live/${seed}/start?speed=${speed}&restart=${restart}`, { method: "POST" });
  if (!r.ok) throw new Error(`start failed: ${r.status}`);
  return (await r.json()) as { match_id: string; speed: number; agents: boolean };
}

export interface Fixture {
  seed: number;
  match_id: string;
  home: string;
  away: string;
  venue: string;
  kickoff_utc: string;
  live: boolean;
}

export const fetchFixtures = async (): Promise<Fixture[]> => (await fetch("/api/matches")).json();
export const fetchEvents = async (seed: number, until?: number): Promise<MatchEvent[]> =>
  (await fetch(`/api/matches/${seed}/events${until !== undefined ? `?until=${until}` : ""}`)).json();
export const fetchMeta = async (seed: number): Promise<MatchMeta> => (await fetch(`/api/matches/${seed}`)).json();
