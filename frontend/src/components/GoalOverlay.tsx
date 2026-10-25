import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import type { MatchMeta } from "../feed/types";
import type { Strings } from "../i18n/strings";
import type { TeamPalette } from "../lib/teamColors";
import type { KeyMoment, StatsSnapshot } from "../stats/engine";

const SHOW_MS = 6000;

/**
 * Lower-third goal banner over the pitch: slides in 300 ms, fades out 200 ms.
 * First piece of the overlay system (timing rules and the other overlay types come next).
 */
export function GoalOverlay({ stats, meta, palette, t }: { stats: StatsSnapshot | null; meta: MatchMeta; palette: TeamPalette; t: Strings }) {
  const [shown, setShown] = useState<KeyMoment | null>(null);
  const seen = useRef<string | null>(null);
  const goal = stats?.keyMoments.filter((k) => k.kind === "goal").at(-1);

  useEffect(() => {
    if (!goal || !stats || goal.id === seen.current) return;
    seen.current = goal.id;
    if (stats.play_s - goal.play_s > 20) return; // scrubbed far past it: no banner
    setShown(goal);
  }, [goal, stats]);

  useEffect(() => {
    if (!shown) return;
    const id = window.setTimeout(() => setShown(null), SHOW_MS);
    return () => window.clearTimeout(id);
  }, [shown]);

  const side = shown?.side ?? "home";
  return (
    <AnimatePresence>
      {shown && (
        <motion.div
          key={shown.id}
          initial={{ x: -60, opacity: 0 }}
          animate={{ x: 0, opacity: 1, transition: { duration: 0.3, ease: [0.2, 0.8, 0.2, 1] } }}
          exit={{ opacity: 0, transition: { duration: 0.2 } }}
          className="pointer-events-none absolute bottom-[8%] left-[4%] z-20 flex max-w-[92%] items-stretch overflow-hidden rounded shadow-[var(--shadow)]"
        >
          <div className="num flex items-center px-3 text-xl font-bold uppercase lg:px-4 lg:text-tv-md" style={{ background: palette[side], color: side === "home" ? palette.onHome : palette.onAway }}>
            {t.goal}
          </div>
          <div className="bg-bg/95 px-3 py-1.5 lg:px-4 lg:py-2">
            <div className="text-base font-semibold leading-tight lg:text-tv-sm">{shown.player}</div>
            <div className="num text-xs text-muted lg:text-lg">
              {meta[side].short_name} · {shown.minute}′ · xG {shown.xg?.toFixed(2)} · {shown.detail}
              {shown.winSwing !== undefined ? ` · ΔWin ${shown.winSwing > 0 ? "+" : ""}${shown.winSwing} pp` : ""}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
