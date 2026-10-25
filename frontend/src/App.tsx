import { useEffect, useMemo, useState } from "react";
import { AnalystPanel } from "./components/AnalystPanel";
import { FanPanel } from "./components/FanPanel";
import { GoalOverlay } from "./components/GoalOverlay";
import { MomentumStrip } from "./components/MomentumStrip";
import { Pitch } from "./components/Pitch";
import { Scoreboard } from "./components/Scoreboard";
import { SourceDrawer } from "./components/SourceDrawer";
import { STRINGS, type Locale } from "./i18n/strings";
import { applyTeamColors, type TeamPalette } from "./lib/teamColors";
import { useMatchFeed } from "./state/useMatchFeed";
import { playTime, type Breaks } from "./stats/time";

type Mode = "analyst" | "fan";
type Theme = "dark" | "light";

const PALETTE_FALLBACK: TeamPalette = { home: "rgb(var(--home))", away: "rgb(var(--away))", onHome: "#fff", onAway: "#0B0F14" };

/** Clock on the scoreboard: 2nd half restarts at 45:00; the break shows 45:00 + HT. */
function clockParts(clock: number, b: Breaks) {
  if (b.hs2 !== undefined && clock >= b.hs2) {
    const s = 45 * 60 + (clock - b.hs2);
    return { minute: Math.floor(s / 60), second: Math.floor(s % 60), period: 2 };
  }
  if (b.he1 !== undefined && clock >= b.he1) return { minute: 45, second: 0, period: 1 };
  return { minute: Math.floor(clock / 60), second: Math.floor(clock % 60), period: 1 };
}

export default function App() {
  const feed = useMatchFeed(20);
  const [mode, setMode] = useState<Mode>("analyst");
  const [locale, setLocale] = useState<Locale>("en");
  const [theme, setTheme] = useState<Theme>("dark");
  const [statKey, setStatKey] = useState<string | null>(null);
  const [palette, setPalette] = useState<TeamPalette>(PALETTE_FALLBACK);
  const t = STRINGS[locale];

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.lang = locale;
    if (feed.meta) setPalette(applyTeamColors(feed.meta));
  }, [theme, locale, feed.meta]);

  const { meta, stats, breaks } = feed;
  const clock = useMemo(() => clockParts(feed.clock, breaks), [feed.clock, breaks]);
  const playNow = playTime(feed.clock, breaks);
  const playHead = playTime(feed.liveHead, breaks);

  if (!meta) return <div className="grid h-full place-items-center text-muted">{t.waiting}</div>;

  return (
    <div className="mx-auto flex min-h-full max-w-[1920px] flex-col gap-3 p-3 lg:h-screen lg:p-4">
      <TopBar mode={mode} setMode={setMode} locale={locale} setLocale={setLocale} theme={theme} setTheme={setTheme} t={t} />
      <Scoreboard meta={meta} stats={stats} clock={clock} isLive={feed.isLive} ended={feed.ended} palette={palette} t={t} onStat={setStatKey} />

      <main className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_420px]">
        <div className="relative aspect-[105/68] w-full min-w-0 lg:aspect-auto lg:h-full lg:min-h-0">
          <Pitch feed={feed} palette={palette} t={t} />
          <GoalOverlay stats={stats} meta={meta} palette={palette} t={t} />
        </div>
        <aside className="panel min-h-0 overflow-y-auto" aria-label={mode === "analyst" ? t.analyst : t.fan}>
          {stats ? (
            mode === "analyst" ? (
              <AnalystPanel meta={meta} stats={stats} events={feed.events} palette={palette} t={t} onStat={setStatKey} />
            ) : (
              <FanPanel meta={meta} stats={stats} locale={locale} t={t} onStat={setStatKey} />
            )
          ) : (
            <div className="p-6 text-muted">{t.waiting}</div>
          )}
        </aside>
      </main>

      <MomentumStrip
        meta={meta}
        stats={stats}
        liveStats={feed.liveStats}
        playNow={playNow}
        playHead={playHead}
        halfPlay={breaks.he1 ?? 45 * 60}
        isLive={feed.isLive}
        speed={feed.speed}
        palette={palette}
        t={t}
        onSeek={feed.seekPlay}
        onLive={feed.goLive}
        onSpeed={feed.setSpeed}
      />

      <SourceDrawer
        statKey={statKey}
        stats={stats}
        events={feed.events}
        meta={meta}
        t={t}
        onClose={() => setStatKey(null)}
        onJump={(c) => {
          setStatKey(null);
          feed.seekClock(c);
        }}
      />
    </div>
  );
}

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange(v: T): void; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex overflow-hidden rounded ring-1 ring-line">
      {options.map(([v, l]) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          aria-pressed={value === v}
          className={`px-3 py-1 text-sm font-semibold ${value === v ? "bg-ink text-bg" : "text-muted hover:bg-raised"}`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

function TopBar(p: {
  mode: Mode;
  setMode(m: Mode): void;
  locale: Locale;
  setLocale(l: Locale): void;
  theme: Theme;
  setTheme(t: Theme): void;
  t: (typeof STRINGS)["en"];
}) {
  return (
    <nav className="flex flex-wrap items-center gap-3">
      <div className="num mr-auto text-lg font-bold uppercase tracking-wide">
        Match <span className="text-accent">Co-pilot</span>
        <span className="ml-2 align-middle text-2xs font-sans font-semibold tracking-wider text-muted">SYNTHETIC DATA</span>
      </div>
      <Segmented label={p.t.mode} value={p.mode} onChange={p.setMode} options={[["analyst", p.t.analyst], ["fan", p.t.fan]]} />
      <Segmented label={p.t.language} value={p.locale} onChange={p.setLocale} options={[["en", "EN"], ["es-419", "ES"]]} />
      <button
        onClick={() => p.setTheme(p.theme === "dark" ? "light" : "dark")}
        aria-label={p.t.theme}
        title={p.t.theme}
        className="rounded px-3 py-1 text-sm font-semibold text-muted ring-1 ring-line hover:bg-raised"
      >
        {p.theme === "dark" ? "☾" : "☀"}
      </button>
    </nav>
  );
}
