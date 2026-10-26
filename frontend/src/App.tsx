import { useCallback, useEffect, useMemo, useState } from "react";
import { AnalystPanel } from "./components/AnalystPanel";
import { FanPanel } from "./components/FanPanel";
import { MomentsFeed, OverlayLayer } from "./components/Moments";
import { MomentumStrip } from "./components/MomentumStrip";
import { Pitch } from "./components/Pitch";
import { PlayerPanel } from "./components/PlayerPanel";
import { Scoreboard } from "./components/Scoreboard";
import { Setup, type Choices, type Mode } from "./components/Setup";
import { SourceDrawer } from "./components/SourceDrawer";
import { connectDemo, loadDemoMatch } from "./feed/connect";
import { fetchFixtures, fetchMeta, LiveSocket, startBroadcast, type Fixture } from "./feed/live";
import type { MatchMeta } from "./feed/types";
import { STRINGS, type Locale } from "./i18n/strings";
import { applyTeamColors, type TeamPalette } from "./lib/teamColors";
import { useMatchFeed } from "./state/useMatchFeed";
import { playTime, type Breaks } from "./stats/time";

type Theme = "dark" | "light";
type Tab = "moments" | "stats";

const PALETTE_FALLBACK: TeamPalette = { home: "rgb(var(--home))", away: "rgb(var(--away))", onHome: "#fff", onAway: "#0B0F14" };
const DEFAULTS: Choices = { seed: 7, mode: "fan", team: "", player: "", locale: "en", metric: "", speed: 20 };

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
  const [screen, setScreen] = useState<"setup" | "live">("setup");
  const [choices, setChoices] = useState<Choices>(DEFAULTS);
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [setupMeta, setSetupMeta] = useState<MatchMeta | null>(null);
  const [offline, setOffline] = useState(false);
  const [starting, setStarting] = useState(false);
  const [runId, setRunId] = useState(0);
  const [theme, setTheme] = useState<Theme>("dark");
  const t = STRINGS[choices.locale];

  // fixtures from the backend; the bundled demo match if it is not reachable
  useEffect(() => {
    fetchFixtures()
      .then((f) => {
        setFixtures(f);
        if (f.length && !f.some((x) => x.seed === DEFAULTS.seed)) setChoices((c) => ({ ...c, seed: f[0].seed }));
      })
      .catch(async () => {
        const { meta } = await loadDemoMatch();
        setOffline(true);
        setFixtures([{ seed: meta.seed, match_id: meta.match_id, home: meta.home.name, away: meta.away.name, venue: meta.venue, kickoff_utc: meta.kickoff_utc, live: false }]);
        setChoices((c) => ({ ...c, seed: meta.seed }));
      });
  }, []);

  useEffect(() => {
    const load = offline ? loadDemoMatch().then((d) => d.meta) : fetchMeta(choices.seed);
    load.then(setSetupMeta).catch(() => setSetupMeta(null));
  }, [choices.seed, offline]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.lang = choices.locale;
  }, [theme, choices.locale]);

  const start = async () => {
    setStarting(true);
    try {
      if (!offline) await startBroadcast(choices.seed, choices.speed, true);
    } catch {
      setOffline(true);
    }
    setRunId((r) => r + 1);
    setScreen("live");
    setStarting(false);
  };

  const lang = choices.locale === "en" ? "en" : "es";
  const feedKey = `${screen}|${runId}|${choices.seed}|${choices.mode}|${lang}|${choices.team}|${choices.player}|${choices.metric}|${offline}`;
  const connect = useMemo(() => {
    if (screen !== "live") return null;
    if (offline) return () => connectDemo(choices.speed);
    const profile = {
      mode: choices.mode,
      lang: lang as "en" | "es",
      team: choices.team || undefined,
      player: choices.player || undefined,
      metric: choices.metric || undefined,
    };
    return () => Promise.resolve(new LiveSocket(choices.seed, profile, choices.speed));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedKey]);
  const feed = useMatchFeed(connect, feedKey, choices.speed);

  return (
    <div className="mx-auto flex min-h-full max-w-[1920px] flex-col gap-3 p-3 lg:h-screen lg:p-4">
      <TopBar
        screen={screen}
        mode={choices.mode}
        setMode={(mode) => setChoices({ ...choices, mode })}
        locale={choices.locale}
        setLocale={(locale) => setChoices({ ...choices, locale })}
        theme={theme}
        setTheme={setTheme}
        onChangeMatch={() => setScreen("setup")}
        onRestart={start}
        t={t}
      />
      {screen === "setup" ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Setup
            fixtures={fixtures}
            meta={setupMeta}
            choices={choices}
            setChoices={setChoices}
            onStart={start}
            starting={starting}
            offline={offline}
            t={t}
          />
        </div>
      ) : (
        <Live feed={feed} choices={choices} offline={offline} theme={theme} t={t} />
      )}
    </div>
  );
}

