import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import type { MatchEvent, MatchMeta, MomentCard } from "../feed/types";
import type { Strings } from "../i18n/strings";
import type { TeamPalette } from "../lib/teamColors";

/** Icon and overlay priority (1–5) per card kind from narration/cards.py. */
export const KIND: Record<string, { icon: string; priority: number }> = {
  goal: { icon: "⚽", priority: 5 },
  full_time: { icon: "🏁", priority: 5 },
  half_time: { icon: "⏸️", priority: 5 },
  big_chance: { icon: "😱", priority: 4 },
  card: { icon: "🟨", priority: 3 },
  control_shift: { icon: "⚖️", priority: 3 },
  rocket_shot: { icon: "🚀", priority: 3 },
  hard_pass: { icon: "🎯", priority: 2 },
  speed_alert: { icon: "⚡", priority: 2 },
  substitution: { icon: "🔁", priority: 2 },
  distance_milestone: { icon: "🏃", priority: 1 },
};
const kindOf = (k: string) => KIND[k] ?? { icon: "•", priority: 1 };

const fmtMetric = (k: string, v: unknown) => {
  if (typeof v === "number") {
    if (k.includes("kmh")) return `${Math.round(v)} km/h`;
    if (k.endsWith("_m")) return `${Math.round(v)} m`;
    if (k === "xg" || k === "control" || k === "chaos") return v.toFixed(2);
    if (k.startsWith("possession")) return `${Math.round(v * 100)}%`;
    return Number.isInteger(v) ? String(v) : v.toFixed(2);
  }
  if (Array.isArray(v)) return v.join("–");
  if (v && typeof v === "object") return Object.entries(v as Record<string, number>).map(([a, b]) => `${a} ${typeof b === "number" ? Math.round(b * 100) + "%" : b}`).join(" · ");
  return String(v);
};

