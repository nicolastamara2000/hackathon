import { memo, useMemo } from "react";
import type { MatchEvent, MatchMeta } from "../feed/types";
import type { Locale } from "../i18n/strings";
import { tpText } from "../i18n/turning";
import type { TeamPalette } from "../lib/teamColors";
import { computeStats, type Side, type StatsSnapshot } from "../stats/engine";
import { xT } from "../stats/geometry";
import { findBreaks } from "../stats/time";
import type { TurningPoint } from "../stats/turning";
import { TP_ICON } from "./TurningPoints";

/**
 * AI Match Story, built only from verified numbers: the stats snapshot, the
 * turning points and the events. Every line carries the event ids behind it.
 */

interface Line {
  text: string;
  evidence: string[];
  at?: number; // clock_s to jump to
  kind: "fact" | "interp";
}

interface Chapter {
  minute: number;
  icon: string;
  side?: Side;
  line: Line;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const x2 = (v: number) => v.toFixed(2);

function influence(meta: MatchMeta, events: MatchEvent[]) {
  const m = new Map<string, { id: string; name: string; side: Side; xt: number; xg: number; rec: number; ids: string[] }>();
  for (const e of events) {
    if (!e.player_id || !e.team_id) continue;
    const side: Side = e.team_id === meta.home.id ? "home" : "away";
    const p = m.get(e.player_id) ?? { id: e.player_id, name: e.player_name ?? "", side, xt: 0, xg: 0, rec: 0, ids: [] };
    let hit = false;
    if (((e.type === "Pass" && e.outcome === "Complete") || e.type === "Carry") && e.location && e.end_location) {
      const d = Math.max(0, xT(e.end_location) - xT(e.location));
      if (d > 0.01) {
        p.xt += d;
        hit = true;
      }
    }
    if (e.type === "Shot") {
      p.xg += e.xg ?? 0;
      hit = true;
    }
    if ((e.type === "Ball Recovery" || e.type === "Interception" || e.type === "Tackle") && e.location && e.location[0] >= 60) {
      p.rec++;
      hit = true;
    }
    if (hit) p.ids.push(e.id);
    m.set(e.player_id, p);
  }
  // custom index, labelled as such in the UI: threat created + chance quality + high ball wins
  return [...m.values()]
    .map((p) => ({ ...p, score: p.xt + p.xg + 0.05 * p.rec }))
    .sort((a, b) => b.score - a.score);
}

export const MatchStory = memo(function MatchStory({
  meta, events, clock, stats, tps, ended, palette, locale, onJump, onTurning,
}: {
  meta: MatchMeta;
  events: MatchEvent[];
  clock: number;
  stats: StatsSnapshot;
  tps: TurningPoint[];
  ended: boolean;
  palette: TeamPalette;
  locale: Locale;
  onJump(clock_s: number): void;
  onTurning(tp: TurningPoint): void;
}) {
  const es = locale !== "en";
  const H = meta.home.short_name, A = meta.away.short_name;
  const name = (s: Side) => meta[s].name;
  const tick = Math.floor(clock / 15);
  const cut = useMemo(() => events.filter((e) => e.clock_s <= clock), [events, events.length, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const breaks = findBreaks(cut);
  const firstHalf = useMemo(() => (breaks.he1 !== undefined ? computeStats(meta, events, breaks.he1) : null), [meta, breaks.he1, events]);
  const players = useMemo(() => influence(meta, cut).slice(0, 3), [meta, cut]);

  const [h, a] = stats.score;
  const goals = stats.keyMoments.filter((k) => k.kind === "goal");
  const leader: Side | null = h > a ? "home" : a > h ? "away" : null;
  const xgLead: Side = stats.home.xg >= stats.away.xg ? "home" : "away";
  const keyTps = tps.filter((t) => t.status !== "faded" && t.impact !== "low");
  const top = [...keyTps].sort((x, y) => y.strength - x.strength)[0];

  // --- summary (casual) ---
  const summary: Line[] = [];
  summary.push({
    kind: "fact",
    evidence: goals.map((g) => g.id),
    text: ended
      ? leader
        ? es ? `${name(leader)} ganó ${h}–${a}.` : `${name(leader)} won ${h}–${a}.`
        : es ? `Terminó ${h}–${a}.` : `It finished ${h}–${a}.`
      : leader
      ? es
        ? `${name(leader)} gana ${h}–${a} al minuto ${stats.minute}.`
        : `${name(leader)} lead ${h}–${a} after ${stats.minute} minutes.`
      : es
        ? `${h}–${a} al minuto ${stats.minute}.`
        : `${h}–${a} after ${stats.minute} minutes.`,
  });
  const flatter = leader && leader !== xgLead && Math.abs(stats.home.xg - stats.away.xg) >= 0.4;
  summary.push({
    kind: flatter ? "interp" : "fact",
    evidence: [...(stats.sources["home.xg"] ?? []), ...(stats.sources["away.xg"] ?? [])],
    text: es
      ? `xG ${x2(stats.home.xg)}–${x2(stats.away.xg)} con ${stats.home.shots}–${stats.away.shots} tiros. ${flatter ? `El marcador favorece a ${name(leader!)}: ${name(xgLead)} creó mejores ocasiones.` : `${name(xgLead)} creó las mejores ocasiones.`}`
      : `xG ${x2(stats.home.xg)}–${x2(stats.away.xg)} from ${stats.home.shots}–${stats.away.shots} shots. ${flatter ? `The score flatters ${name(leader!)}: ${name(xgLead)} created the better chances.` : `${name(xgLead)} created the better chances.`}`,
  });
  if (top) {
    const tx = tpText(top, meta, locale);
    summary.push({ kind: "interp", evidence: top.evidence, at: top.clock_s, text: `${es ? "El punto de quiebre más fuerte" : "The strongest turning point"} (${top.minute}′): ${tx.headline}. ${tx.observed}` });
  }

  // --- chapters: goals, red cards and the turning points that matter, in order ---
  const chapters: Chapter[] = [];
  for (const k of stats.keyMoments) {
    if (k.kind === "goal")
      chapters.push({
        minute: k.minute, icon: "⚽", side: k.side,
        line: {
          kind: "fact", evidence: [k.id], at: k.clock_s - 6,
          text: es
            ? `Gol de ${k.player} para ${meta[k.side!].short_name} (xG ${x2(k.xg ?? 0)}${k.winSwing ? `, su probabilidad de ganar ${k.winSwing > 0 ? "+" : ""}${k.winSwing} pp` : ""}).`
            : `${k.player} scores for ${meta[k.side!].short_name} (xG ${x2(k.xg ?? 0)}${k.winSwing ? `, win probability ${k.winSwing > 0 ? "+" : ""}${k.winSwing} pp` : ""}).`,
        },
      });
    if (k.kind === "red")
      chapters.push({ minute: k.minute, icon: "🟥", side: k.side, line: { kind: "fact", evidence: [k.id], at: k.clock_s - 6, text: es ? `Roja para ${k.player}.` : `${k.player} is sent off.` } });
  }
  for (const tp of keyTps) {
    const tx = tpText(tp, meta, locale);
    chapters.push({ minute: tp.minute, icon: TP_ICON[tp.kind], side: tp.side, line: { kind: "interp", evidence: tp.evidence, at: tp.clock_s, text: `${tx.headline}. ${tx.observed}` } });
  }
  chapters.sort((x, y) => x.minute - y.minute);

  // --- half-time and full-time ---
  const ht: Line[] = [];
  if (firstHalf) {
    const F = firstHalf;
    const tp1 = keyTps.filter((t) => t.play_s <= (breaks.he1 ?? 0) + 60).sort((x, y) => y.strength - x.strength)[0];
    ht.push({
      kind: "fact", evidence: F.sources.score ?? [],
      text: es
        ? `Entretiempo ${F.score[0]}–${F.score[1]}. xG ${x2(F.home.xg)}–${x2(F.away.xg)}, tiros ${F.home.shots}–${F.away.shots}, posesión ${pct(F.home.possession)}–${pct(F.away.possession)}.`
        : `Half-time ${F.score[0]}–${F.score[1]}. xG ${x2(F.home.xg)}–${x2(F.away.xg)}, shots ${F.home.shots}–${F.away.shots}, possession ${pct(F.home.possession)}–${pct(F.away.possession)}.`,
    });
    if (tp1) {
      const tx = tpText(tp1, meta, locale);
      ht.push({ kind: "interp", evidence: tp1.evidence, at: tp1.clock_s, text: `${es ? "Lo que definió el primer tiempo" : "What shaped the first half"}: ${tx.headline}. ${tx.why}` });
    }
  }
  const ft: Line[] = [];
  if (ended) {
    const swing = [...goals].sort((x, y) => Math.abs(y.winSwing ?? 0) - Math.abs(x.winSwing ?? 0))[0];
    if (swing)
      ft.push({
        kind: "fact", evidence: [swing.id], at: swing.clock_s - 6,
        text: es
          ? `El momento que más movió el partido: el gol de ${swing.player} al ${swing.minute}′ (${swing.winSwing! > 0 ? "+" : ""}${swing.winSwing} pp de probabilidad de ganar).`
          : `The moment that moved the match most: ${swing.player}'s goal at ${swing.minute}′ (${swing.winSwing! > 0 ? "+" : ""}${swing.winSwing} pp win probability).`,
      });
    if (players[0])
      ft.push({
        kind: "interp", evidence: players[0].ids.slice(-20),
        text: es
          ? `Jugador más influyente según los datos: ${players[0].name} (${meta[players[0].side].short_name}).`
          : `Most influential player by the data: ${players[0].name} (${meta[players[0].side].short_name}).`,
      });
  }

  const L = es
    ? { story: "Historia del partido", summary: "En resumen", chapters: "Capítulos", ht: "Análisis del entretiempo", ft: "Resumen final", players: "Jugadores más influyentes", formula: "Índice propio de PITCHIQ (no es una estadística oficial): xT generado + xG + 0,05 × recuperaciones altas.", empty: "La historia empieza con el primer evento.", fact: "Dato", interp: "Lectura", ev: "eventos", note: "Escrita a partir de números verificados; se actualiza con cada evento sin reescribir lo que ya pasó." }
    : { story: "Match story", summary: "In short", chapters: "Chapters", ht: "Half-time analysis", ft: "Full-time recap", players: "Most influential players", formula: "Custom PITCHIQ index (not an official statistic): xT added + xG + 0.05 × high recoveries.", empty: "The story starts with the first event.", fact: "Fact", interp: "Reading", ev: "events", note: "Written from verified numbers; it updates with each event and never rewrites what already happened." };

  if (!cut.length) return <p className="p-4 text-sm text-muted">{L.empty}</p>;

  const LineView = ({ l }: { l: Line }) => (
    <p className="leading-snug">
      <span className={`mr-1.5 rounded-sm px-1 py-px align-middle text-2xs font-bold uppercase tracking-wider ${l.kind === "fact" ? "bg-ink text-bg" : "ring-1 ring-line text-muted"}`}>
        {l.kind === "fact" ? L.fact : L.interp}
      </span>
      {l.text}{" "}
      {l.evidence.length > 0 && (
        <button onClick={() => onJump(Math.max(0, l.at ?? 0))} className="num whitespace-nowrap text-xs font-semibold text-accent" title={l.evidence.slice(0, 8).join(", ")}>
          ↺ {l.evidence.length} {L.ev}
        </button>
      )}
    </p>
  );

  return (
    <div className="flex flex-col gap-4 px-4 py-4">
      <section>
        <h3 className="eyebrow mb-2">{L.summary}</h3>
        <div className="flex flex-col gap-2 text-base">
          {summary.map((l, i) => <LineView key={i} l={l} />)}
        </div>
      </section>
      {ft.length > 0 && (
        <section className="rounded-lg bg-raised/60 p-3">
          <h3 className="eyebrow mb-2">🏁 {L.ft}</h3>
          <div className="flex flex-col gap-2 text-sm">{ft.map((l, i) => <LineView key={i} l={l} />)}</div>
        </section>
      )}
      {ht.length > 0 && (
        <section className="rounded-lg bg-raised/60 p-3">
          <h3 className="eyebrow mb-2">⏸ {L.ht}</h3>
          <div className="flex flex-col gap-2 text-sm">{ht.map((l, i) => <LineView key={i} l={l} />)}</div>
        </section>
      )}
      <section>
        <h3 className="eyebrow mb-2">{L.chapters} · {chapters.length}</h3>
        <ol className="relative flex flex-col gap-2 border-l border-line pl-4">
          {chapters.map((c, i) => {
            const tp = keyTps.find((t) => t.minute === c.minute && t.evidence === c.line.evidence);
            return (
              <li key={i} className="relative text-sm">
                <span className="absolute -left-[1.4rem] top-1 h-2.5 w-2.5 rounded-full" style={{ background: c.side ? palette[c.side] : "rgb(var(--muted))" }} />
                <span className="num mr-1 text-muted">{c.minute}′</span>
                <span className="mr-1">{c.icon}</span>
                {tp ? (
                  <button onClick={() => onTurning(tp)} className="text-left hover:underline">
                    {c.line.text}
                  </button>
                ) : (
                  <button onClick={() => onJump(Math.max(0, c.line.at ?? 0))} className="text-left hover:underline">
                    {c.line.text}
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      </section>
      <section>
        <h3 className="eyebrow mb-1">{L.players}</h3>
        <ol className="flex flex-col gap-1">
          {players.map((p) => (
            <li key={p.id} className="flex items-center gap-2 text-sm">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: palette[p.side] }} />
              <span className="font-semibold">{p.name}</span>
              <span className="text-muted">{p.side === "home" ? H : A}</span>
              <span className="num ml-auto text-xs text-muted">
                xT {x2(p.xt)} · xG {x2(p.xg)} · {p.rec} {es ? "recup." : "rec."}
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-1 text-2xs text-muted">{L.formula}</p>
      </section>
      <p className="text-2xs text-muted">{L.note}</p>
    </div>
  );
});
