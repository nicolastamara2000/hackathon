import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import type { Fixture } from "../feed/live";
import type { MatchEvent, MatchMeta, Team } from "../feed/types";
import type { Locale, Strings } from "../i18n/strings";
import { tpText } from "../i18n/turning";
import { turningPoints } from "../stats/turning";
import { Crest } from "./Scoreboard";
import { TP_ICON } from "./TurningPoints";

export type Mode = "fan" | "analyst" | "player";

export interface Choices {
  seed: number;
  mode: Mode;
  team: string;
  player: string;
  locale: Locale;
  metric: string;
  speed: number;
}

interface Props {
  fixtures: Fixture[];
  metas: Record<number, MatchMeta>;
  /** opening phase of a match, for the preview */
  loadPreview(seed: number): Promise<MatchEvent[]>;
  choices: Choices;
  setChoices(c: Choices): void;
  onStart(): void;
  starting: boolean;
  offline: boolean;
  t: Strings;
}

const SPEEDS = [10, 20, 40, 90];
/** The preview reads only the opening half hour: enough to show the product, not the result. */
export const PREVIEW_UNTIL = 30 * 60;

export const METRICS = (t: Strings): [string, string, string, string][] => [
  ["", "◎", t.metricNone, t.metricNoneDesc],
  ["xg", "🎯", t.metricXg, t.metricXgDesc],
  ["control", "⚖", t.metricControl, t.metricControlDesc],
  ["pass_difficulty", "➶", t.metricPass, t.metricPassDesc],
  ["speed", "⚡", t.metricSpeed, t.metricSpeedDesc],
  ["distance", "↔", t.metricDistance, t.metricDistanceDesc],
];

/** Landing: what PITCHIQ is, a real reading from the chosen match, then a few choices and Start. */
export function Setup({ fixtures, metas, loadPreview, choices, setChoices, onStart, starting, offline, t }: Props) {
  const set = (patch: Partial<Choices>) => setChoices({ ...choices, ...patch });
  const meta = metas[choices.seed] ?? null;
  const h = HERO[choices.locale];
  const modes: [Mode, string, string, string][] = [
    ["fan", "😀", t.fan, t.modeFanDesc],
    ["analyst", "📊", t.analyst, t.modeAnalystDesc],
    ["player", "🎯", t.player, t.modePlayerDesc],
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0, transition: { duration: 0.3 } }}
      className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 lg:p-8"
    >
      <section className="grid gap-6 lg:grid-cols-[1fr_1.1fr] lg:items-start">
        <div>
          <div className="eyebrow text-accent">{h.kicker}</div>
          <h1 className="num mt-2 text-tv-md font-bold leading-none lg:text-tv-lg">
            PITCH<span className="text-accent">IQ</span>
          </h1>
          <p className="mt-3 text-lg leading-snug">{h.intro}</p>
          <ul className="mt-4 grid gap-2">
            {h.points.map(([icon, title, body]) => (
              <li key={title} className="flex gap-3">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded bg-raised text-accent">{icon}</span>
                <span>
                  <span className="font-semibold">{title}.</span> <span className="text-muted">{body}</span>
                </span>
              </li>
            ))}
          </ul>
          {offline && <p className="mt-4 rounded border border-warn/60 bg-warn/10 px-3 py-2 text-sm">{t.offline}</p>}
        </div>
        <Preview meta={meta} seed={choices.seed} loadPreview={loadPreview} locale={choices.locale} />
      </section>

      <Step n={1} title={t.stepMatch}>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {fixtures.map((f) => (
            <FixtureCard key={f.seed} f={f} meta={metas[f.seed]} on={choices.seed === f.seed} live={t.live} onClick={() => set({ seed: f.seed, team: "", player: "" })} />
          ))}
        </div>
      </Step>

      <Step n={2} title={t.stepMode}>
        <div className="grid gap-2 sm:grid-cols-3">
          {modes.map(([m, icon, label, desc]) => (
            <button
              key={m}
              onClick={() => set({ mode: m })}
              aria-pressed={choices.mode === m}
              className={`flex gap-3 rounded-lg border p-3 text-left transition ${choices.mode === m ? "border-accent bg-accent/10" : "border-line hover:bg-raised"}`}
            >
              <span className="text-3xl">{icon}</span>
              <span>
                <span className="block text-lg font-semibold">{label}</span>
                <span className="block text-sm text-muted">{desc}</span>
              </span>
            </button>
          ))}
        </div>
      </Step>

      <Step n={3} title={t.stepMetric}>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {METRICS(t).map(([v, icon, label, desc]) => (
            <button
              key={v}
              onClick={() => set({ metric: v })}
              aria-pressed={choices.metric === v}
              className={`flex gap-3 rounded-lg border px-3 py-2 text-left transition ${choices.metric === v ? "border-accent bg-accent/10" : "border-line hover:bg-raised"}`}
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded bg-raised text-lg">{icon}</span>
              <span>
                <span className="block font-semibold">{label}</span>
                <span className="block text-sm leading-snug text-muted">{desc}</span>
              </span>
            </button>
          ))}
        </div>
      </Step>

      <div className="grid gap-5 sm:grid-cols-2">
        <Step n={4} title={t.stepClub}>
          <div className="flex flex-wrap gap-2">
            <Chip on={!choices.team} onClick={() => set({ team: "", player: "" })}>
              {t.none}
            </Chip>
            {meta &&
              [meta.home, meta.away].map((team) => (
                <Chip key={team.id} on={choices.team === team.id} onClick={() => set({ team: team.id, player: "" })}>
                  <span className="flex items-center gap-2">
                    <Crest team={team} size={20} />
                    {team.name}
                  </span>
                </Chip>
              ))}
          </div>
        </Step>
        <Step n={5} title={t.stepLang}>
          <div className="flex gap-2">
            <Chip on={choices.locale === "en"} onClick={() => set({ locale: "en" })}>
              English
            </Chip>
            <Chip on={choices.locale === "es-419"} onClick={() => set({ locale: "es-419" })}>
              Español (LatAm)
            </Chip>
          </div>
        </Step>
      </div>

      <div className="flex flex-wrap items-center gap-4 border-t border-line pt-5">
        <div className="flex items-center gap-2">
          <span className="eyebrow">{t.stepSpeed}</span>
          {SPEEDS.map((s) => (
            <Chip key={s} on={choices.speed === s} onClick={() => set({ speed: s })}>
              <span className="num">{s}×</span>
            </Chip>
          ))}
          <span className="text-xs text-muted">{t.speedLater}</span>
        </div>
        <button
          onClick={onStart}
          disabled={starting || !fixtures.length}
          className="num ml-auto rounded-lg bg-accent px-10 py-4 text-tv-sm font-bold uppercase text-bg shadow-[var(--shadow)] transition hover:brightness-110 disabled:opacity-60"
        >
          ▶ {starting ? t.starting : t.startMatch}
        </button>
      </div>
      <p className="text-2xs text-muted">{h.synthetic}</p>
    </motion.div>
  );
}

