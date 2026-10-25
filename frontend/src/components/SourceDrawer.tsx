import { AnimatePresence, motion } from "framer-motion";
import { useMemo } from "react";
import type { MatchEvent, MatchMeta } from "../feed/types";
import type { Strings } from "../i18n/strings";
import type { StatsSnapshot } from "../stats/engine";
import { DifficultyBadge } from "./bits";

/** How each number is computed. Shown above its source events. */
const DEFINITIONS: Record<string, string> = {
  score: "Goals: shots with outcome Goal.",
  winProb: "Poisson model on the score and each side's remaining scoring rate (team strength prior blended with live xG pace). Goals move it most.",
  control: "Last 5 min. Control = possession share, pass completion, final-third actions and xG gap. Chaos = turnovers, duels and pressing per minute.",
  possession: "Share of time on the ball between events (gaps capped at 30 s). Listed: the first event of each possession.",
  fieldTilt: "Share of both teams' passes played from the final third.",
  ppda5: "Opponent passes in their own 60 % per defensive action (tackle, interception, foul) in that zone, last 5 min. Lower = more pressing.",
  xg: "Sum of shot xG. Logistic model on distance, angle, header and pressure, trained on 6,882 synthetic shots.",
  xt: "Expected threat added by completed passes and carries: xT(end) − xT(start) when positive.",
  shots: "All shots. On target = goals + saves.",
  passes: "All passes. Difficulty 0–100 = 100 × (1 − expected completion) from a model trained on 292,142 synthetic passes.",
  progressive: "Completed passes that move the ball 30 m closer to goal in own half, 15 m across halves, or 10 m in the final half.",
};

interface Props {
  statKey: string | null;
  stats: StatsSnapshot | null;
  events: MatchEvent[];
  meta: MatchMeta;
  t: Strings;
  onClose(): void;
  onJump(clock_s: number): void;
}

export function SourceDrawer({ statKey, stats, events, meta, t, onClose, onJump }: Props) {
  const byId = useMemo(() => new Map(events.map((e) => [e.id, e])), [events, events.length]);
  const [sideKey, metric] = statKey?.includes(".") ? statKey.split(".") : [null, statKey];
  const ids = statKey && stats ? stats.sources[statKey] ?? [] : [];
  const rows = ids.map((id) => byId.get(id)).filter(Boolean) as MatchEvent[];
  const title = sideKey ? `${meta[sideKey as "home" | "away"].short_name} · ${metric}` : metric;

  return (
    <AnimatePresence>
      {statKey && (
        <>
          <motion.div
            className="fixed inset-0 z-40 bg-black/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.2 } }}
            onClick={onClose}
          />
          <motion.aside
            role="dialog"
            aria-label={t.evidence}
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-line bg-surface shadow-[var(--shadow)]"
            initial={{ x: "100%" }}
            animate={{ x: 0, transition: { duration: 0.3, ease: [0.2, 0.8, 0.2, 1] } }}
            exit={{ x: "100%", opacity: 0, transition: { duration: 0.2 } }}
          >
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <div>
                <div className="eyebrow">{t.evidence}</div>
                <h2 className="num text-xl font-semibold uppercase">{title}</h2>
              </div>
              <button onClick={onClose} className="rounded px-3 py-1.5 text-sm ring-1 ring-line hover:bg-raised">
                {t.close}
              </button>
            </div>
            <p className="border-b border-line px-5 py-3 text-sm text-muted">{DEFINITIONS[metric ?? ""] ?? ""}</p>
            <ul className="flex-1 overflow-y-auto px-2 py-2">
              {rows.length === 0 && <li className="px-3 py-4 text-sm text-muted">{t.noEvidence}</li>}
              {rows.map((e) => (
                <li key={e.id} className="grid grid-cols-[44px_1fr_auto] items-center gap-2 rounded px-3 py-2 text-sm hover:bg-raised">
                  <span className="num text-muted">
                    {e.minute}′{String(e.second).padStart(2, "0")}
                  </span>
                  <span className="min-w-0">
                    <span className="font-semibold">{e.type}</span>
                    {e.outcome ? <span className="text-muted"> · {e.outcome}</span> : null}
                    <span className="block truncate text-xs text-muted">
                      {e.player_name}
                      {e.recipient_name ? ` → ${e.recipient_name}` : ""}
                      {e.ball_speed_kmh ? ` · ${Math.round(e.ball_speed_kmh)} km/h` : ""}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    {e.xg !== undefined && <span className="num">xG {e.xg.toFixed(2)}</span>}
                    {e.pass_difficulty !== undefined && <DifficultyBadge value={e.pass_difficulty} />}
                    <button onClick={() => onJump(e.clock_s - 3)} className="rounded px-2 py-0.5 text-xs text-accent ring-1 ring-accent/50">
                      {t.jump}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
            <div className="border-t border-line px-5 py-2 text-2xs text-muted">event id · {ids[0] ?? "–"}</div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
