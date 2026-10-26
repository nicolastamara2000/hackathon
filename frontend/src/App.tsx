import { useCallback, useEffect, useMemo, useState } from "react";
import { AnalystPanel } from "./components/AnalystPanel";
import { FanPanel } from "./components/FanPanel";
import { MomentsFeed, OverlayLayer } from "./components/Moments";
import { MomentumStrip } from "./components/MomentumStrip";
import { Pitch } from "./components/Pitch";
import { PlayerPanel } from "./components/PlayerPanel";
import { Scoreboard } from "./components/Scoreboard";
import { METRICS, Setup, type Choices, type Mode } from "./components/Setup";
import { SourceDrawer } from "./components/SourceDrawer";
import { Spotlight } from "./components/Spotlight";
import { KIND } from "./components/Moments";
import { LAYERS, layerForMetric, type Layer } from "./pitch/layers";
import { TPCard, TPFanLine, TPTimeline } from "./components/TurningPoints";
import { EventFeed } from "./components/EventFeed";
import { MatchStory } from "./components/MatchStory";
import { AIPlayerReportCard } from "./components/AIWriter";
import { playerFacts } from "./stats/aiFacts";
import { tpText } from "./i18n/turning";
import { turningPoints, type TurningPoint } from "./stats/turning";
import { connectDemo, loadDemoMatch } from "./feed/connect";
import { fetchFixtures, fetchMeta, LiveSocket, startBroadcast, type Fixture } from "./feed/live";
import type { MatchEvent, MatchMeta, MomentCard } from "./feed/types";
import { STRINGS, type Locale } from "./i18n/strings";
import { applyTeamColors, type TeamPalette } from "./lib/teamColors";
import { useMatchFeed } from "./state/useMatchFeed";
import { playTime, type Breaks } from "./stats/time";

