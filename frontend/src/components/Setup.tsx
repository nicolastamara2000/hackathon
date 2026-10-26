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
      <header>
        <h1 className="num text-tv-sm font-bold uppercase lg:text-tv-md">{t.setupTitle}</h1>
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
