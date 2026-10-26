import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FeedSocket } from "../feed/mockSocket";
import type { MatchEvent, MatchMeta, MomentCard } from "../feed/types";
import { computeStats, type StatsSnapshot } from "../stats/engine";
import { clockAt, findBreaks, playTime, type Breaks } from "../stats/time";

/** The pitch runs this many match seconds behind the feed so the next event is known (like a broadcast delay). */
export const DISPLAY_LAG_S = 2;
const UI_HZ = 4;

export interface MatchFeed {
  meta: MatchMeta | null;
  events: MatchEvent[];
  version: number;
  breaks: Breaks;
  /** Match clock shown on screen, updated every frame (read it inside rAF). */
  clockRef: React.MutableRefObject<number>;
  /** Same clock, refreshed 4 times a second for React text. */
  clock: number;
  liveHead: number; // newest match second received
  isLive: boolean;
  ended: boolean;
  speed: number;
  stats: StatsSnapshot | null;
  /** newest stats object pushed by the feed (full match so far) */
  liveStats: StatsSnapshot | null;
  /** AI / template moments for this viewer, oldest first, latest version of each */
  cards: MomentCard[];
  /** true when the backend runs the agent crew (cards upgrade to AI text) */
  agents: boolean;
  connected: boolean;
  setSpeed(s: number): void;
  seekPlay(play_s: number): void;
  seekClock(clock_s: number): void;
  goLive(): void;
}

/**
 * One live feed for the whole screen. `connect` opens it (real SSE or the mock);
 * a new `feedKey` (other match, mode or language) reconnects and replays history.
 */
export function useMatchFeed(connect: (() => Promise<FeedSocket>) | null, feedKey: string, initialSpeed = 20): MatchFeed {
  const [meta, setMeta] = useState<MatchMeta | null>(null);
  const cardsRef = useRef(new Map<string, MomentCard>());
  const [cards, setCards] = useState<MomentCard[]>([]);
  const [agents, setAgents] = useState(false);
  const [connected, setConnected] = useState(false);
  const eventsRef = useRef<MatchEvent[]>([]);
  const [version, setVersion] = useState(0);
  const [liveStats, setLiveStats] = useState<StatsSnapshot | null>(null);
  const [speed, setSpeedState] = useState(initialSpeed);
  const [ended, setEnded] = useState(false);
  const [isLive, setIsLive] = useState(true);
  const [clock, setClock] = useState(0);
  const [liveHead, setLiveHead] = useState(0);
  const sock = useRef<FeedSocket | null>(null);
  const feedClock = useRef({ clock: 0, at: performance.now() });
  const clockRef = useRef(0);
  const replayAnchor = useRef({ clock: 0, at: 0 });
  const speedRef = useRef(initialSpeed);
  const liveRef = useRef(true);

  useEffect(() => {
    if (!connect) return;
    let alive = true;
    let pending = false;
    const reset = () => {
      eventsRef.current = [];
      cardsRef.current = new Map();
      setCards([]);
      setLiveStats(null);
      setEnded(false);
      feedClock.current = { clock: 0, at: performance.now() };
      liveRef.current = true;
      setIsLive(true);
      setVersion((v) => v + 1);
    };
    reset();
    setConnected(false);
    connect().then((s) => {
      if (!alive) return s.close();
      sock.current = s;
      s.onmessage = (m) => {
        switch (m.type) {
          case "hello":
            reset();
            setMeta(m.meta);
            setAgents(Boolean(m.agents));
            setConnected(true);
            speedRef.current = m.speed;
            setSpeedState(m.speed);
            break;
          case "card": {
            const prev = cardsRef.current.get(m.card.card_id);
            if (!prev || prev.version <= m.card.version) {
              cardsRef.current.set(m.card.card_id, m.card);
              setCards([...cardsRef.current.values()].sort((a, b) => a.clock_s - b.clock_s));
            }
            break;
          }
          case "event":
            eventsRef.current.push(m.event);
            if (!pending) {
              pending = true;
              requestAnimationFrame(() => {
                pending = false;
                setVersion((v) => v + 1);
              });
            }
            break;
          case "clock":
            feedClock.current = { clock: m.clock_s, at: performance.now() };
            break;
          case "stats":
            setLiveStats(m.stats);
            break;
          case "end":
            setEnded(true);
            break;
        }
      };
      s.start();
    });
    return () => {
      alive = false;
      sock.current?.close();
      sock.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedKey]);

  // one clock for the whole screen
  useEffect(() => {
    let raf = 0;
    let lastUi = 0;
    const loop = (now: number) => {
      const f = feedClock.current;
      const head = f.clock + Math.min(3, (now - f.at) / 1000) * speedRef.current; // keep ticking through quiet spells (goal celebrations)
      let c: number;
      if (liveRef.current) c = Math.max(0, head - DISPLAY_LAG_S);
      else {
        // replay keeps playing forward from the scrub point, until it meets live
        const r = replayAnchor.current;
        c = r.clock + ((now - r.at) / 1000) * speedRef.current;
        if (c >= head - DISPLAY_LAG_S) {
          liveRef.current = true;
          setIsLive(true);
        }
      }
      clockRef.current = c;
      if (now - lastUi > 1000 / UI_HZ) {
        lastUi = now;
        setClock(c);
        setLiveHead(head);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const breaks = useMemo(() => findBreaks(eventsRef.current), [version]);

  const seekClock = useCallback((c: number) => {
    const head = feedClock.current.clock - DISPLAY_LAG_S;
    if (c >= head) {
      liveRef.current = true;
      setIsLive(true);
      return;
    }
    replayAnchor.current = { clock: Math.max(0, c), at: performance.now() };
    clockRef.current = Math.max(0, c);
    setClock(clockRef.current);
    liveRef.current = false;
    setIsLive(false);
  }, []);

  const seekPlay = useCallback((p: number) => seekClock(clockAt(p, findBreaks(eventsRef.current))), [seekClock]);
  const goLive = useCallback(() => {
    liveRef.current = true;
    setIsLive(true);
  }, []);
  const setSpeed = useCallback((s: number) => {
    speedRef.current = s;
    setSpeedState(s);
    replayAnchor.current = { clock: clockRef.current, at: performance.now() };
    sock.current?.setSpeed(s);
  }, []);

  // live: trust the pushed stats object; replay: rebuild it for the scrubbed second
  const replaySecond = Math.floor(clock);
  const stats = useMemo(() => {
    if (!meta) return null;
    if (isLive && liveStats) return liveStats;
    return computeStats(meta, eventsRef.current, isLive ? clock : replaySecond);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta, isLive, liveStats, isLive ? version : replaySecond]);

  return {
    meta,
    events: eventsRef.current,
    version,
    breaks,
    clockRef,
    clock,
    liveHead,
    isLive,
    ended,
    speed,
    stats,
    liveStats,
    cards,
    agents,
    connected,
    setSpeed,
    seekPlay,
    seekClock,
    goLive,
  };
}

export { playTime };
