import { memo } from "react";
import { Area, AreaChart, Line, LineChart, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from "recharts";
import type { MatchEvent, MatchMeta } from "../feed/types";
import type { Locale, Strings } from "../i18n/strings";
import type { TeamPalette } from "../lib/teamColors";
import { physicalAt, sideOf } from "../pitch/layers";
import type { Side, StatsSnapshot } from "../stats/engine";
import { difficultyColor } from "./MapLayer";

interface Props {
  metric: string;
  meta: MatchMeta;
  stats: StatsSnapshot;
  events: MatchEvent[]; // cut at the playhead
  palette: TeamPalette;
  locale: Locale;
  t: Strings;
  simple?: boolean; // fan mode: big numbers and one sentence, no chart
  playerId?: string;
  onJump(clock_s: number): void;
}

const surname = (n: string) => n.split(" ").slice(-1)[0];

/**
 * The one metric the viewer picked, explained: two big numbers, one sentence
 * that says why it matters, and the chart or list behind it.
 */
export const Spotlight = memo(function Spotlight({ metric, meta, stats, events, palette, locale, t, simple, playerId, onJump }: Props) {
  if (!metric) return null;
  const es = locale !== "en";
  const H = meta.home.short_name, A = meta.away.short_name;
  const color = (s: Side) => palette[s];
  let title = "";
  let big: [string, string] = ["–", "–"];
  let line = "";
  let body: React.ReactNode = null;

  if (metric === "xg") {
    title = t.metricXg;
    const shots = events.filter((e) => e.type === "Shot");
    const best = shots.reduce<MatchEvent | null>((a, b) => ((b.xg ?? 0) > (a?.xg ?? -1) ? b : a), null);
    big = [stats.home.xg.toFixed(2), stats.away.xg.toFixed(2)];
    const lead: Side = stats.home.xg >= stats.away.xg ? "home" : "away";
    const goals = stats.score[lead === "home" ? 0 : 1];
    const diff = Math.abs(stats.home.xg - stats.away.xg);
    line = es
      ? `${meta[lead].short_name} creó ${diff.toFixed(2)} xG más con ${stats[lead].shots} tiros. ${goals > stats[lead].xg + 0.5 ? "Está siendo más efectivo de lo esperado." : goals + 0.8 < stats[lead].xg ? "Merece más goles de los que tiene." : "El marcador refleja las ocasiones."}`
      : `${meta[lead].short_name} created ${diff.toFixed(2)} more xG from ${stats[lead].shots} shots. ${goals > stats[lead].xg + 0.5 ? "They are finishing above expectation." : goals + 0.8 < stats[lead].xg ? "They deserve more goals than they have." : "The score matches the chances."}`;
    body = (
      <>
        {!simple && (
          <div className="h-32">
            <ResponsiveContainer>
              <LineChart data={stats.xgTimeline} margin={{ top: 6, right: 8, bottom: 0, left: -24 }}>
                <XAxis dataKey="minute" tick={{ fontSize: 11, fill: "rgb(var(--muted))" }} type="number" domain={[0, 95]} ticks={[0, 15, 30, 45, 60, 75, 90]} />
                <YAxis tick={{ fontSize: 11, fill: "rgb(var(--muted))" }} />
                <Line type="stepAfter" dataKey="home" stroke={palette.home} strokeWidth={2.5} dot={false} isAnimationActive={false} />
                <Line type="stepAfter" dataKey="away" stroke={palette.away} strokeWidth={2.5} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
        {best && (
          <button onClick={() => onJump(best.clock_s - 5)} className="mt-2 w-full rounded bg-raised/60 px-3 py-2 text-left text-sm hover:bg-raised">
            <span className="text-muted">{es ? "Mejor ocasión" : "Best chance"}: </span>
            <span className="num font-semibold">{best.minute}′ {surname(best.player_name ?? "")} · {(best.xg ?? 0).toFixed(2)} xG · {best.outcome}</span>
          </button>
        )}
      </>
    );
  }

  if (metric === "control") {
    title = t.metricControl;
    big = [`${Math.round(stats.home.possession * 100)}%`, `${Math.round(stats.away.possession * 100)}%`];
    const cc = Math.round(stats.controlChaos);
    const who = stats.controlSide ? meta[stats.controlSide].short_name : null;
    line =
      cc > 25 && who
        ? es ? `${who} controla: ${cc}/100. Tiene ${Math.round(stats[stats.controlSide!].fieldTilt * 100)}% de los pases en el último tercio.` : `${who} in control: ${cc}/100. They own ${Math.round(stats[stats.controlSide!].fieldTilt * 100)}% of final-third passes.`
        : cc < -25
          ? es ? `Caos: ${cc}/100. Pérdidas y transiciones rápidas en ambos lados.` : `Chaos: ${cc}/100. Quick turnovers and transitions both ways.`
          : es ? `Equilibrado: ${cc}/100. Nadie domina el medio.` : `Balanced: ${cc}/100. Nobody owns midfield.`;
    const data = stats.momentum.map((m) => ({ minute: Math.round(m.play_s / 60), v: Math.round((m.home - m.away) * 100) }));
    body = !simple && (
      <div className="h-28">
        <ResponsiveContainer>
          <AreaChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -24 }}>
            <defs>
              <linearGradient id="mom" x1="0" x2="0" y1="0" y2="1">
                <stop offset="50%" stopColor={palette.home} stopOpacity={0.7} />
                <stop offset="50%" stopColor={palette.away} stopOpacity={0.7} />
              </linearGradient>
            </defs>
            <XAxis dataKey="minute" tick={{ fontSize: 11, fill: "rgb(var(--muted))" }} />
            <YAxis domain={[-100, 100]} ticks={[-100, 0, 100]} tick={{ fontSize: 11, fill: "rgb(var(--muted))" }} />
            <ReferenceLine y={0} stroke="rgb(var(--line))" />
            <Area dataKey="v" type="monotone" stroke="none" fill="url(#mom)" isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (metric === "pass_difficulty") {
    title = t.metricPass;
    big = [String(Math.round(stats.home.avgDifficulty)), String(Math.round(stats.away.avgDifficulty))];
    const hard = events
      .filter((e) => e.type === "Pass" && e.outcome === "Complete" && (e.pass_difficulty ?? 0) >= 60 && (!playerId || e.player_id === playerId))
      .sort((a, b) => (b.pass_difficulty ?? 0) - (a.pass_difficulty ?? 0));
    const hs = hard.filter((e) => sideOf(meta, e.team_id) === "home").length;
    line = es
      ? `Pases difíciles completados (60+): ${H} ${hs}, ${A} ${hard.length - hs}. Más alto = pase más largo, bajo presión o en zona cerrada.`
      : `Hard passes completed (60+): ${H} ${hs}, ${A} ${hard.length - hs}. Higher = longer, under pressure or into a tight zone.`;
    body = (
      <ol className="flex flex-col gap-1">
        {hard.slice(0, simple ? 1 : 4).map((e) => (
          <li key={e.id}>
            <button onClick={() => onJump(e.clock_s - 4)} className="flex w-full items-center gap-2 rounded bg-raised/60 px-3 py-1.5 text-left text-sm hover:bg-raised">
              <span className="num w-8 rounded-sm text-center font-bold text-bg" style={{ background: difficultyColor(e.pass_difficulty ?? 0) }}>
                {e.pass_difficulty}
              </span>
              <span className="num">{e.minute}′</span>
              <span className="truncate">
                {surname(e.player_name ?? "")} → {surname(e.recipient_name ?? "")}
              </span>
              <span className="num ml-auto text-muted">{Math.round(e.pass_length_m ?? 0)} m</span>
            </button>
          </li>
        ))}
      </ol>
    );
  }

  if (metric === "speed" || metric === "distance") {
    const phys = physicalAt(events);
    const all = [...meta.home.lineup, ...meta.home.bench, ...meta.away.lineup, ...meta.away.bench];
    const sideFor = (id: string): Side => (meta.home.lineup.concat(meta.home.bench).some((p) => p.id === id) ? "home" : "away");
    const top = new Map<string, number>();
    for (const e of events) if (e.player_id && e.player_speed_kmh) top.set(e.player_id, Math.max(top.get(e.player_id) ?? 0, e.player_speed_kmh));
    for (const [id, p] of phys) top.set(id, Math.max(top.get(id) ?? 0, p.top_speed_kmh));
    const value = (id: string) => (metric === "speed" ? top.get(id) ?? 0 : (phys.get(id)?.distance_m ?? 0) / 1000);
    const rows = all
      .map((p) => ({ p, side: sideFor(p.id), v: value(p.id) }))
      .filter((r) => r.v > 0)
      .sort((a, b) => b.v - a.v);
    const max = rows[0]?.v || 1;
    const fmt = (v: number) => (metric === "speed" ? `${v.toFixed(1)}` : v.toFixed(1));
    const unit = metric === "speed" ? "km/h" : "km";
    title = metric === "speed" ? `${t.metricSpeed} (km/h)` : `${t.metricDistance} (km)`;
    if (metric === "speed") {
      const best = (s: Side) => Math.max(0, ...rows.filter((r) => r.side === s).map((r) => r.v));
      big = [fmt(best("home")), fmt(best("away"))];
    } else {
      const tot = (s: Side) => rows.filter((r) => r.side === s).reduce((n, r) => n + r.v, 0);
      big = [tot("home").toFixed(1), tot("away").toFixed(1)];
    }
    const lead = rows[0];
    line = lead
      ? metric === "speed"
        ? es ? `${lead.p.name} es el más rápido: ${fmt(lead.v)} km/h. Más de 25 km/h cuenta como sprint.` : `${lead.p.name} is the fastest: ${fmt(lead.v)} km/h. Over 25 km/h counts as a sprint.`
        : es ? `${lead.p.name} es el que más corrió: ${fmt(lead.v)} km. Un mediocampista promedio hace ~11 km en 90′.` : `${lead.p.name} has run the most: ${fmt(lead.v)} km. An average midfielder covers ~11 km in 90′.`
      : es ? "Los datos físicos llegan cada pocos minutos." : "Physical data arrives every few minutes.";
    const shown = playerId ? rows.filter((r, i) => i < 4 || r.p.id === playerId) : rows.slice(0, simple ? 3 : 6);
    body = (
      <ol className="flex flex-col gap-1">
        {shown.slice(0, simple ? 3 : 6).map((r, i) => (
          <li key={r.p.id} className={`grid grid-cols-[1.25rem_minmax(0,7.5rem)_1fr_3.5rem] items-center gap-2 text-sm ${r.p.id === playerId ? "font-bold" : ""}`}>
            <span className="num text-muted">{rows.indexOf(r) + 1 || i + 1}</span>
            <span className="truncate">{surname(r.p.name)}</span>
            <span className="h-2.5 rounded-sm" style={{ width: `${(r.v / max) * 100}%`, background: color(r.side) }} />
            <span className="num text-right">
              {fmt(r.v)} <span className="text-2xs text-muted">{unit}</span>
            </span>
          </li>
        ))}
      </ol>
    );
  }

  return (
    <section className="border-b border-line px-4 py-3">
      <div className="eyebrow mb-2 flex items-center gap-2">
        <span className="rounded-sm bg-accent px-1.5 py-px text-2xs font-bold text-bg">{es ? "TU MÉTRICA" : "YOUR METRIC"}</span>
        {title}
      </div>
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-xs text-muted">{H}</div>
          <div className={`num font-bold leading-none ${simple ? "text-tv-lg" : "text-tv-md"}`} style={{ color: color("home") }}>
            {big[0]}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted">{A}</div>
          <div className={`num font-bold leading-none ${simple ? "text-tv-lg" : "text-tv-md"}`} style={{ color: color("away") }}>
            {big[1]}
          </div>
        </div>
      </div>
      <p className={`my-2 leading-snug ${simple ? "text-lg" : "text-sm"}`}>{line}</p>
      {body}
    </section>
  );
});
