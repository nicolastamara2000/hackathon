import * as d3 from "d3";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MatchMeta } from "../feed/types";
import type { Strings } from "../i18n/strings";
import type { TeamPalette } from "../lib/teamColors";
import type { KeyMoment, StatsSnapshot } from "../stats/engine";

const FULL_PLAY_S = 97 * 60; // axis length until the match tells us otherwise
const SPEEDS = [1, 2, 5, 20];

interface Props {
  meta: MatchMeta;
  stats: StatsSnapshot | null;
  /** full-match stats at the live edge, so the strip always shows everything received */
  liveStats: StatsSnapshot | null;
  playNow: number;
  playHead: number;
  /** play time of the first-half whistle (stoppage time makes it later than 45:00) */
  halfPlay: number;
  isLive: boolean;
  speed: number;
  palette: TeamPalette;
  t: Strings;
  onSeek(play_s: number): void;
  onLive(): void;
  /** offered only when the feed can change speed (the offline demo) */
  onSpeed?(s: number): void;
  /** turning points, drawn as diamonds on top of the wave */
  turning?: { id: string; play_s: number; side: "home" | "away"; impact: string; label: string; minute: number }[];
  selectedTurning?: string | null;
  onTurning?(id: string): void;
}

/**
 * Bottom strip: mirrored momentum wave (home up, away down) over a scrubbable
 * timeline with key-moment markers. Drag anywhere to scrub; markers jump 8 s before the moment.
 */
export function MomentumStrip({ meta, liveStats, playNow, playHead, halfPlay, isLive, speed, palette, t, onSeek, onLive, onSpeed, turning = [], selectedTurning, onTurning }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(900);
  const [hover, setHover] = useState<KeyMoment | null>(null);
  const [hoverTp, setHoverTp] = useState<Props["turning"] extends (infer U)[] | undefined ? U | null : never>(null);
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, e.contentRect.width)));
    ro.observe(wrap.current!);
    return () => ro.disconnect();
  }, []);

  const H = 112, waveH = 68, mid = waveH / 2 + 6, markY = waveH + 18;
  const end = Math.max(FULL_PLAY_S, playHead + 60);
  const x = useMemo(() => d3.scaleLinear().domain([0, end]).range([8, w - 8]), [w, end]);
  const m = liveStats?.momentum ?? [];
  const area = (side: "home" | "away") =>
    d3
      .area<(typeof m)[number]>()
      .x((d) => x(d.play_s + 30))
      .y0(mid)
      // sqrt keeps small swings visible next to a goal spike
      .y1((d) => (side === "home" ? mid - Math.sqrt(d.home) * (waveH / 2 - 2) : mid + Math.sqrt(d.away) * (waveH / 2 - 2)))
      .curve(d3.curveMonotoneX)(m) ?? "";
  const moments = (liveStats?.keyMoments ?? []).filter((k) => k.kind !== "shot");
  const ticks = [0, 15, 30, 45, 60, 75, 90].map((mm) => ({ mm, at: mm <= 45 ? mm * 60 : halfPlay + (mm - 45) * 60 }));

  const seekFromPointer = (clientX: number) => {
    const r = wrap.current!.getBoundingClientRect();
    const p = Math.max(0, Math.min(playHead, x.invert(clientX - r.left)));
    onSeek(p);
  };
  const drag = useRef(false);

  return (
    <section className="panel px-4 pb-2 pt-3" aria-label={t.momentum}>
      <div className="mb-1 flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="eyebrow">{t.momentum}</span>
        <Legend color={palette.home} label={`${meta.home.short_name} ▲`} />
        <Legend color={palette.away} label={`${meta.away.short_name} ▼`} />
        <div className="ml-auto flex items-center gap-2">
          {onSpeed && <span className="eyebrow hidden sm:inline">{t.speed}</span>}
          {onSpeed && <div className="flex overflow-hidden rounded-sm ring-1 ring-line" role="group" aria-label={t.speed}>
            {SPEEDS.map((s) => (
              <button
                key={s}
                onClick={() => onSpeed(s)}
                aria-pressed={speed === s}
                className={`num px-2 py-0.5 text-sm ${speed === s ? "bg-accent text-bg" : "text-muted hover:bg-raised"}`}
              >
                {s}×
              </button>
            ))}
          </div>}
          <button
            onClick={onLive}
            disabled={isLive}
            className="flex items-center gap-1.5 rounded-sm px-2 py-0.5 text-xs font-bold tracking-wider text-live ring-1 ring-live/60 disabled:opacity-50"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-live" />
            {isLive ? t.live : t.backToLive}
          </button>
        </div>
      </div>
      <div
        ref={wrap}
        className="relative cursor-ew-resize touch-none select-none"
        onPointerDown={(e) => {
          drag.current = true;
          (e.target as Element).setPointerCapture?.(e.pointerId);
          seekFromPointer(e.clientX);
        }}
        onPointerMove={(e) => drag.current && seekFromPointer(e.clientX)}
        onPointerUp={() => (drag.current = false)}
        role="slider"
        aria-label="Match timeline"
        aria-valuemin={0}
        aria-valuemax={Math.round(playHead / 60)}
        aria-valuenow={Math.round(playNow / 60)}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") onSeek(Math.max(0, playNow - 30));
          if (e.key === "ArrowRight") onSeek(playNow + 30);
        }}
      >
        <svg width={w} height={H} className="block">
          <defs>
            <pattern id="future" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="6" stroke="rgb(var(--line))" strokeWidth="2" />
            </pattern>
          </defs>
          {/* not played yet */}
          <rect x={x(playHead)} y={4} width={Math.max(0, x(end) - x(playHead))} height={waveH + 4} fill="url(#future)" opacity={0.5} />
          <line x1={x(0)} x2={x(end)} y1={mid} y2={mid} stroke="rgb(var(--line))" />
          <path d={area("home")} fill={palette.home} fillOpacity={0.85} />
          <path d={area("away")} fill={palette.away} fillOpacity={0.85} />
          {/* half-time divider */}
          <line x1={x(halfPlay)} x2={x(halfPlay)} y1={4} y2={markY + 8} stroke="rgb(var(--muted))" strokeDasharray="3 3" />
          {/* markers: shape encodes the kind, so color is never the only cue */}
          {moments.map((k) => (
            <g
              key={k.id}
              transform={`translate(${x(k.play_s)},${markY})`}
              className="cursor-pointer"
              onPointerDown={(e) => {
                e.stopPropagation();
                onSeek(Math.max(0, k.play_s - 8));
              }}
              onMouseEnter={() => setHover(k)}
              onMouseLeave={() => setHover(null)}
            >
              <Marker k={k} palette={palette} />
            </g>
          ))}
          {/* turning points: diamonds above the wave, size = impact */}
          {turning.map((tp) => {
            const r = tp.impact === "high" ? 6 : 4.5;
            const sel = tp.id === selectedTurning;
            return (
              <g
                key={tp.id}
                transform={`translate(${x(tp.play_s)},${8})`}
                className="cursor-pointer"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onTurning?.(tp.id);
                }}
                onMouseEnter={() => setHoverTp(tp)}
                onMouseLeave={() => setHoverTp(null)}
              >
                <rect x={-r} y={-r} width={2 * r} height={2 * r} transform="rotate(45)" fill={palette[tp.side]} stroke={sel ? "rgb(var(--accent))" : "rgb(var(--ink))"} strokeWidth={sel ? 3 : 1} />
              </g>
            );
          })}
          {ticks.map((tk) => (
            <text key={tk.mm} x={x(tk.at)} y={H - 2} textAnchor="middle" className="num fill-muted" fontSize={12}>
              {tk.mm}′
            </text>
          ))}
          {/* playhead */}
          <g transform={`translate(${x(playNow)},0)`}>
            <line y1={2} y2={markY + 10} stroke="rgb(var(--ink))" strokeWidth={2} />
            <circle cy={2} r={5} fill="rgb(var(--ink))" />
          </g>
        </svg>
        {hoverTp && (
          <div
            className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded bg-raised px-2 py-1 text-xs shadow-[var(--shadow)]"
            style={{ left: x(hoverTp.play_s) }}
          >
            <span className="num mr-1 text-muted">{hoverTp.minute}′</span>◆ {hoverTp.label}
          </div>
        )}
        {hover && (
          <div
            className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded bg-raised px-2 py-1 text-xs shadow-[var(--shadow)]"
            style={{ left: x(hover.play_s) }}
          >
            <span className="num mr-1 text-muted">{hover.minute}′</span>
            {momentLabel(hover, t)} {hover.player ? `· ${hover.player}` : ""}
            {hover.xg !== undefined ? <span className="num ml-1 text-muted">xG {hover.xg.toFixed(2)}</span> : null}
          </div>
        )}
      </div>
    </section>
  );
}

