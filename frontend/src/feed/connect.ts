import { MockMatchSocket, type FeedSocket } from "./mockSocket";
import type { MatchEvent, MatchMeta } from "./types";

/** The bundled match (generator seed 7), for the offline demo when the backend is not reachable. */
export async function loadDemoMatch(): Promise<{ meta: MatchMeta; events: MatchEvent[] }> {
  const { default: data } = await import("../mock/data/match-7.json");
  return data as unknown as { meta: MatchMeta; events: MatchEvent[] };
}

export async function connectDemo(speed: number): Promise<FeedSocket> {
  const { meta, events } = await loadDemoMatch();
  return new MockMatchSocket(meta, events, speed);
}
