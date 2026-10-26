import { memo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { MatchMeta } from "../feed/types";
import { fanLines, type Locale, type Strings } from "../i18n/strings";
import type { Side, StatsSnapshot } from "../stats/engine";

interface Props {
  meta: MatchMeta;
  stats: StatsSnapshot;
  locale: Locale;
  t: Strings;
  onStat(key: string): void;
}

const RECENT_S = 120; // a moment stays the headline for 2 minutes of play

/** Low density: one sentence, one big number, emojis, big type. */
export const FanPanel = memo(function FanPanel({ meta, stats, locale, t, onStat }: Props) {
  const L = fanLines[locale];
  const team = (s: Side) => meta[s].name;
  const latest = [...stats.keyMoments].reverse().find((k) => k.kind === "goal" || k.kind === "big_chance" || k.kind === "red");
  const fresh = latest && stats.play_s - latest.play_s <= RECENT_S ? latest : undefined;

  let emoji = "⚖️";
  let line = L.even();
  let side: Side = stats.winProb.home >= stats.winProb.away ? "home" : "away";
  let key = "winProb";
  if (fresh?.kind === "goal" && fresh.side) {
    emoji = "⚽";
    side = fresh.side;
    line = L.goal(fresh.player ?? "", team(fresh.side), stats.score[0], stats.score[1]);
    key = "score";
  } else if (fresh?.kind === "big_chance" && fresh.side) {
    emoji = "😱";
    side = fresh.side;
    line = L.bigChance(fresh.player ?? "", fresh.xg ?? 0);
    key = `${fresh.side}.xg`;
  } else if (fresh?.kind === "red") {
    emoji = "🟥";
    line = L.red(fresh.player ?? "");
  } else if (stats.controlChaos < -30) {
    emoji = "🌪️";
    line = L.chaos();
    key = "control";
  } else {
    const recentShots = (s: Side) =>
      stats.keyMoments.filter((k) => k.side === s && (k.kind === "shot" || k.kind === "big_chance" || k.kind === "goal") && stats.play_s - k.play_s <= 300).length;
    const hs = recentShots("home"), as = recentShots("away");
    if (Math.max(hs, as) >= 3) {
      side = hs >= as ? "home" : "away";
      emoji = "🔥";
      line = L.pushing(team(side), Math.max(hs, as));
      key = `${side}.shots`;
    } else if (stats.controlSide && stats.controlChaos > 30) {
      side = stats.controlSide;
      emoji = "🎯";
      line = L.control(team(side));
      key = "control";
    }
  }
  const big = Math.round(stats.winProb[side] * 100);

  return (
    <div className="flex flex-col gap-4 p-5">
      <AnimatePresence mode="wait">
        <motion.button
          key={line}
          onClick={() => onStat(key)}
          initial={{ x: 40, opacity: 0 }}
          animate={{ x: 0, opacity: 1, transition: { duration: 0.3, ease: [0.2, 0.8, 0.2, 1] } }}
          exit={{ opacity: 0, transition: { duration: 0.2 } }}
          className="text-left"
        >
          <div className="text-[56px] leading-none" aria-hidden>
            {emoji}
          </div>
          <p className="mt-3 text-tv-sm font-semibold leading-tight">{line}</p>
        </motion.button>
      </AnimatePresence>

      <button onClick={() => onStat("winProb")} className="rounded-lg bg-raised p-5 text-left">
        <div className="num text-tv-xl font-bold leading-none" style={{ color: `rgb(var(--${side}))` }}>
          {big}%
        </div>
        <div className="mt-2 text-lg text-muted">
          {meta[side].name} {t.fanBigLabel}
        </div>
      </button>

    </div>
  );
});