export function momentLabel(k: KeyMoment, t: Strings) {
  switch (k.kind) {
    case "goal":
      return `⚽ ${t.goal}`;
    case "big_chance":
      return `🎯 ${t.bigChance}`;
    case "yellow":
      return `🟨 ${t.yellow}`;
    case "red":
      return `🟥 ${t.red}`;
    case "sub":
      return `🔁 ${t.sub}`;
    case "half":
      return k.detail === "Half End" ? t.ht : t.half2;
    default:
      return k.detail ?? "";
  }
}

function Marker({ k, palette }: { k: KeyMoment; palette: TeamPalette }) {
  const c = k.side === "home" ? palette.home : k.side === "away" ? palette.away : "rgb(var(--muted))";
  const dy = k.side === "away" ? 7 : k.side === "home" ? -7 : 0;
  switch (k.kind) {
    case "goal":
      return (
        <g transform={`translate(0,${dy})`}>
          <circle r={8} fill={c} stroke="rgb(var(--ink))" strokeWidth={2} />
          <circle r={3} fill="rgb(var(--ink))" />
        </g>
      );
    case "big_chance":
      return <path transform={`translate(0,${dy})`} d="M0 -6 L6 5 L-6 5 Z" fill="none" stroke={c} strokeWidth={2} />;
    case "yellow":
    case "red":
      return <rect x={-3.5} y={dy - 5} width={7} height={10} rx={1} fill={k.kind === "red" ? "#D55E00" : "#F0E442"} stroke="#0B0F14" />;
    case "sub":
      return (
        <text y={dy + 4} textAnchor="middle" fontSize={11} fill={c} fontWeight={700}>
          ⇄
        </text>
      );
    default:
      return null;
  }
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted">
      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  );
}