function FixtureCard({ f, meta, on, live, onClick }: { f: Fixture; meta?: MatchMeta; on: boolean; live: string; onClick(): void }) {
  const kick = new Date(f.kickoff_utc);
  const side = (team: Team | undefined, name: string) => (
    <div className="flex items-center gap-2">
      {team ? <Crest team={team} size={22} /> : <span className="h-6 w-5" />}
      <span className="num truncate text-base font-semibold uppercase leading-tight">{name}</span>
    </div>
  );
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={`relative flex flex-col gap-1.5 rounded-lg border p-3 text-left transition ${on ? "border-accent bg-accent/10 ring-1 ring-accent" : "border-line hover:bg-raised"}`}
    >
      {f.live && <span className="absolute right-2 top-2 rounded-sm bg-live px-1.5 text-2xs font-bold uppercase text-white">{live}</span>}
      {side(meta?.home, f.home)}
      {side(meta?.away, f.away)}
      <div className="mt-0.5 truncate text-xs text-muted">
        {f.venue}
        {!isNaN(kick.getTime()) && ` · ${kick.toLocaleDateString(undefined, { day: "numeric", month: "short" })} ${kick.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`}
      </div>
    </button>
  );
}

/** Club style from the generator settings: a tactical identity, not a match fact. */
function style(team: Team, locale: Locale) {
  const en = locale === "en";
  const press = team.pressing >= 0.55 ? (en ? "high press" : "presión alta") : team.pressing <= 0.42 ? (en ? "mid block" : "bloque medio") : en ? "selective press" : "presión selectiva";
  const build = team.directness >= 0.45 ? (en ? "direct, early balls forward" : "directo, balón largo temprano") : team.directness <= 0.35 ? (en ? "short build-up" : "salida corta") : en ? "mixed build-up" : "salida mixta";
  return `${team.formation} · ${press} · ${build}`;
}