/** The moments feed: the backend's cards (template first, upgraded in place by the agents), newest on top. */
export function MomentsFeed({
  cards,
  big,
  t,
  palette,
  meta,
  onJump,
}: {
  cards: MomentCard[];
  big?: boolean;
  t: Strings;
  palette: TeamPalette;
  meta: MatchMeta;
  onJump(clock_s: number): void;
}) {
  const list = [...cards].reverse();
  if (!list.length) return <p className="p-5 text-muted">{t.momentsEmpty}</p>;
  return (
    <ol className="flex flex-col gap-2 p-3">
      <AnimatePresence initial={false}>
        {list.map((c) => {
          const side = c.team_id === meta.home.id ? "home" : c.team_id === meta.away.id ? "away" : null;
          const metrics = Object.entries(c.metrics ?? {}).slice(0, 4);
          return (
            <motion.li
              key={c.card_id}
              layout
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0, transition: { duration: 0.3, ease: [0.2, 0.8, 0.2, 1] } }}
              exit={{ opacity: 0, transition: { duration: 0.2 } }}
            >
              <button
                onClick={() => onJump(c.clock_s - 6)}
                className="w-full rounded-lg border border-line bg-raised/40 p-3 text-left transition hover:bg-raised"
                style={{ borderLeft: `4px solid ${side ? palette[side] : "rgb(var(--line))"}` }}
              >
                <div className="flex items-center gap-2 text-xs text-muted">
                  <span className="num text-base text-ink">{c.minute}′</span>
                  <span aria-hidden>{kindOf(c.kind).icon}</span>
                  {c.your_team && <span className="rounded-sm bg-accent/15 px-1.5 text-accent">{t.yourTeam}</span>}
                  {c.your_player && <span className="rounded-sm bg-accent/15 px-1.5 text-accent">{t.yourPlayer}</span>}
                  <span
                    className={`ml-auto rounded-sm px-1.5 py-px text-2xs font-bold tracking-wider ${c.source === "agents" ? "bg-accent text-bg" : "ring-1 ring-line"}`}
                    title={c.source === "agents" ? "Written by the agent crew" : "Instant template card"}
                  >
                    {c.source === "agents" ? `✦ ${t.aiBadge}` : t.liveBadge}
                  </span>
                </div>
                <p className={`mt-1 font-semibold leading-snug ${big ? "text-xl" : "text-base"}`}>{c.headline}</p>
                {c.body && <p className={`mt-1 text-muted ${big ? "text-base" : "text-sm"}`}>{c.body}</p>}
                {!big && metrics.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {metrics.map(([k, v]) => (
                      <span key={k} className="num rounded-sm bg-bg px-1.5 py-0.5 text-xs">
                        <span className="font-sans text-muted">{k.replace(/_(kmh|m)$/, "").replace(/_/g, " ")}</span> {fmtMetric(k, v)}
                      </span>
                    ))}
                  </div>
                )}
              </button>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ol>
  );
}

const MIN_GAP_MS = 20_000; // at most one overlay every 20 s
const SHOT_SEQUENCE_S = 4; // no overlay while a shot is being played out

/**
 * Broadcast overlay over the pitch, driven by the moment cards.
 * Rules: shows 4–8 s, at most one every 20 s (goals and whistles jump the queue),
 * none during a shot sequence; slides in 300 ms, fades out 200 ms.
 */
export function OverlayLayer({
  cards,
  events,
  clock,
  isLive,
  palette,
  meta,
  t,
  compact = false,
}: {
  cards: MomentCard[];
  events: MatchEvent[];
  clock: number;
  isLive: boolean;
  palette: TeamPalette;
  meta: MatchMeta;
  t: Strings;
  /** half-width pitch (a map is open beside it): no TV-size type */
  compact?: boolean;
}) {
  const xl = (cls: string) => (compact ? "" : cls);
  const [shown, setShown] = useState<MomentCard | null>(null);
  const done = useRef(new Set<string>());
  const lastAt = useRef(-Infinity);

  useEffect(() => {
    if (!isLive || shown) return;
    const due = cards.filter((c) => !done.current.has(c.card_id) && c.clock_s <= clock + 1);
    // stale ones (joined late, or older than 30 s of play) are marked seen, never shown
    for (const c of due) if (clock - c.clock_s > 30) done.current.add(c.card_id);
    const fresh = due.filter((c) => clock - c.clock_s <= 30);
    if (!fresh.length) return;
    const best = fresh.reduce((a, b) => (kindOf(b.kind).priority > kindOf(a.kind).priority ? b : a));
    const urgent = kindOf(best.kind).priority >= 5;
    const now = performance.now();
    if (!urgent && now - lastAt.current < MIN_GAP_MS) return;
    const shot = [...events].reverse().find((e) => e.clock_s <= clock && clock - e.clock_s <= SHOT_SEQUENCE_S && e.type === "Shot");
    if (shot && best.kind !== "goal") return;
    fresh.forEach((c) => done.current.add(c.card_id));
    lastAt.current = now;
    setShown(best);
  }, [cards, clock, isLive, shown, events]);

  useEffect(() => {
    if (!shown) return;
    const ms = Math.min(8, Math.max(4, shown.duration_s)) * 1000;
    const id = window.setTimeout(() => setShown(null), ms);
    return () => window.clearTimeout(id);
  }, [shown]);

  const side = shown?.team_id === meta.away.id ? "away" : "home";
  const full = shown?.placement === "full_screen";
  const topRight = shown?.placement === "top_bar" || shown?.placement === "side_panel";
  return (
    <AnimatePresence>
      {shown && (
        <motion.div
          key={shown.card_id}
          initial={full ? { scale: 0.9, opacity: 0 } : { x: topRight ? 60 : -60, opacity: 0 }}
          animate={{ x: 0, scale: 1, opacity: 1, transition: { duration: 0.3, ease: [0.2, 0.8, 0.2, 1] } }}
          exit={{ opacity: 0, transition: { duration: 0.2 } }}
          className={`pointer-events-none absolute z-20 ${
            full ? "inset-0 flex items-center justify-center p-[8%] text-center" : topRight ? "right-[3%] top-[5%] max-w-[46%]" : "bottom-[7%] left-[3%] max-w-[78%]"
          }`}
        >
          <div className="flex items-stretch overflow-hidden rounded-lg shadow-[var(--shadow)]">
            {!full && (
              <div
                className={`grid place-items-center px-3 text-2xl ${xl("lg:px-4 lg:text-tv-md")}`}
                style={{ background: shown.team_id ? palette[side] : "rgb(var(--accent))" }}
                aria-hidden
              >
                {kindOf(shown.kind).icon}
              </div>
            )}
            <div className={`bg-bg/95 ${full ? `w-full px-4 py-3 ${xl("xl:px-6 xl:py-6")}` : `px-3 py-2 ${xl("xl:px-4 xl:py-3")}`}`}>
              {full && <div className={`text-3xl ${xl("xl:text-tv-md")}`}>{kindOf(shown.kind).icon}</div>}
              <div className={`font-semibold leading-tight ${full ? `text-base sm:text-xl ${xl("xl:text-tv-md")}` : `text-sm sm:text-base ${xl("xl:text-tv-sm")}`}`}>{shown.headline}</div>
              {shown.body && <div className={`mt-1 text-muted ${full ? `text-sm sm:text-base ${xl("xl:text-tv-sm")}` : `text-xs ${xl("xl:text-lg")}`}`}>{shown.body}</div>}
              <div className="mt-1 text-2xs uppercase tracking-wider text-muted">
                {shown.minute}′ · {shown.source === "agents" ? `✦ ${t.aiBadge}` : t.liveBadge}
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
