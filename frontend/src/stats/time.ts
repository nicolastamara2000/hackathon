import type { MatchEvent } from "../feed/types";

/** Half-time break bounds on the match clock (clock_s keeps running through the break). */
export interface Breaks {
  he1?: number;
  hs2?: number;
}

export function findBreaks(events: MatchEvent[]): Breaks {
  const b: Breaks = {};
  for (const e of events) {
    if (e.type === "Half End" && e.period === 1) b.he1 = e.clock_s;
    if (e.type === "Half Start" && e.period === 2) b.hs2 = e.clock_s;
  }
  return b;
}

/** Seconds of play: the match clock with the half-time break cut out. Timeline x axis. */
export function playTime(clock: number, b: Breaks): number {
  if (b.he1 === undefined) return clock;
  if (b.hs2 === undefined || clock < b.hs2) return Math.min(clock, b.he1);
  return clock - (b.hs2 - b.he1);
}

/** Inverse of playTime, for scrubbing. */
export function clockAt(play: number, b: Breaks): number {
  if (b.he1 === undefined || play <= b.he1) return play;
  return b.hs2 === undefined ? b.he1 : play + (b.hs2 - b.he1);
}

export const fmtClock = (e: { minute: number; second: number }) =>
  `${String(e.minute).padStart(2, "0")}:${String(e.second).padStart(2, "0")}`;