/** The selected match: the two sides and one real reading from its opening half hour. */
function Preview({ meta, seed, loadPreview, locale }: { meta: MatchMeta | null; seed: number; loadPreview(seed: number): Promise<MatchEvent[]>; locale: Locale }) {
  const h = HERO[locale];
  const [events, setEvents] = useState<{ seed: number; events: MatchEvent[] } | null>(null);
  useEffect(() => {
    let alive = true;
    loadPreview(seed)
      .then((ev) => alive && setEvents({ seed, events: ev }))
      .catch(() => alive && setEvents({ seed, events: [] }));
    return () => {
      alive = false;
    };
  }, [seed, loadPreview]);
  const tp = useMemo(() => {
    if (!meta || events?.seed !== seed || !events.events.length) return null;
    const all = turningPoints(meta, events.events, PREVIEW_UNTIL).filter((x) => x.status !== "faded");
    return all.sort((a, b) => (b.impact === "high" ? 1 : 0) - (a.impact === "high" ? 1 : 0) || b.strength - a.strength)[0] ?? null;
  }, [meta, events, seed]);
  const text = tp && meta ? tpText(tp, meta, locale) : null;

  return (
    <div className="panel overflow-hidden">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 border-b border-line px-4 py-3">
        {meta ? (
          <>
            <TeamLine team={meta.home} locale={locale} />
            <span className="num text-muted">vs</span>
            <TeamLine team={meta.away} locale={locale} right />
          </>
        ) : (
          <div className="h-12 w-full animate-pulse rounded bg-raised" />
        )}
      </div>
      <div className="p-4">
        <div className="eyebrow mb-2 text-accent">◆ {h.previewTitle}</div>
        {text && tp ? (
          <>
            <p className="text-xl font-semibold leading-snug">
              <span className="num mr-2 text-muted">{tp.minute}′</span>
              {TP_ICON[tp.kind]} {text.headline}
            </p>
            <Tagged tag={locale === "en" ? "Observed" : "Observado"} cls="bg-ink text-bg">{text.observed}</Tagged>
            <Tagged tag={locale === "en" ? "Why it matters" : "Por qué importa"} cls="ring-1 ring-line text-muted">{text.why}</Tagged>
            <p className="mt-3 text-2xs text-muted">{h.previewNote}</p>
          </>
        ) : (
          <p className="text-muted">{events?.seed === seed ? h.previewNone : "…"}</p>
        )}
      </div>
    </div>
  );
}

function TeamLine({ team, locale, right }: { team: Team; locale: Locale; right?: boolean }) {
  return (
    <div className={`flex min-w-0 items-center gap-2 ${right ? "flex-row-reverse text-right" : ""}`}>
      <Crest team={team} size={34} />
      <div className="min-w-0">
        <div className="num text-lg font-bold uppercase leading-tight">{team.name}</div>
        <div className="text-xs leading-snug text-muted">{style(team, locale)}</div>
      </div>
    </div>
  );
}

const HERO = {
  en: {
    kicker: "Real-time football intelligence",
    intro: "PITCHIQ watches the match with you and explains the football: what changed, why it matters and what to watch next.",
    points: [
      ["◆", "Turning points", "Every minute it compares the last 10 minutes with the 10 before and flags the tactical shift."],
      ["✓", "Every claim is inspectable", "Each insight links to the events and numbers behind it."],
      ["⇄", "Your way", "Fan, Analyst or Player focus, in English or Spanish."],
    ],
    previewTitle: "From this match",
    previewNote: "Read from the first 30 minutes only, so the result stays a surprise.",
    previewNone: "No clear turning point in the first 30 minutes of this match.",
    synthetic: "All clubs, players and matches are fictional, generated from public league averages.",
  },
  "es-419": {
    kicker: "Inteligencia futbolera en tiempo real",
    intro: "PITCHIQ mira el partido con vos y explica el fútbol: qué cambió, por qué importa y qué mirar ahora.",
    points: [
      ["◆", "Puntos de quiebre", "Cada minuto compara los últimos 10 minutos con los 10 anteriores y marca el cambio táctico."],
      ["✓", "Cada afirmación se puede revisar", "Cada insight enlaza a los eventos y números que lo sostienen."],
      ["⇄", "A tu manera", "Hincha, Analista o Foco en jugador, en inglés o español."],
    ],
    previewTitle: "De este partido",
    previewNote: "Leído solo de los primeros 30 minutos, para no spoilear el resultado.",
    previewNone: "Sin un punto de quiebre claro en los primeros 30 minutos de este partido.",
    synthetic: "Todos los clubes, jugadores y partidos son ficticios, generados a partir de promedios públicos de ligas.",
  },
};

function Tagged({ tag, cls, children }: { tag: string; cls: string; children: React.ReactNode }) {
  return (
    <div className="mt-3">
      <span className={`rounded-sm px-1.5 py-px text-2xs font-bold uppercase tracking-wider ${cls}`}>{tag}</span>
      <p className="mt-1 leading-snug">{children}</p>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 flex items-center gap-2 font-semibold">
        <span className="num grid h-6 w-6 place-items-center rounded-full bg-raised text-sm">{n}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick(): void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${on ? "border-accent bg-accent text-bg" : "border-line hover:bg-raised"}`}
    >
      {children}
    </button>
  );
}