type Theme = "dark" | "light";
type Tab = "turning" | "story" | "events" | "stats" | "moments";

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
  const [metas, setMetas] = useState<Record<number, MatchMeta>>({});
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

  // every fixture's teams, for crests on the match picker
  useEffect(() => {
    for (const f of fixtures) {
      const load = offline ? loadDemoMatch().then((d) => d.meta) : fetchMeta(f.seed);
      load.then((m) => setMetas((all) => ({ ...all, [f.seed]: m }))).catch(() => undefined);
    }
  }, [fixtures, offline]);

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
    // the metric is a display choice: switching it live must not reconnect the stream
  const feedKey = `${screen}|${runId}|${choices.seed}|${choices.mode}|${lang}|${choices.team}|${choices.player}|${offline}`;
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
        metric={choices.metric}
        setMetric={(metric) => setChoices({ ...choices, metric })}
        locale={choices.locale}
        setLocale={(locale) => setChoices({ ...choices, locale })}
        theme={theme}
        setTheme={setTheme}
        onHome={() => setScreen("setup")}
        onRestart={start}
        t={t}
      />
      {screen === "setup" ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Setup
            fixtures={fixtures}
            metas={metas}
            choices={choices}
            setChoices={setChoices}
            onStart={start}
            starting={starting}
            offline={offline}
            t={t}
          />
        </div>
      ) : (
        <Live
          feed={feed}
          choices={choices}
          offline={offline}
          theme={theme}
          t={t}
          // remember the pace so a reconnect (mode or language switch) keeps it
          onSpeed={(speed) => {
            feed.setSpeed(speed);
            setChoices((c) => ({ ...c, speed }));
          }}
        />
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
  onSpeed,
}: {
  onSpeed(speed: number): void;
  feed: ReturnType<typeof useMatchFeed>;
  choices: Choices;
  offline: boolean;
  theme: Theme;
  t: (typeof STRINGS)["en"];
}) {
  const [tab, setTab] = useState<Tab>("turning");
  const [tpId, setTpId] = useState<string | null>(null);
  const defaultLayer: Layer = choices.mode === "player" ? "touches" : layerForMetric(choices.metric);
  const [layer, setLayer] = useState<Layer>(defaultLayer);
  const [mapSide, setMapSide] = useState<"home" | "away" | undefined>(undefined);
  useEffect(() => setLayer(defaultLayer), [defaultLayer, choices.mode]);
  // map time window: sprints and zones read best recent, shots and passes over the match
  const [win, setWin] = useState<MapWindow>("match");
  useEffect(() => setWin(layer === "speed" || layer === "zones" ? "15" : "match"), [layer]);
  const [statKey, setStatKey] = useState<string | null>(null);
  // Player focus picks its player here, not on the landing page; switching does not reconnect the feed
  const [focusId, setFocusId] = useState(choices.player);
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
  // the engine re-runs every 5 s of match clock (and on every scrub): the timeline always matches the playhead
  const tick = Math.floor(feed.clock / 5);
  const tps = useMemo(() => (meta ? turningPoints(meta, feed.events, feed.clock) : []), [meta, feed.version, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const selectedTp = tps.find((x) => x.id === tpId) ?? null;
  const showTp = useCallback((tp: TurningPoint) => {
    setTpId(tp.id);
    setLayer("insight");
  }, []);

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
  const teamSide = choices.team === meta.home.id ? "home" : choices.team === meta.away.id ? "away" : undefined;
  // Player focus always follows someone: the pick, else the favorite club's (or home) striker
  const focusTeam = meta[teamSide ?? "home"];
  const playerId = focusId || choices.player || (mode === "player" ? (focusTeam.lineup.find((p) => p.role === "FWD") ?? focusTeam.lineup[0]).id : "");
  const cut = feed.events.filter((e) => e.clock_s <= feed.clock);
  const connecting = !hasEvents && (
    <div className="absolute inset-0 grid place-items-center">
      <div className="rounded-lg bg-bg/90 px-6 py-4 text-center shadow-[var(--shadow)]">
        <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-4 border-line border-t-accent" />
        <div className="text-lg">{t.connecting}</div>
        {slow && <div className="mt-1 text-sm text-muted">{t.slowFeed}</div>}
      </div>
    </div>
  );
  const now = Math.floor(feed.clock);
  const half2 = cut.find((e) => e.period === 2)?.clock_s;
  const mapFrom = win === "5" ? now - 300 : win === "15" ? now - 900 : win === "half" ? half2 ?? 0 : 0;
  const live = (compact: boolean) => (
    <div className="relative aspect-[105/68] w-full lg:aspect-auto lg:min-h-0 lg:flex-1">
      <Pitch feed={feed} palette={palette} t={t} focusPlayerId={playerId || undefined} onPick={jump}>
        <OverlayLayer cards={feed.cards} events={feed.events} clock={feed.clock} isLive={feed.isLive} palette={palette} meta={meta} t={t} compact={compact} />
      </Pitch>
      {connecting}
    </div>
  );
  // the live picture is never covered: a map opens beside it (below it on small screens)
  const pitch = (withLayers: boolean) => {
    const mapLayer: Layer = withLayers ? layer : layer === "insight" && selectedTp ? "insight" : "live";
    return (
      <>
        {withLayers && (
          <LayerBar layer={layer} setLayer={setLayer} side={mapSide} setSide={mode === "player" ? undefined : setMapSide} meta={meta} t={t} hasInsight={!!selectedTp} />
        )}
        {mapLayer === "live" ? (
          live(false)
        ) : (
          <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-2">
            <div className="flex min-h-0 flex-col gap-1">
              <div className="eyebrow flex h-7 items-center gap-1.5"><span className="h-2 w-2 animate-pulse rounded-full bg-live" /> {t.liveView}</div>
              {live(true)}
            </div>
            <div className="flex min-h-0 flex-col gap-1">
              <div className="flex h-7 items-center gap-2">
                <span className="eyebrow">{t.mapView}</span>
                {mapLayer !== "insight" && (
                  <div role="group" aria-label={t.mapView} className="ml-auto flex overflow-hidden rounded ring-1 ring-line">
                    {(["5", "15", "half", "match"] as MapWindow[]).map((w) => (
                      <button key={w} onClick={() => setWin(w)} aria-pressed={win === w} className={`px-2 py-0.5 text-xs font-semibold ${win === w ? "bg-ink text-bg" : "text-muted hover:bg-raised"}`}>
                        {w === "5" ? t.win5 : w === "15" ? t.win15 : w === "half" ? t.winHalf : t.winMatch}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="relative aspect-[105/68] w-full lg:aspect-auto lg:min-h-0 lg:flex-1">
                <Pitch
                  feed={feed}
                  palette={palette}
                  t={t}
                  layer={mapLayer}
                  insight={selectedTp}
                  filter={mode === "player" ? { playerId } : { side: mapSide }}
                  onPick={jump}
                  mapOnly
                  mapFrom={mapLayer === "insight" ? 0 : Math.max(0, mapFrom)}
                />
              </div>
            </div>
          </div>
        )}
      </>
    );
  };
  const strip = (
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
      onSpeed={onSpeed}
      turning={tps
        .filter((x) => x.impact !== "low")
        .map((x) => ({ id: x.id, play_s: x.play_s, side: x.side, impact: x.impact, minute: x.minute, label: tpText(x, meta, choices.locale).headline }))}
      selectedTurning={tpId}
      onTurning={(id) => {
        const tp = tps.find((x) => x.id === id);
        if (tp) {
          showTp(tp);
          setTab("turning");
        }
      }}
    />
  );
  const spotlight = (simple: boolean) =>
    stats && (
      <Spotlight
        metric={choices.metric}
        meta={meta}
        stats={stats}
        events={cut}
        palette={palette}
        locale={choices.locale}
        t={t}
        simple={simple}
        playerId={mode === "player" ? playerId : undefined}
        onJump={jump}
      />
    );
  const offlineNote = offline && <p className="border-b border-line bg-warn/10 px-4 py-2 text-xs">{t.offline}</p>;

  return (
    <>
      <Scoreboard meta={meta} stats={stats} clock={clock} isLive={feed.isLive} ended={feed.ended} palette={palette} t={t} onStat={onStat} />

      {mode === "fan" && (
        // Fan: TV picture, one big sentence, big numbers, the last three moments as cards. No tabs, no charts.
        <main className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_400px]">
          <div className="flex min-h-0 min-w-0 flex-col gap-3">
            {pitch(false)}
            <FanMoments cards={feed.cards} meta={meta} palette={palette} t={t} onJump={jump} />
          </div>
          <aside className="panel flex min-h-0 flex-col overflow-y-auto">
            {offlineNote}
            {stats && <FanPanel meta={meta} stats={stats} locale={choices.locale} t={t} onStat={onStat} />}
            <TPFanLine
              tp={[...tps].reverse().find((x) => x.impact !== "low" && x.status !== "faded")}
              meta={meta}
              locale={choices.locale}
              palette={palette}
              onShow={(tp) => (selectedTp?.id === tp.id && layer === "insight" ? setLayer("live") : showTp(tp))}
            />
            {spotlight(true)}
          </aside>
        </main>
      )}

      {mode === "analyst" && (
        // Analyst: event maps on the pitch, the metric explained, every number one tab away.
        <main className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_460px]">
          <div className="flex min-h-0 min-w-0 flex-col gap-3">
            {pitch(true)}
            {strip}
          </div>
          <aside className="panel flex min-h-[420px] flex-col overflow-hidden lg:min-h-0">
            {offlineNote}
            <div className="flex border-b border-line" role="tablist">
              {(["turning", "story", "events", "stats", "moments"] as Tab[]).map((k) => (
                <button
                  key={k}
                  role="tab"
                  aria-selected={tab === k}
                  onClick={() => setTab(k)}
                  className={`flex-auto whitespace-nowrap px-2 py-2.5 text-xs font-semibold sm:text-sm ${tab === k ? "border-b-2 border-accent text-ink" : "text-muted hover:text-ink"}`}
                >
                  {k === "moments" ? t.moments : k === "turning" ? `◆ ${t.turningTab}` : k === "events" ? t.eventsTab : k === "story" ? t.storyTab : t.stats}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {tab === "turning" ? (
                <TurningPanel tps={tps} selected={selectedTp} onSelect={showTp} meta={meta} events={feed.events} palette={palette} locale={choices.locale} onJump={jump} />
              ) : tab === "story" ? (
                stats && (
                  <MatchStory
                    meta={meta}
                    events={feed.events}
                    clock={feed.clock}
                    stats={stats}
                    tps={tps}
                    ended={feed.ended && feed.isLive}
                    palette={palette}
                    locale={choices.locale}
                    onJump={jump}
                    onTurning={(tp) => {
                      showTp(tp);
                      setTab("turning");
                    }}
                  />
                )
              ) : tab === "events" ? (
                <EventFeed
                  events={feed.events}
                  clock={feed.clock}
                  meta={meta}
                  palette={palette}
                  locale={choices.locale}
                  tps={tps}
                  onJump={jump}
                  onTurning={(tp) => {
                    showTp(tp);
                    setTab("turning");
                  }}
                />
              ) : tab === "stats" ? (
                <>
                  {spotlight(false)}
                  {stats && <AnalystPanel meta={meta} stats={stats} events={feed.events} palette={palette} t={t} onStat={onStat} />}
                </>
              ) : (
                <MomentsFeed cards={feed.cards} t={t} palette={palette} meta={meta} onJump={jump} />
              )}
            </div>
          </aside>
        </main>
      )}

      {mode === "player" && (
        // Player focus: one player's map, head-to-head with their direct opponent, their key actions.
        <main className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_440px]">
          <div className="flex min-h-0 min-w-0 flex-col gap-3">
            {pitch(true)}
            {strip}
          </div>
          <aside className="panel flex min-h-[420px] flex-col overflow-y-auto lg:min-h-0">
            {offlineNote}
            <label className="flex items-center gap-2 border-b border-line px-4 py-2.5">
              <span className="eyebrow">{t.choosePlayer}</span>
              <select value={playerId} onChange={(e) => setFocusId(e.target.value)} aria-label={t.choosePlayer} className="min-w-0 flex-1 rounded bg-surface px-2 py-1.5 font-semibold ring-1 ring-line">
                {[meta.home, meta.away].map((team) => (
                  <optgroup key={team.id} label={team.name}>
                    {team.lineup.concat(team.bench).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.number} · {p.name} · {p.position}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <PlayerPanel meta={meta} events={feed.events} clock={Math.floor(feed.clock)} playerId={playerId} palette={palette} t={t} onJump={jump} />
            <div className="px-4 pb-4">
              <AIPlayerReportCard
                facts={() => playerFacts(meta, feed.events, feed.clock, clock.minute, playerId, tps, choices.locale)}
                minute={clock.minute}
                locale={choices.locale}
                resetKey={`${meta.match_id}|${playerId}`}
              />
            </div>
            <div className="border-t border-line">
              <TurningPanel
                tps={tps.filter((x) => x.side === (meta.home.lineup.concat(meta.home.bench).some((p) => p.id === playerId) ? "home" : "away"))}
                selected={selectedTp}
                onSelect={showTp}
                meta={meta}
                events={feed.events}
                palette={palette}
                locale={choices.locale}
                onJump={jump}
              />
            </div>
            {spotlight(false)}
            <h3 className="eyebrow border-t border-line px-4 pt-3">{t.moments}</h3>
            <MomentsFeed cards={feed.cards.filter((c) => c.your_player || c.player_id === playerId || (KIND[c.kind]?.priority ?? 0) >= 5)} t={t} palette={palette} meta={meta} onJump={jump} />
          </aside>
        </main>
      )}

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

type MapWindow = "5" | "15" | "half" | "match";

function LayerBar({
  layer,
  setLayer,
  side,
  setSide,
  meta,
  t,
  hasInsight,
}: {
  layer: Layer;
  setLayer(l: Layer): void;
  side?: "home" | "away";
  setSide?(s: "home" | "away" | undefined): void;
  meta: MatchMeta;
  t: (typeof STRINGS)["en"];
  hasInsight?: boolean;
}) {
  const label: Record<Layer, string> = {
    live: `● ${t.layerLive}`,
    shots: t.layerShots,
    passes: t.layerPasses,
    zones: t.layerZones,
    speed: t.layerSpeed,
    touches: t.layerTouches,
    insight: `◎ ${t.layerInsight}`,
  };
  const teamable = layer !== "live" && layer !== "zones" && layer !== "insight";
  return (
    <div className="flex flex-wrap gap-1.5">
      <div role="group" aria-label="Map" className="flex flex-wrap overflow-hidden rounded bg-surface ring-1 ring-line">
        {(hasInsight ? [...LAYERS, "insight" as Layer] : LAYERS).map((l) => (
          <button
            key={l}
            onClick={() => setLayer(l)}
            aria-pressed={layer === l}
            className={`px-2.5 py-1 text-xs font-semibold sm:text-sm ${layer === l ? "bg-accent text-bg" : "text-ink hover:bg-raised"}`}
          >
            {label[l]}
          </button>
        ))}
      </div>
      {teamable && setSide && (
        <div role="group" aria-label="Team" className="flex overflow-hidden rounded bg-surface ring-1 ring-line">
          {([undefined, "home", "away"] as const).map((s) => (
            <button
              key={s ?? "both"}
              onClick={() => setSide(s)}
              aria-pressed={side === s}
              className={`px-2.5 py-1 text-xs font-semibold sm:text-sm ${side === s ? "bg-ink text-bg" : "text-ink hover:bg-raised"}`}
            >
              {s ? meta[s].short_name : t.allPlayers}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Selected turning point (else the latest that matters) on top, the timeline under it. */
function TurningPanel({
  tps, selected, onSelect, meta, events, palette, locale, onJump,
}: {
  tps: TurningPoint[];
  selected: TurningPoint | null;
  onSelect(tp: TurningPoint): void;
  meta: MatchMeta;
  events: MatchEvent[];
  palette: TeamPalette;
  locale: Locale;
  onJump(c: number): void;
}) {
  const focus = (selected && tps.some((x) => x.id === selected.id) ? selected : null) ?? [...tps].reverse().find((x) => x.impact !== "low" && x.status !== "faded");
  return (
    <>
      {focus && <TPCard tp={focus} meta={meta} events={events} palette={palette} locale={locale} onShow={onSelect} onJump={onJump} />}
      <TPTimeline tps={tps} selected={focus?.id ?? null} onSelect={onSelect} meta={meta} palette={palette} locale={locale} />
    </>
  );
}

/** Fan mode: the three latest moments as big cards under the picture. */
function FanMoments({ cards, meta, palette, t, onJump }: { cards: MomentCard[]; meta: MatchMeta; palette: TeamPalette; t: (typeof STRINGS)["en"]; onJump(c: number): void }) {
  const last = [...cards].reverse().slice(0, 3);
  if (!last.length) return <p className="panel px-5 py-4 text-lg text-muted">{t.momentsEmpty}</p>;
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {last.map((c, i) => {
        const side = c.team_id === meta.home.id ? "home" : c.team_id === meta.away.id ? "away" : null;
        return (
          <button
            key={c.card_id}
            onClick={() => onJump(c.clock_s - 6)}
            className={`panel p-4 text-left transition hover:bg-raised ${i === 0 ? "ring-2 ring-accent" : ""}`}
            style={{ borderTop: `6px solid ${side ? palette[side] : "rgb(var(--line))"}` }}
          >
            <div className="flex items-center gap-2 text-sm text-muted">
              <span className="text-2xl" aria-hidden>
                {KIND[c.kind]?.icon ?? "•"}
              </span>
              <span className="num text-lg text-ink">{c.minute}′</span>
              {i === 0 && <span className="ml-auto text-2xs font-bold uppercase tracking-wider text-accent">{t.latestMoment}</span>}
            </div>
            <p className="mt-1 text-lg font-semibold leading-snug">{c.headline}</p>
          </button>
        );
      })}
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
  screen: "setup" | "live";
  mode: Mode;
  setMode(m: Mode): void;
  metric: string;
  setMetric(m: string): void;
  locale: Locale;
  setLocale(l: Locale): void;
  theme: Theme;
  setTheme(t: Theme): void;
  onHome(): void;
  onRestart(): void;
  t: (typeof STRINGS)["en"];
}) {
  return (
    <nav className="flex flex-wrap items-center gap-2 lg:gap-3">
      <button onClick={p.onHome} title={p.t.home} className="num mr-auto rounded text-xl font-bold tracking-wide hover:opacity-80">
        PITCH<span className="text-accent">IQ</span>
      </button>
      {p.screen === "live" && (
        <>
          <Segmented label={p.t.mode} value={p.mode} onChange={p.setMode} options={[["fan", p.t.fan], ["analyst", p.t.analyst], ["player", p.t.player]]} />
          <label className="flex items-center gap-1.5 rounded bg-surface py-0.5 pl-2 pr-1 text-sm ring-1 ring-line" title={p.t.stepMetric}>
            <span className="eyebrow">{p.t.focusMetric}</span>
            <select value={p.metric} onChange={(e) => p.setMetric(e.target.value)} aria-label={p.t.stepMetric} className="bg-transparent py-0.5 font-semibold">
              {METRICS(p.t).map(([v, icon, l]) => (
                <option key={v} value={v}>
                  {icon} {l}
                </option>
              ))}
            </select>
          </label>
          <button onClick={p.onHome} className="rounded px-3 py-1 text-sm font-semibold text-muted ring-1 ring-line hover:bg-raised">
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
