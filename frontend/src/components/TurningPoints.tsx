import { AnimatePresence, motion } from "framer-motion";
import { useMemo, useState } from "react";
import type { MatchEvent, MatchMeta } from "../feed/types";
import type { Locale } from "../i18n/strings";
import { confidenceText, fmtMetric, IMPACT_LABEL, METRIC_LABEL, STATUS_LABEL, tpText, windowText } from "../i18n/turning";
import type { TeamPalette } from "../lib/teamColors";
import type { TurningPoint } from "../stats/turning";

export const TP_ICON: Record<TurningPoint["kind"], string> = {
  press_up: "⤴", forward_drop: "⤵", flank_shift: "⇆", territory: "▶", threat_surge: "⚡",
  sterile_possession: "◌", chaos: "↯", reaction: "↻",
};

const STATUS_CLS: Record<TurningPoint["status"], string> = {
  new: "bg-accent text-bg",
  developing: "ring-1 ring-accent text-accent",
  confirmed: "bg-good/20 text-good",
  faded: "ring-1 ring-line text-muted line-through",
};

const L = (locale: Locale) =>
  locale === "en"
    ? {
        title: "Turning points", observed: "Observed", why: "Why it matters", whyTag: "Interpretation", next: "What to watch next",
        nextTag: "Hypothesis", limits: "Limits", evidence: "Evidence", showPitch: "Show on pitch", replay: "Replay from here",
        allEvents: "Show all", fewer: "Show fewer", empty: "No turning point yet. The engine checks every minute of play: the last 10 minutes against the 10 before.",
        history: "History", only: "Only high and medium impact", all: "All", engine: "Rule-based engine · numbers verified from events",
      }
    : {
        title: "Puntos de quiebre", observed: "Observado", why: "Por qué importa", whyTag: "Interpretación", next: "Qué mirar ahora",
        nextTag: "Hipótesis", limits: "Límites", evidence: "Evidencia", showPitch: "Ver en la cancha", replay: "Repetir desde acá",
        allEvents: "Ver todos", fewer: "Ver menos", empty: "Todavía no hay puntos de quiebre. El motor revisa cada minuto: los últimos 10 contra los 10 anteriores.",
        history: "Historial", only: "Solo impacto alto y medio", all: "Todos", engine: "Motor por reglas · números verificados con eventos",
      };

