import { motion } from "framer-motion";
import type { Fixture } from "../feed/live";
import type { MatchMeta, Team } from "../feed/types";
import type { Locale, Strings } from "../i18n/strings";
import { Crest } from "./Scoreboard";

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
  choices: Choices;
  setChoices(c: Choices): void;
  onStart(): void;
  starting: boolean;
  offline: boolean;
  t: Strings;
}

const SPEEDS = [10, 20, 40, 90];

export const METRICS = (t: Strings): [string, string, string, string][] => [
  ["", "◎", t.metricNone, t.metricNoneDesc],
  ["xg", "🎯", t.metricXg, t.metricXgDesc],
  ["control", "⚖", t.metricControl, t.metricControlDesc],
  ["pass_difficulty", "➶", t.metricPass, t.metricPassDesc],
  ["speed", "⚡", t.metricSpeed, t.metricSpeedDesc],
  ["distance", "↔", t.metricDistance, t.metricDistanceDesc],
];

/** Landing: what PITCHIQ is, a real reading from the chosen match, then a few choices and Start. */
export function Setup({ fixtures, metas, choices, setChoices, onStart, starting, offline, t }: Props) {
  const set = (patch: Partial<Choices>) => setChoices({ ...choices, ...patch });
  const meta = metas[choices.seed] ?? null;
  const h = HERO[choices.locale];
  const modes: [Mode, string, string, string][] = [
    ["fan", "😀", t.fan, t.modeFanDesc],
    ["analyst", "📊", t.analyst, t.modeAnalystDesc],
    ["player", "🎯", t.player, t.modePlayerDesc],
  ];

  const metricDesc = METRICS(t).find(([v]) => v === choices.metric)?.[3];

  // one screen: the pitch on the left, every choice and Start on the right
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0, transition: { duration: 0.3 } }}
      className="mx-auto grid w-full max-w-7xl gap-6 p-4 lg:grid-cols-[0.8fr_1.2fr] lg:items-start lg:gap-10 lg:px-6 lg:py-4"
    >
      <section className="lg:sticky lg:top-6">
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
        <p className="mt-6 text-2xs text-muted">{h.synthetic}</p>
      </section>

      <section className="panel flex flex-col gap-3.5 p-4">
        <Step n={1} title={t.stepMatch}>
          <div className="grid grid-cols-2 gap-2 xl:grid-cols-3">
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
                className={`flex gap-2 rounded-lg border px-3 py-2 text-left transition ${choices.mode === m ? "border-accent bg-accent/10" : "border-line hover:bg-raised"}`}
              >
                <span className="text-2xl">{icon}</span>
                <span>
                  <span className="block font-semibold">{label}</span>
                  <span className="block text-xs leading-snug text-muted">{desc}</span>
                </span>
              </button>
            ))}
          </div>
        </Step>

        <Step n={3} title={t.stepMetric}>
          <div className="flex flex-wrap gap-2">
            {METRICS(t).map(([v, icon, label, desc]) => (
              <Chip key={v} on={choices.metric === v} onClick={() => set({ metric: v })} title={desc}>
                {icon} {label}
              </Chip>
            ))}
          </div>
          {metricDesc && <p className="mt-1.5 text-sm text-muted">{metricDesc}</p>}
        </Step>

        <div className="grid gap-4 sm:grid-cols-2">
          <Step n={4} title={t.stepClub}>
            <div className="flex flex-wrap gap-2">
              <Chip on={!choices.team} onClick={() => set({ team: "", player: "" })}>
                {t.none}
              </Chip>
              {meta &&
                [meta.home, meta.away].map((team) => (
                  <Chip key={team.id} on={choices.team === team.id} onClick={() => set({ team: team.id, player: "" })}>
                    <span className="flex items-center gap-1.5">
                      <Crest team={team} size={18} />
                      {team.short_name}
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
                Español
              </Chip>
            </div>
          </Step>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
          <div className="flex items-center gap-1.5">
            <span className="eyebrow mr-1">{t.stepSpeed}</span>
            {SPEEDS.map((s) => (
              <Chip key={s} on={choices.speed === s} onClick={() => set({ speed: s })} title={t.speedLater}>
                <span className="num">{s}×</span>
              </Chip>
            ))}
          </div>
          <button
            onClick={onStart}
            disabled={starting || !fixtures.length}
            className="num ml-auto rounded-lg bg-accent px-8 py-3 text-2xl font-bold uppercase text-bg shadow-[var(--shadow)] transition hover:brightness-110 disabled:opacity-60"
          >
            ▶ {starting ? t.starting : t.startMatch}
          </button>
        </div>
      </section>
    </motion.div>
  );
}

function FixtureCard({ f, meta, on, live, onClick }: { f: Fixture; meta?: MatchMeta; on: boolean; live: string; onClick(): void }) {
  const kick = new Date(f.kickoff_utc);
  const side = (team: Team | undefined, name: string) => (
    <div className="flex items-center gap-2">
      {team ? <Crest team={team} size={18} /> : <span className="h-5 w-4" />}
      <span className="num truncate text-sm font-semibold uppercase leading-tight">{name}</span>
    </div>
  );
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={`relative flex flex-col gap-1 rounded-lg border px-3 py-2 text-left transition ${on ? "border-accent bg-accent/10 ring-1 ring-accent" : "border-line hover:bg-raised"}`}
    >
      {f.live && <span className="absolute right-2 top-2 rounded-sm bg-live px-1.5 text-2xs font-bold uppercase text-white">{live}</span>}
      {side(meta?.home, f.home)}
      {side(meta?.away, f.away)}
      <div className="truncate text-2xs text-muted">
        {f.venue}
        {!isNaN(kick.getTime()) && ` · ${kick.toLocaleDateString(undefined, { day: "numeric", month: "short" })} ${kick.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`}
      </div>
    </button>
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
    synthetic: "Todos los clubes, jugadores y partidos son ficticios, generados a partir de promedios públicos de ligas.",
  },
};

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-1.5 flex items-center gap-2 font-semibold">
        <span className="num grid h-6 w-6 place-items-center rounded-full bg-raised text-sm">{n}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Chip({ on, onClick, title, children }: { on: boolean; onClick(): void; title?: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-pressed={on}
      className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${on ? "border-accent bg-accent text-bg" : "border-line hover:bg-raised"}`}
    >
      {children}
    </button>
  );
}
