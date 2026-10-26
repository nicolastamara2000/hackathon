import * as d3 from "d3";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MatchEvent, XY } from "../feed/types";
import type { Strings } from "../i18n/strings";
import type { TeamPalette } from "../lib/teamColors";
import { ballAt, buildBallPath, fromDisplay, keyAt, lineupAt, slotTarget, toDisplay, type OnPitch } from "../pitch/motion";
import type { MatchFeed } from "../state/useMatchFeed";
import type { Layer, MapFilter } from "../pitch/layers";
import type { TurningPoint } from "../stats/turning";
import { MapLayer, MapLegend } from "./MapLayer";

const ASPECT = 105 / 68;
const TRAIL_KEYS = 6;
const SPRINT_KMH = 25;

/** Ball-speed color: Okabe-Ito blue -> yellow -> orange -> vermillion. Width also grows with speed. */
export const speedColor = d3
  .scaleLinear<string>()
  .domain([0, 40, 80, 120])
  .range(["#56B4E9", "#F0E442", "#E69F00", "#D55E00"])
  .clamp(true);

const surname = (name: string) => name.split(" ").slice(-1)[0].toUpperCase();
/** Approximate label width for Inter semibold caps. */
const labelW = (text: string, font: number) => text.length * font * 0.66;

interface Props {
  feed: MatchFeed;
  palette: TeamPalette;
  t: Strings;
  focusPlayerId?: string;
  /** event map drawn over the live players ("live" = none) */
  layer?: Layer;
  insight?: TurningPoint | null;
  filter?: MapFilter;
  onPick?(clock_s: number): void;
  /** overlays, drawn inside the pitch box */
  children?: React.ReactNode;
}

