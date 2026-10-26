import { AnimatePresence, motion } from "framer-motion";
import type { MatchMeta, Team } from "../feed/types";
import type { Strings } from "../i18n/strings";
import type { TeamPalette } from "../lib/teamColors";
import type { StatsSnapshot } from "../stats/engine";

interface Props {
  meta: MatchMeta;
  stats: StatsSnapshot | null;
  clock: { minute: number; second: number; period: number };
  isLive: boolean;
  ended: boolean;
  palette: TeamPalette;
  t: Strings;
  onStat(key: string): void;
}

/** Generated two-color shield with the club initials. Fictional clubs only, no real crests. */
export function Crest({ team, size = 40 }: { team: Team; size?: number }) {
  const [a, b] = team.colors;
  return (
    <svg width={size} height={size * 1.15} viewBox="0 0 40 46" aria-hidden className="shrink-0">
      <path d="M20 2 L37 8 V22 C37 33 29 40 20 44 C11 40 3 33 3 22 V8 Z" fill={a} stroke={b} strokeWidth={2.5} />
      <path d="M20 2 L37 8 V22 C37 33 29 40 20 44 Z" fill={b} opacity={0.22} />
      <text x={20} y={27} textAnchor="middle" fontSize={12} fontWeight={700} fill={b} className="font-display">
        {team.short_name}
      </text>
    </svg>
  );
}

export function Scoreboard({ meta, stats, clock, isLive, ended, palette, t, onStat }: Props) {
  const [h, a] = stats?.score ?? [0, 0];
  const wp = stats?.winProb ?? { home: 0.4, draw: 0.3, away: 0.3 };
  const periodLabel = ended ? t.ft : clock.period === 2 ? t.half2 : t.half1;
  return (
    <header className="panel flex flex-col gap-3 px-4 py-3 lg:px-6">
      <div className="flex items-center gap-3">
        <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 lg:gap-6">
          <TeamName team={meta.home} side="home" reds={stats?.home.reds ?? 0} />
          <button
            onClick={() => onStat("score")}
            className="num flex items-center gap-1 rounded px-1 text-tv-md leading-none lg:gap-2 lg:text-tv-lg"
            aria-label={`Score ${h} ${a}`}
          >
            <Digit value={h} />
            <span className="text-muted">–</span>
            <Digit value={a} />
          </button>
          <TeamName team={meta.away} side="away" reds={stats?.away.reds ?? 0} />
        </div>
        <div className="flex shrink-0 flex-col items-end">
          <div className="num text-tv-sm leading-none lg:text-tv-md">
            {String(clock.minute).padStart(2, "0")}:{String(clock.second).padStart(2, "0")}
          </div>
          <div className="mt-1 flex flex-col items-end gap-1 whitespace-nowrap text-xs text-muted sm:flex-row sm:items-center sm:gap-2">
            <span>{periodLabel}</span>
            <LivePill live={isLive && !ended} t={t} />
          </div>
        </div>
      </div>
      <WinProbBar wp={wp} meta={meta} palette={palette} t={t} onClick={() => onStat("winProb")} />
    </header>
  );
}

function TeamName({ team, side, reds }: { team: Team; side: "home" | "away"; reds: number }) {
  return (
    <div className={`flex min-w-0 items-center gap-2 ${side === "home" ? "flex-row-reverse justify-start text-right" : ""}`}>
      <Crest team={team} size={32} />
      <div className="min-w-0">
        <div className="num truncate text-xl font-semibold uppercase leading-tight lg:text-tv-sm">
          <span className="lg:hidden">{team.short_name}</span>
          <span className="hidden lg:inline">{team.name}</span>
        </div>
        <div className={`flex items-center gap-1 ${side === "home" ? "justify-end" : ""}`}>
          <span className={`h-1 w-8 rounded-full ${side === "home" ? "bg-home" : "bg-away"}`} />
          {Array.from({ length: reds }).map((_, i) => (
            <span key={i} className="h-3 w-2 rounded-[2px] bg-bad" title="Red card" />
          ))}
        </div>
      </div>
    </div>
  );
}

function Digit({ value }: { value: number }) {
  return (
    <span className="relative inline-block w-[0.62em] overflow-hidden text-center">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={value}
          initial={{ y: "-100%", opacity: 0 }}
          animate={{ y: 0, opacity: 1, transition: { duration: 0.3, ease: [0.2, 0.8, 0.2, 1] } }}
          exit={{ y: "100%", opacity: 0, transition: { duration: 0.2 } }}
          className="inline-block"
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

function LivePill({ live, t }: { live: boolean; t: Strings }) {
  return live ? (
    <span className="flex items-center gap-1.5 rounded-sm border border-live/60 px-1.5 py-0.5 text-2xs font-bold tracking-wider text-live">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-live" />
      {t.live}
    </span>
  ) : (
    <span className="rounded-sm border border-accent/60 px-1.5 py-0.5 text-2xs font-bold tracking-wider text-accent">{t.replay}</span>
  );
}

/** Home | draw | away, labels inside each segment; the draw is hatched so it never relies on color. */
export function WinProbBar({
  wp,
  meta,
  palette,
  t,
  onClick,
}: {
  wp: { home: number; draw: number; away: number };
  meta: MatchMeta;
  palette: TeamPalette;
  t: Strings;
  onClick?(): void;
}) {
  const segs = [
    { k: "home", v: wp.home, label: meta.home.short_name, bg: palette.home, fg: palette.onHome },
    { k: "draw", v: wp.draw, label: t.draw, bg: "rgb(var(--raised))", fg: "rgb(var(--ink))" },
    { k: "away", v: wp.away, label: meta.away.short_name, bg: palette.away, fg: palette.onAway },
  ];
  return (
    <button onClick={onClick} className="group flex w-full flex-col gap-1 text-left" aria-label={t.winProb}>
      <span className="eyebrow">{t.winProb}</span>
      <div className="flex h-7 w-full overflow-hidden rounded-sm ring-1 ring-line">
        {segs.map((s) => (
          <motion.div
            key={s.k}
            animate={{ width: `${Math.max(s.v * 100, 0.5)}%` }}
            transition={{ duration: 0.6, ease: [0.2, 0.8, 0.2, 1] }}
            className="relative flex items-center justify-center overflow-hidden"
            style={{
              background: s.bg,
              color: s.fg,
              backgroundImage:
                s.k === "draw" ? "repeating-linear-gradient(135deg, transparent 0 6px, rgb(var(--line)) 6px 8px)" : undefined,
            }}
          >
            {s.v > 0.04 && (
              <span className="num whitespace-nowrap px-1 text-sm font-semibold">
                {s.v > 0.12 ? `${s.label} ` : ""}
                {Math.round(s.v * 100)}%
              </span>
            )}
          </motion.div>
        ))}
      </div>
    </button>
  );
}
