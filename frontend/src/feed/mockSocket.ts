/**
 * A WebSocket stand-in that replays one generated match (our own Python
 * generator, exported by frontend/scripts/export_mock.py) at `speed` x real time.
 * It emits the same messages the backend will: hello, event, stats, clock, end.
 */
import { computeStats } from "../stats/engine";
import type { FeedMessage, MatchEvent, MatchMeta } from "./types";

export interface FeedSocket {
  onmessage: ((m: FeedMessage) => void) | null;
  /** Call after setting onmessage. */
  start(): void;
  close(): void;
  setSpeed(speed: number): void;
}

const TICK_MS = 100;
const STATS_EVERY_S = 5; // match seconds between stats pushes
const MAX_GAP_S = 20; // skip dead time (half-time) faster than real time

export class MockMatchSocket implements FeedSocket {
  onmessage: ((m: FeedMessage) => void) | null = null;
  private clock = 0;
  private i = 0;
  private lastStats = -Infinity;
  private timer: number | undefined;
  private last = performance.now();
  private closed = false;

  constructor(
    private meta: MatchMeta,
    private events: MatchEvent[],
    private speed = 20,
    startAt = 0,
  ) {
    this.clock = startAt;
  }

  start() {
    if (this.closed || this.timer !== undefined) return;
    this.last = performance.now();
    this.emit({ type: "hello", meta: this.meta, speed: this.speed });
    this.flush();
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
  }

  setSpeed(speed: number) {
    this.speed = speed;
    this.emit({ type: "hello", meta: this.meta, speed });
  }

  close() {
    this.closed = true;
    window.clearInterval(this.timer);
    this.onmessage = null;
  }

  private emit(m: FeedMessage) {
    this.onmessage?.(m);
  }

  private tick() {
    const now = performance.now();
    this.clock += ((now - this.last) / 1000) * this.speed;
    this.last = now;
    const next = this.events[this.i];
    if (next && next.clock_s - this.clock > MAX_GAP_S) this.clock = next.clock_s - 2;
    this.flush();
    this.emit({ type: "clock", clock_s: this.clock });
    if (this.i >= this.events.length) {
      this.emit({ type: "end" });
      window.clearInterval(this.timer);
    }
  }

  private flush() {
    let sent = false;
    while (this.i < this.events.length && this.events[this.i].clock_s <= this.clock) {
      this.emit({ type: "event", event: this.events[this.i++] });
      sent = true;
    }
    if (sent && this.clock - this.lastStats >= STATS_EVERY_S) {
      this.lastStats = this.clock;
      this.emit({ type: "stats", stats: computeStats(this.meta, this.events.slice(0, this.i), this.clock) });
    }
  }
}
