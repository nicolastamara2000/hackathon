import { motion } from "framer-motion";
import type { Fixture } from "../feed/live";
import type { MatchMeta } from "../feed/types";
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
  meta: MatchMeta | null;
  choices: Choices;
  setChoices(c: Choices): void;
  onStart(): void;
  starting: boolean;
  offline: boolean;
  t: Strings;
}

const SPEEDS = [10, 20, 40, 90];

/** Onboarding: every choice on one screen, sensible defaults, one big Start button. */
export function Setup({ fixtures, meta, choices, setChoices, onStart, starting, offline, t }: Props) {
  const set = (patch: Partial<Choices>) => setChoices({ ...choices, ...patch });
  const club = meta && (meta.home.id === choices.team ? meta.home : meta.away.id === choices.team ? meta.away : null);
  const modes: [Mode, string, string, string][] = [
    ["fan", "😀", t.fan, t.modeFanDesc],
    ["analyst", "📊", t.analyst, t.modeAnalystDesc],
    ["player", "🎯", t.player, t.modePlayerDesc],
  ];
  const metrics: [string, string][] = [
    ["", t.none],
    ["xg", t.metricXg],
    ["control", t.metricControl],
    ["pass_difficulty", t.metricPass],
    ["speed", t.metricSpeed],
    ["distance", t.metricDistance],
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0, transition: { duration: 0.3 } }}
      className="mx-auto flex w-full max-w-5xl flex-col gap-5 p-4 lg:p-8"
    >
      <Hero locale={choices.locale} onStart={onStart} starting={starting} disabled={!fixtures.length} />
      <header className="border-t border-line pt-5">
        <h2 className="num text-tv-sm font-bold uppercase">{t.setupTitle}</h2>
        <p className="text-muted">{t.setupSub}</p>
        {offline && <p className="mt-2 rounded border border-warn/60 bg-warn/10 px-3 py-2 text-sm">{t.offline}</p>}
      </header>

      <Step n={1} title={t.stepMatch}>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {fixtures.map((f) => (
            <button
              key={f.seed}
              onClick={() => set({ seed: f.seed, team: "", player: "" })}
              aria-pressed={choices.seed === f.seed}
              className={`rounded-lg border p-3 text-left transition ${choices.seed === f.seed ? "border-accent bg-accent/10" : "border-line hover:bg-raised"}`}
            >
              <div className="num text-lg font-semibold uppercase leading-tight">{f.home}</div>
              <div className="text-xs text-muted">vs</div>
              <div className="num text-lg font-semibold uppercase leading-tight">{f.away}</div>
              <div className="mt-1 text-xs text-muted">{f.venue}</div>
            </button>
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
              className={`rounded-lg border p-4 text-left transition ${choices.mode === m ? "border-accent bg-accent/10" : "border-line hover:bg-raised"}`}
            >
              <div className="text-3xl">{icon}</div>
              <div className="mt-1 text-lg font-semibold">{label}</div>
              <div className="text-sm text-muted">{desc}</div>
            </button>
          ))}
        </div>
      </Step>

      <div className="grid gap-5 lg:grid-cols-2">
        <Step n={3} title={t.stepClub}>
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

        <Step n={4} title={t.stepPlayer}>
          <select
            value={choices.player}
            onChange={(e) => set({ player: e.target.value })}
            disabled={!meta}
            className="w-full rounded border border-line bg-surface px-3 py-2"
            aria-label={t.stepPlayer}
          >
            <option value="">{t.none}</option>
            {meta &&
              (club ? [club] : [meta.home, meta.away]).map((team) => (
                <optgroup key={team.id} label={team.name}>
                  {team.lineup.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.number} · {p.name} · {p.position}
                    </option>
                  ))}
                </optgroup>
              ))}
          </select>
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

        <Step n={6} title={t.stepMetric}>
          <div className="flex flex-wrap gap-2">
            {metrics.map(([v, l]) => (
              <Chip key={v} on={choices.metric === v} onClick={() => set({ metric: v })}>
                {l}
              </Chip>
            ))}
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
        </div>
        <button
          onClick={onStart}
          disabled={starting || !fixtures.length}
          className="num ml-auto rounded-lg bg-accent px-10 py-4 text-tv-sm font-bold uppercase text-bg shadow-[var(--shadow)] transition hover:brightness-110 disabled:opacity-60"
        >
          ▶ {starting ? t.starting : t.startMatch}
        </button>
      </div>
    </motion.div>
  );
}

