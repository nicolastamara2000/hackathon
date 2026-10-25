import { MockMatchSocket, type FeedSocket } from "./mockSocket";
import type { FeedMessage, MatchEvent, MatchMeta } from "./types";

/**
 * Opens the live feed. Set VITE_FEED_URL (ws://...) to use a real socket that
 * sends the same JSON messages; otherwise the bundled synthetic match is replayed.
 */
export async function connectFeed(speed: number): Promise<FeedSocket> {
  const url = import.meta.env.VITE_FEED_URL as string | undefined;
  if (url) return new RemoteSocket(url);
  const { default: data } = await import("../mock/data/match-7.json");
  const { meta, events } = data as unknown as { meta: MatchMeta; events: MatchEvent[] };
  return new MockMatchSocket(meta, events, speed);
}

class RemoteSocket implements FeedSocket {
  onmessage: ((m: FeedMessage) => void) | null = null;
  private ws: WebSocket;
  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.onmessage = (ev) => this.onmessage?.(JSON.parse(ev.data) as FeedMessage);
  }
  start() {}
  setSpeed(speed: number) {
    this.ws.send(JSON.stringify({ type: "speed", speed }));
  }
  close() {
    this.ws.close();
  }
}