function Live({
  feed,
  choices,
  offline,
  theme,
  t,
}: {
  feed: ReturnType<typeof useMatchFeed>;
  choices: Choices;
  offline: boolean;
  theme: Theme;
  t: (typeof STRINGS)["en"];
}) {
  const [tab, setTab] = useState<Tab>("moments");
  const [statKey, setStatKey] = useState<string | null>(null);
  const [palette, setPalette] = useState<TeamPalette>(PALETTE_FALLBACK);
  const [slow, setSlow] = useState(false);
  const { meta, stats, breaks } = feed;

  useEffect(() => {
    if (meta) setPalette(applyTeamColors(meta));
  }, [meta, theme]);

  // say so when the feed is quiet: Event Hubs can take a while before the first event
  const hasEvents = feed.events.length > 0;
  useEffect(() => {
    setSlow(false);
    if (hasEvents) return;
    const id = window.setTimeout(() => setSlow(true), 6000);
    return () => window.clearTimeout(id);
  }, [hasEvents, feed.connected]);

  const clock = useMemo(() => clockParts(feed.clock, breaks), [feed.clock, breaks]);
  const playNow = playTime(feed.clock, breaks);
  const playHead = playTime(feed.liveHead, breaks);
  const onStat = useCallback((k: string) => setStatKey(k), []);
  const { seekClock } = feed;
  const jump = useCallback((c: number) => seekClock(Math.max(0, c)), [seekClock]);

  if (!meta)
    return (
      <div className="panel grid flex-1 place-items-center p-10 text-center text-lg text-muted">
        <div>
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-line border-t-accent" />
          {t.connecting}
        </div>
      </div>
    );

  const mode: Mode = choices.mode;
  const showStats = mode === "analyst" && tab === "stats";

  return (
    <>
      <Scoreboard meta={meta} stats={stats} clock={clock} isLive={feed.isLive} ended={feed.ended} palette={palette} t={t} onStat={onStat} />

      <main className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_440px]">
        <div className="flex min-h-0 min-w-0 flex-col gap-3">
          <div className="relative aspect-[105/68] w-full lg:aspect-auto lg:min-h-0 lg:flex-1">
            <Pitch feed={feed} palette={palette} t={t} focusPlayerId={choices.player || undefined}>
              <OverlayLayer cards={feed.cards} events={feed.events} clock={feed.clock} isLive={feed.isLive} palette={palette} meta={meta} t={t} />
            </Pitch>
            {!hasEvents && (
              <div className="absolute inset-0 grid place-items-center">
                <div className="rounded-lg bg-bg/90 px-6 py-4 text-center shadow-[var(--shadow)]">
                  <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-4 border-line border-t-accent" />
                  <div className="text-lg">{t.connecting}</div>
                  {slow && <div className="mt-1 text-sm text-muted">{t.slowFeed}</div>}
                </div>
              </div>
            )}
          </div>
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
            onSpeed={offline ? feed.setSpeed : undefined}
          />
        </div>

        <aside className="panel flex min-h-[420px] flex-col overflow-hidden lg:min-h-0">
          {offline && <p className="border-b border-line bg-warn/10 px-4 py-2 text-xs">{t.offline}</p>}
          {mode === "analyst" && (
            <div className="flex border-b border-line" role="tablist">
              {(["moments", "stats"] as Tab[]).map((k) => (
                <button
                  key={k}
                  role="tab"
                  aria-selected={tab === k}
                  onClick={() => setTab(k)}
                  className={`flex-1 py-2.5 text-sm font-semibold ${tab === k ? "border-b-2 border-accent text-ink" : "text-muted hover:text-ink"}`}
                >
                  {k === "moments" ? `${t.moments} · ${feed.cards.length}` : t.stats}
                </button>
              ))}
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {mode === "fan" && stats && <FanPanel meta={meta} stats={stats} locale={choices.locale} t={t} onStat={onStat} />}
            {mode === "player" && (
              <PlayerPanel meta={meta} events={feed.events} clock={Math.floor(feed.clock)} playerId={choices.player || undefined} palette={palette} t={t} />
            )}
            {showStats && stats ? (
              <AnalystPanel meta={meta} stats={stats} events={feed.events} palette={palette} t={t} onStat={onStat} />
            ) : (
              <>
                {mode !== "analyst" && <h3 className="eyebrow border-t border-line px-4 pt-3">{t.moments}</h3>}
                <MomentsFeed cards={feed.cards} big={mode === "fan"} t={t} palette={palette} meta={meta} onJump={jump} />
              </>
            )}
          </div>
        </aside>
      </main>

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
    </>
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
  screen: "setup" | "live";
  mode: Mode;
  setMode(m: Mode): void;
  locale: Locale;
  setLocale(l: Locale): void;
  theme: Theme;
  setTheme(t: Theme): void;
  onChangeMatch(): void;
  onRestart(): void;
  t: (typeof STRINGS)["en"];
}) {
  return (
    <nav className="flex flex-wrap items-center gap-2 lg:gap-3">
      <div className="num mr-auto text-lg font-bold uppercase tracking-wide">
        Match <span className="text-accent">Co-pilot</span>
        <span className="ml-2 hidden align-middle font-sans text-2xs font-semibold tracking-wider text-muted sm:inline">SYNTHETIC DATA</span>
      </div>
      {p.screen === "live" && (
        <>
          <Segmented label={p.t.mode} value={p.mode} onChange={p.setMode} options={[["fan", p.t.fan], ["analyst", p.t.analyst], ["player", p.t.player]]} />
          <button onClick={p.onChangeMatch} className="rounded px-3 py-1 text-sm font-semibold text-muted ring-1 ring-line hover:bg-raised">
            ⇆ {p.t.changeMatch}
          </button>
          <button onClick={p.onRestart} className="rounded px-3 py-1 text-sm font-semibold text-muted ring-1 ring-line hover:bg-raised">
            ↺ {p.t.restart}
          </button>
        </>
      )}
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