/** One turning point, fully inspectable: numbers, then interpretation, then hypothesis, then the events. */
export function TPCard({
  tp, meta, events, palette, locale, onShow, onJump, compact,
}: {
  tp: TurningPoint;
  meta: MatchMeta;
  events: MatchEvent[];
  palette: TeamPalette;
  locale: Locale;
  onShow(tp: TurningPoint): void;
  onJump(clock_s: number): void;
  compact?: boolean;
}) {
  const [more, setMore] = useState(false);
  const x = tpText(tp, meta, locale);
  const l = L(locale);
  const byId = useMemo(() => new Map(events.map((e) => [e.id, e])), [events, events.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const ev = tp.evidence.map((id) => byId.get(id)).filter(Boolean) as MatchEvent[];
  const labels = METRIC_LABEL[locale];

  return (
    <article className="border-b border-line px-4 py-4" style={{ borderLeft: `4px solid ${palette[tp.side]}` }}>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold uppercase tracking-wider text-muted">
          {TP_ICON[tp.kind]} {x.category}
        </span>
        <span className="num text-sm text-ink">{tp.minute}′</span>
        <span className={`rounded-sm px-1.5 py-px font-semibold ${tp.impact === "high" ? "bg-warn/20 text-warn" : tp.impact === "medium" ? "bg-raised text-ink" : "text-muted"}`}>
          {IMPACT_LABEL[locale][tp.impact]}
        </span>
        <span className={`ml-auto rounded-sm px-1.5 py-px font-semibold ${STATUS_CLS[tp.status]}`}>{STATUS_LABEL[locale][tp.status]}</span>
      </div>
      <h3 className="mt-1.5 text-xl font-semibold leading-tight">{x.headline}</h3>

      <div className="mt-3 grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(3, tp.metrics.length)}, minmax(0,1fr))` }}>
        {tp.metrics.map((m) => {
          const up = m.now > m.prev;
          return (
            <div key={m.key} className="rounded bg-raised/60 px-2.5 py-2">
              <div className="text-2xs leading-tight text-muted">{labels[m.key]}</div>
              <div className="num mt-1 flex items-baseline gap-1.5 leading-none">
                <span className="text-sm text-muted">{fmtMetric(m, m.prev)}</span>
                <span className="text-muted">→</span>
                <span className={`text-xl font-bold ${up ? "text-good" : "text-bad"}`}>{fmtMetric(m, m.now)}</span>
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-1 text-2xs text-muted">{windowText(tp, locale)}</p>

      <Block tag={l.observed} tone="fact">{x.observed}</Block>
      {!compact && (
        <>
          <Block tag={l.whyTag} tone="interp" title={l.why}>{x.why}</Block>
          <Block tag={l.nextTag} tone="hyp" title={l.next}>{x.next}</Block>
          <p className="mt-2 text-xs text-muted">
            <span className="font-semibold text-ink">{l.limits}: </span>
            {x.limits}
          </p>
          <p className="mt-1 text-xs text-muted">{confidenceText(tp, locale)}</p>
          {tp.history.length > 1 && (
            <p className="mt-1 text-xs text-muted">
              <span className="font-semibold text-ink">{l.history}: </span>
              {tp.history.map((h) => `${STATUS_LABEL[locale][h.status]} ${h.minute}′`).join(" → ")}
            </p>
          )}
        </>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={() => onShow(tp)} className="rounded bg-accent px-3 py-1.5 text-sm font-semibold text-bg hover:brightness-110">
          ◎ {l.showPitch}
        </button>
        <button onClick={() => onJump(Math.max(0, (ev[0]?.clock_s ?? tp.clock_s) - 5))} className="rounded px-3 py-1.5 text-sm font-semibold ring-1 ring-line hover:bg-raised">
          ↺ {l.replay}
        </button>
      </div>

      {!compact && ev.length > 0 && (
        <div className="mt-3">
          <div className="eyebrow mb-1">
            {l.evidence} · {ev.length}
          </div>
          <ol className="flex flex-col">
            {(more ? ev : ev.slice(-5)).map((e) => (
              <li key={e.id}>
                <button onClick={() => onJump(e.clock_s - 3)} className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-sm hover:bg-raised">
                  <span className="num w-10 text-muted">
                    {e.minute}:{String(e.second).padStart(2, "0")}
                  </span>
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: e.team_id === meta.home.id ? palette.home : palette.away }} />
                  <span className="truncate">
                    {e.type} · {e.player_name ?? ""}
                    {e.recipient_name ? ` → ${e.recipient_name}` : ""}
                  </span>
                  <span className="num ml-auto text-xs text-muted">{e.type === "Shot" ? `${(e.xg ?? 0).toFixed(2)} xG` : e.outcome ?? ""}</span>
                </button>
              </li>
            ))}
          </ol>
          {ev.length > 5 && (
            <button onClick={() => setMore(!more)} className="mt-1 text-xs font-semibold text-accent">
              {more ? l.fewer : `${l.allEvents} (${ev.length})`}
            </button>
          )}
        </div>
      )}
    </article>
  );
}

function Block({ tag, tone, title, children }: { tag: string; tone: "fact" | "interp" | "hyp"; title?: string; children: React.ReactNode }) {
  const cls = { fact: "bg-ink text-bg", interp: "ring-1 ring-line text-muted", hyp: "border border-dashed border-accent text-accent" }[tone];
  return (
    <div className="mt-2.5">
      <div className="flex items-center gap-2">
        <span className={`rounded-sm px-1.5 py-px text-2xs font-bold uppercase tracking-wider ${cls}`}>{tag}</span>
        {title && <span className="text-xs font-semibold">{title}</span>}
      </div>
      <p className="mt-1 text-sm leading-snug">{children}</p>
    </div>
  );
}

/** Chronological list (newest first). Selecting an item opens its card and syncs the pitch. */
export function TPTimeline({
  tps, selected, onSelect, meta, palette, locale,
}: {
  tps: TurningPoint[];
  selected: string | null;
  onSelect(tp: TurningPoint): void;
  meta: MatchMeta;
  palette: TeamPalette;
  locale: Locale;
}) {
  const l = L(locale);
  const [all, setAll] = useState(false);
  const list = [...tps].reverse().filter((t) => all || t.impact !== "low");
  return (
    <div>
      <div className="flex items-center justify-between px-4 pb-1 pt-3">
        <h3 className="eyebrow">
          {l.title} · {list.length}
        </h3>
        <button onClick={() => setAll(!all)} className="text-xs font-semibold text-accent">
          {all ? l.only : `${l.all} (${tps.length})`}
        </button>
      </div>
      {!list.length && <p className="px-4 pb-4 text-sm text-muted">{l.empty}</p>}
      <ol className="flex flex-col px-2 pb-2">
        <AnimatePresence initial={false}>
          {list.map((tp) => {
            const x = tpText(tp, meta, locale);
            return (
              <motion.li key={tp.id} layout initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
                <button
                  onClick={() => onSelect(tp)}
                  aria-pressed={selected === tp.id}
                  className={`grid w-full grid-cols-[2.5rem_1rem_minmax(0,1fr)_auto] items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-raised ${selected === tp.id ? "bg-raised" : ""} ${tp.status === "faded" ? "opacity-60" : ""}`}
                >
                  <span className="num text-sm text-muted">{tp.minute}′</span>
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: palette[tp.side], outline: tp.impact === "high" ? "2px solid rgb(var(--warn))" : undefined, outlineOffset: 1 }} />
                  <span className="truncate text-sm">
                    <span className="mr-1 text-muted">{TP_ICON[tp.kind]}</span>
                    {x.headline}
                  </span>
                  <span className={`rounded-sm px-1 text-2xs font-semibold ${STATUS_CLS[tp.status]}`}>{STATUS_LABEL[locale][tp.status]}</span>
                </button>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ol>
      <p className="px-4 pb-3 text-2xs text-muted">
        {l.engine} · {meta.home.short_name}/{meta.away.short_name}
      </p>
    </div>
  );
}

/** Fan mode: the latest meaningful turning point in one sentence. */
export function TPFanLine({ tp, meta, locale, palette, onShow }: { tp?: TurningPoint; meta: MatchMeta; locale: Locale; palette: TeamPalette; onShow(tp: TurningPoint): void }) {
  if (!tp) return null;
  const x = tpText(tp, meta, locale);
  return (
    <button onClick={() => onShow(tp)} className="mx-4 mb-4 block rounded-lg bg-raised p-4 text-left" style={{ borderLeft: `6px solid ${palette[tp.side]}` }}>
      <div className="text-2xs font-bold uppercase tracking-wider text-accent">
        {locale === "en" ? "Turning point" : "Punto de quiebre"} · {tp.minute}′
      </div>
      <p className="mt-1 text-lg font-semibold leading-snug">{x.fan}</p>
    </button>
  );
}