export function Pitch({ feed, palette, t, focusPlayerId, layer = "live", insight, filter = {}, onPick = () => {}, children }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const dyn = useRef<SVGGElement>(null);
  const [size, setSize] = useState({ w: 800, h: 800 / ASPECT });

  useEffect(() => {
    const el = wrap.current!;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      const w = Math.max(240, Math.min(width, height * ASPECT));
      setSize({ w, h: w / ASPECT });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { w, h } = size;
  const pad = Math.max(8, w * 0.012);
  const x = useMemo(() => d3.scaleLinear().domain([0, 120]).range([pad, w - pad]), [w, pad]);
  const y = useMemo(() => d3.scaleLinear().domain([0, 80]).range([pad, h - pad]), [h, pad]);
  const meta = feed.meta;
  const keysRef = useRef<ReturnType<typeof buildBallPath>>([]);
  const posRef = useRef(new Map<string, XY>());
  useMemo(() => {
    keysRef.current = meta ? buildBallPath(feed.events, meta.home.id) : [];
  }, [feed.version, meta]); // eslint-disable-line react-hooks/exhaustive-deps

  // animation loop: d3 owns the dynamic layer, React owns the static pitch
  useEffect(() => {
    if (!meta || !dyn.current) return;
    const g = d3.select(dyn.current);
    const homeId = meta.home.id;
    const pos = posRef.current;
    let lineup: OnPitch[] = [];
    let lineupAtT = -Infinity;
    let raf = 0;
    let prev = performance.now();
    const unit = (w - 2 * pad) / 120;
    const r = Math.max(5, unit * 1.45);
    const font = Math.max(10, Math.min(16, w / 85));

    const trail = g.select<SVGGElement>("g.trail");
    const players = g.select<SVGGElement>("g.players");
    const ball = g.select<SVGCircleElement>("circle.ball");

    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - prev) / 1000);
      prev = now;
      const tc = feed.clockRef.current;
      const keys = keysRef.current;
      const evs = feed.events;
      if (Math.abs(tc - lineupAtT) > 1) {
        lineup = lineupAt(meta, evs, tc);
        lineupAtT = tc;
      }
      const b = ballAt(keys, tc);
      const ci = keyAt(evs, tc, (e) => e.clock_s);
      const cur = ci >= 0 ? evs[ci] : undefined;
      const period = cur?.period ?? 1;
      const possTeam = cur?.possession_team_id;
      const keyEv: MatchEvent | undefined = b ? evs[keys[b.i].eventIndex] : undefined;
      const arrived = b && keys[b.i + 1] === undefined ? true : b ? keys[b.i].t !== keyEv?.clock_s : false;
      const k = 1 - Math.exp(-dt * Math.min(18, 3 * Math.sqrt(feed.speed)));

      const tagged = new Set<string>();
      if (keyEv?.player_id) tagged.add(keyEv.player_id);
      if (keyEv?.recipient_id) tagged.add(keyEv.recipient_id);
      if (focusPlayerId) tagged.add(focusPlayerId);

      // sprint badge: latest event with a running speed over 25 km/h, shown for 4 s of match time
      let sprint: { id: string; kmh: number } | null = null;
      for (let i = ci; i >= 0 && i > ci - 12; i--) {
        const e = evs[i];
        if (tc - e.clock_s > 4) break;
        if ((e.player_speed_kmh ?? 0) >= SPRINT_KMH && e.player_id) {
          sprint = { id: e.player_id, kmh: e.player_speed_kmh! };
          break;
        }
      }

      for (const o of lineup) {
        const id = o.player.id;
        let target: XY;
        if (b && keyEv && id === keyEv.player_id && !(keyEv.type === "Pass" && arrived)) {
          target = keyEv.type === "Pass" || keyEv.type === "Shot" ? toDisplay(keyEv.location!, keyEv.team_id, keyEv.period, homeId) : b.p;
        } else if (b && keyEv && id === keyEv.recipient_id && keyEv.end_location) {
          target = toDisplay(keyEv.end_location, keyEv.team_id, keyEv.period, homeId);
        } else if (b && cur?.type === "Pressure" && id === cur.player_id && tc - cur.clock_s < 2) {
          target = [b.p[0] + (o.team === "home" ? -1.2 : 1.2), b.p[1] + 1];
        } else {
          const own = b ? fromDisplay(b.p, o.teamId, period, homeId) : ([60, 40] as XY);
          const seed = parseInt(id.split("-")[1] ?? "0", 10);
          const slot = slotTarget(o, own, possTeam === o.teamId, tc * 0.05 + seed);
          target = toDisplay(slot, o.teamId, period, homeId);
        }
        const p = pos.get(id) ?? target;
        pos.set(id, [p[0] + (target[0] - p[0]) * k, p[1] + (target[1] - p[1]) * k]);
      }

      // players
      const sel = players
        .selectAll<SVGGElement, OnPitch>("g.pl")
        .data(lineup, (d) => d.player.id)
        .join((enter) => {
          const gg = enter.append("g").attr("class", "pl");
          gg.append("circle").attr("class", "dot");
          gg.append("text").attr("class", "no num").attr("text-anchor", "middle").attr("dominant-baseline", "central");
          const tag = gg.append("g").attr("class", "tag");
          tag.append("rect").attr("rx", 3);
          tag.append("text").attr("class", "tagtext").attr("text-anchor", "middle").attr("dominant-baseline", "central");
          const sp = gg.append("g").attr("class", "sprint");
          sp.append("rect").attr("rx", 3);
          sp.append("text").attr("text-anchor", "middle").attr("dominant-baseline", "central");
          return gg;
        });
      sel.attr("transform", (d) => {
        const p = pos.get(d.player.id)!;
        return `translate(${x(p[0])},${y(p[1])})`;
      });
      sel
        .select<SVGCircleElement>("circle.dot")
        .attr("r", (d) => (d.player.id === focusPlayerId ? r * 1.3 : r))
        .attr("fill", (d) => (d.team === "home" ? palette.home : palette.away))
        .attr("stroke", (d) => (tagged.has(d.player.id) ? "#FFFFFF" : "rgb(0 0 0 / 0.55)"))
        .attr("stroke-width", (d) => (tagged.has(d.player.id) ? 2 : 1));
      sel
        .select<SVGTextElement>("text.no")
        .attr("font-size", r * 1.05)
        .attr("font-weight", 700)
        .attr("fill", (d) => (d.team === "home" ? palette.onHome : palette.onAway))
        .text((d) => d.player.number);
      const tag = sel.select<SVGGElement>("g.tag").attr("display", (d) => (tagged.has(d.player.id) ? null : "none"));
      tag
        .select<SVGTextElement>("text")
        .attr("y", -r - font * 0.9)
        .attr("font-size", font)
        .attr("font-weight", 600)
        .attr("fill", "#F2F5F8")
        .text((d) => `${d.player.number} ${surname(d.player.name)}`);
      // sized from the label length: getBBox on every frame forces a layout and drops frames
      tag
        .select("rect")
        .attr("x", (d) => -labelW(`${d.player.number} ${surname(d.player.name)}`, font) / 2 - 5)
        .attr("y", -r - font * 1.55)
        .attr("width", (d) => labelW(`${d.player.number} ${surname(d.player.name)}`, font) + 10)
        .attr("height", font * 1.3)
        .attr("fill", "rgb(11 15 20 / 0.82)");
      const sp = sel.select<SVGGElement>("g.sprint").attr("display", (d) => (sprint && d.player.id === sprint.id ? null : "none"));
      sp.select<SVGTextElement>("text")
        .attr("y", r + font * 0.95)
        .attr("font-size", font * 0.9)
        .attr("font-weight", 700)
        .attr("fill", "#0B0F14")
        .text(sprint ? `⚡ ${Math.round(sprint.kmh)} km/h` : "");
      const spW = sprint ? labelW(`⚡ ${Math.round(sprint.kmh)} km/h`, font * 0.9) + 8 : 0;
      sp.select("rect")
        .attr("x", -spW / 2)
        .attr("y", r + font * 0.35)
        .attr("width", spW)
        .attr("height", font * 1.15)
        .attr("fill", "#F0E442");

      // ball + speed trail (color and width both encode speed)
      if (b) {
        const pts = keys.slice(Math.max(0, b.i - TRAIL_KEYS + 1), b.i + 1).map((kk) => ({ p: kk.p, kmh: kk.kmh }));
        pts.push({ p: b.p, kmh: b.kmh });
        const segs = pts.slice(1).map((q, i) => ({ a: pts[i].p, b: q.p, kmh: q.kmh, age: pts.length - 2 - i }));
        trail
          .selectAll<SVGLineElement, (typeof segs)[number]>("line")
          .data(segs)
          .join("line")
          .attr("x1", (s) => x(s.a[0]))
          .attr("y1", (s) => y(s.a[1]))
          .attr("x2", (s) => x(s.b[0]))
          .attr("y2", (s) => y(s.b[1]))
          .attr("stroke", (s) => speedColor(s.kmh))
          .attr("stroke-width", (s) => 1.5 + (Math.min(120, s.kmh) / 120) * 4)
          .attr("stroke-linecap", "round")
          .attr("opacity", (s) => Math.max(0.15, 1 - s.age * 0.17));
        ball.attr("cx", x(b.p[0])).attr("cy", y(b.p[1])).attr("r", Math.max(4, r * 0.6)).attr("display", null);
        players.raise();
        ball.raise();
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [meta, x, y, w, pad, palette, focusPlayerId, feed.clockRef, feed.events, feed.speed]);

  // static markings, in metres
  const mx = (m: number) => x((m * 120) / 105);
  const my = (m: number) => y((m * 80) / 68);
  const stripes = d3.range(12);
  const period = feed.stats?.period ?? 1;
  const map = layer !== "live";
  const homeRight = map || period !== 2; // maps use a fixed frame: home attacks right
  const now = Math.floor(feed.clock);
  const shown = useMemo(() => feed.events.filter((e) => e.clock_s <= now), [feed.version, now]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={wrap} className="absolute inset-0 flex items-center justify-center">
      <div className="relative" style={{ width: w, height: h }}>
      <svg width={w} height={h} role="img" aria-label="Live pitch" className="block rounded-lg shadow-[var(--shadow)]">
        <rect width={w} height={h} rx={8} fill="rgb(var(--pitch))" />
        {stripes.map((i) =>
          i % 2 ? (
            <rect key={i} x={x((i * 120) / 12)} y={y(0)} width={x(10) - x(0)} height={y(80) - y(0)} fill="rgb(var(--pitch-stripe))" />
          ) : null,
        )}
        <g fill="none" stroke="rgb(var(--pitch-line) / 0.55)" strokeWidth={1.5}>
          <rect x={x(0)} y={y(0)} width={x(120) - x(0)} height={y(80) - y(0)} />
          <line x1={x(60)} x2={x(60)} y1={y(0)} y2={y(80)} />
          <circle cx={x(60)} cy={y(40)} r={mx(9.15) - mx(0)} />
          {[0, 1].map((side) => {
            const X = (m: number) => (side ? mx(105 - m) : mx(m));
            const w16 = X(16.5) - X(0), w5 = X(5.5) - X(0);
            return (
              <g key={side}>
                <rect x={Math.min(X(0), X(16.5))} y={my(34 - 20.16)} width={Math.abs(w16)} height={my(40.32) - my(0)} />
                <rect x={Math.min(X(0), X(5.5))} y={my(34 - 9.16)} width={Math.abs(w5)} height={my(18.32) - my(0)} />
                <rect
                  x={side ? X(0) : X(0) - (mx(2) - mx(0))}
                  y={my(34 - 3.66)}
                  width={mx(2) - mx(0)}
                  height={my(7.32) - my(0)}
                  stroke="rgb(var(--pitch-line) / 0.8)"
                />
                <circle cx={X(11)} cy={my(34)} r={2} fill="rgb(var(--pitch-line) / 0.7)" />
              </g>
            );
          })}
          <circle cx={x(60)} cy={y(40)} r={2} fill="rgb(var(--pitch-line) / 0.7)" />
        </g>
        <g ref={dyn} opacity={map ? 0.28 : 1}>
          <g className="trail" />
          <g className="players" />
          <circle className="ball" fill="#FFFFFF" stroke="#0B0F14" strokeWidth={1.5} display="none" />
        </g>
        {meta && map && (
          <MapLayer insight={insight} layer={layer} meta={meta} events={shown} now={now} filter={filter} palette={palette} x={x} y={y} onPick={onPick} />
        )}
        {meta && (
          <g className="font-sans" fontSize={Math.max(11, w / 90)} fontWeight={600} fill="rgb(var(--pitch-line) / 0.8)">
            <text x={x(homeRight ? 2 : 118)} y={y(80) - 4} textAnchor={homeRight ? "start" : "end"}>
              {homeRight ? `${meta.home.short_name} ${t.attacking} →` : `← ${meta.home.short_name} ${t.attacking}`}
            </text>
            <text x={x(homeRight ? 118 : 2)} y={y(0) + Math.max(11, w / 90) + 2} textAnchor={homeRight ? "end" : "start"}>
              {homeRight ? `← ${meta.away.short_name} ${t.attacking}` : `${meta.away.short_name} ${t.attacking} →`}
            </text>
          </g>
        )}
      </svg>
      {map ? <MapLegend layer={layer} labels={t as unknown as Record<string, string>} /> : <SpeedLegend label={t.ballSpeed} />}
      {children}
      </div>
    </div>
  );
}

function SpeedLegend({ label }: { label: string }) {
  const stops = [0, 40, 80, 120];
  return (
    <div className="pointer-events-none absolute bottom-8 right-4 hidden rounded bg-bg/80 px-2 py-1.5 text-2xs text-muted backdrop-blur sm:block">
      <div className="mb-1">{label}</div>
      <svg width={132} height={14} aria-hidden>
        <defs>
          <linearGradient id="spd">
            {stops.map((s) => (
              <stop key={s} offset={`${(s / 120) * 100}%`} stopColor={speedColor(s)} />
            ))}
          </linearGradient>
        </defs>
        <path d="M2 9 L130 4 L130 12 L2 10 Z" fill="url(#spd)" />
      </svg>
      <div className="num flex justify-between text-xs text-ink">
        {stops.map((s) => (
          <span key={s}>{s}</span>
        ))}
      </div>
    </div>
  );
}