const HERO = {
  en: {
    kicker: "Real-time football intelligence · synthetic match data",
    intro: "A real-time football intelligence platform that turns synthetic match events into tactical discoveries, explainable insights, automated commentary, and personalized fan experiences.",
    promise: "Don't just tell me what happened. Show me why it happened, why it matters, and what might happen next.",
    points: [
      ["◆", "Tactical Turning Point Engine", "Compares every 10 minutes with the 10 before and flags what changed."],
      ["✓", "Every claim is inspectable", "Each insight links to the events and numbers behind it."],
      ["⇄", "Your way", "Fan, Analyst or Player focus, in English or Spanish."],
    ],
    statsTitle: "A stats site shows",
    stats: [["Possession", "68%"], ["Shots", "12"], ["Completed passes", "540"]],
    oursTitle: "PITCHIQ explains",
    observed: "Silverlake's high recoveries rose from 2 to 9 in the last 10 minutes; Eastbrook's forward-pass completion fell from 81% to 58%.",
    interp: "Silverlake's press is cutting Eastbrook's route through midfield.",
    hyp: "If it continues, Eastbrook may need to go longer or add a midfielder between the lines.",
    example: "Illustrative example with fictional clubs. Live insights only state what the match data supports.",
    start: "Start the demo match",
  },
  "es-419": {
    kicker: "Inteligencia futbolera en tiempo real · datos sintéticos",
    intro: "Una plataforma de inteligencia futbolera en tiempo real que convierte eventos sintéticos de partido en hallazgos tácticos, insights explicables, relato automático y experiencias personalizadas.",
    promise: "No me digas solo qué pasó. Mostrame por qué pasó, por qué importa y qué puede pasar ahora.",
    points: [
      ["◆", "Motor de puntos de quiebre", "Compara cada 10 minutos con los 10 anteriores y marca qué cambió."],
      ["✓", "Cada afirmación se puede revisar", "Cada insight enlaza a los eventos y números que lo sostienen."],
      ["⇄", "A tu manera", "Hincha, Analista o Foco en jugador, en inglés o español."],
    ],
    statsTitle: "Un sitio de estadísticas muestra",
    stats: [["Posesión", "68%"], ["Tiros", "12"], ["Pases completados", "540"]],
    oursTitle: "PITCHIQ explica",
    observed: "Las recuperaciones altas de Silverlake subieron de 2 a 9 en los últimos 10 minutos; los pases hacia adelante de Eastbrook bajaron de 81% a 58%.",
    interp: "La presión de Silverlake le está cortando a Eastbrook la salida por el medio.",
    hyp: "Si sigue así, Eastbrook podría necesitar jugar más largo o sumar un volante entre líneas.",
    example: "Ejemplo ilustrativo con clubes ficticios. Los insights en vivo solo dicen lo que los datos sostienen.",
    start: "Empezar el partido demo",
  },
};

/** Opening of the site: the promise, then the difference between a stat and an explanation. */
function Hero({ locale, onStart, starting, disabled }: { locale: Locale; onStart(): void; starting: boolean; disabled: boolean }) {
  const h = HERO[locale];
  return (
    <section className="grid gap-6 lg:grid-cols-[1.1fr_1fr] lg:items-center">
      <div>
        <div className="eyebrow text-accent">{h.kicker}</div>
        <h1 className="num mt-2 text-tv-md font-bold leading-none lg:text-tv-lg">
          PITCH<span className="text-accent">IQ</span>
        </h1>
        <p className="mt-3 text-lg leading-snug">{h.intro}</p>
        <p className="mt-3 border-l-4 border-accent pl-3 text-xl font-semibold leading-snug">{h.promise}</p>
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
        <button
          onClick={onStart}
          disabled={disabled || starting}
          className="num mt-5 rounded-lg bg-accent px-8 py-3 text-xl font-bold uppercase text-bg hover:brightness-110 disabled:opacity-60"
        >
          ▶ {h.start}
        </button>
      </div>
      <div className="grid gap-3">
        <div className="panel p-4">
          <div className="eyebrow mb-2">{h.statsTitle}</div>
          <div className="grid grid-cols-3 gap-2">
            {h.stats.map(([k, v]) => (
              <div key={k}>
                <div className="num text-tv-sm font-bold leading-none text-muted">{v}</div>
                <div className="text-xs text-muted">{k}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="panel border-l-4 border-l-accent p-4">
          <div className="eyebrow mb-2 text-accent">◆ {h.oursTitle}</div>
          <Tagged tag={locale === "en" ? "Observed" : "Observado"} cls="bg-ink text-bg">{h.observed}</Tagged>
          <Tagged tag={locale === "en" ? "Interpretation" : "Interpretación"} cls="ring-1 ring-line text-muted">{h.interp}</Tagged>
          <Tagged tag={locale === "en" ? "Hypothesis" : "Hipótesis"} cls="border border-dashed border-accent text-accent">{h.hyp}</Tagged>
          <p className="mt-3 text-2xs text-muted">{h.example}</p>
        </div>
      </div>
    </section>
  );
}

function Tagged({ tag, cls, children }: { tag: string; cls: string; children: React.ReactNode }) {
  return (
    <div className="mt-2 first:mt-0">
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
