import * as d3 from "d3";
import { memo } from "react";
import type { MatchEvent, MatchMeta } from "../feed/types";
import type { TeamPalette } from "../lib/teamColors";
import {
  passMarks, shotMarks, speedMarks, touchGrid, zoneControl,
  TOUCH_COLS, TOUCH_ROWS, ZONE_COLS, ZONE_ROWS, type Layer, type MapFilter,
} from "../pitch/layers";

/** Pass difficulty 0..100: Okabe-Ito blue (easy) -> yellow -> vermillion (hard). */
export const difficultyColor = d3.scaleLinear<string>().domain([0, 40, 70, 100]).range(["#56B4E9", "#F0E442", "#E69F00", "#D55E00"]).clamp(true);

/** Running speed of a sprint, 20..34 km/h, on the same Okabe-Ito ramp. */
const sprintColor = d3.scaleLinear<string>().domain([20, 25, 29, 33]).range(["#56B4E9", "#F0E442", "#E69F00", "#D55E00"]).clamp(true);

type Scale = d3.ScaleLinear<number, number>;

interface Props {
  layer: Exclude<Layer, "live">;
  meta: MatchMeta;
  events: MatchEvent[]; // already cut at the playhead
  now: number;
  filter: MapFilter;
  palette: TeamPalette;
  x: Scale;
  y: Scale;
  onPick(clock_s: number): void;
}

/** One event map over the pitch. Every mark is clickable and jumps to its moment. */
export const MapLayer = memo(function MapLayer({ layer, meta, events, now, filter, palette, x, y, onPick }: Props) {
  const unit = x(1) - x(0);
  const col = (s: "home" | "away") => palette[s];

  if (layer === "shots") {
    const shots = shotMarks(meta, events, filter);
    return (
      <g>
        {shots.map((s) => {
          const r = 4 + Math.sqrt(s.xg) * unit * 3.2;
          const goal = s.outcome === "Goal";
          const gx = s.side === "home" ? 120 : 0;
          return (
            <g key={s.id} className="cursor-pointer" onClick={() => onPick(s.clock_s - 4)}>
              <line x1={x(s.p[0])} y1={y(s.p[1])} x2={x(gx)} y2={y(40)} stroke={col(s.side)} strokeOpacity={goal ? 0.7 : 0.18} strokeWidth={goal ? 2 : 1} />
              <circle
                cx={x(s.p[0])}
                cy={y(s.p[1])}
                r={r}
                fill={goal ? col(s.side) : s.outcome === "Saved" ? col(s.side) : "transparent"}
                fillOpacity={goal ? 1 : s.outcome === "Saved" ? 0.45 : 0}
                stroke={goal ? "#FFFFFF" : col(s.side)}
                strokeWidth={goal ? 3 : 2}
              >
                <title>{`${s.minute}′ ${s.player} · xG ${s.xg.toFixed(2)} · ${s.outcome}`}</title>
              </circle>
              {(goal || s.xg >= 0.3) && (
                <text x={x(s.p[0])} y={y(s.p[1]) - r - 4} textAnchor="middle" className="num" fontSize={Math.max(11, unit * 1.6)} fontWeight={700} fill="#F2F5F8" stroke="#0B0F14" strokeWidth={3} paintOrder="stroke">
                  {goal ? "⚽ " : ""}
                  {s.xg.toFixed(2)}
                </text>
              )}
            </g>
          );
        })}
      </g>
    );
  }

  if (layer === "passes") {
    const passes = passMarks(meta, events, filter, filter.playerId ? 400 : 160);
    return (
      <g>
        <defs>
          {["c", "i"].map((k) => (
            <marker key={k} id={`arr-${k}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill={k === "c" ? "#F2F5F8" : "#9AA4AE"} />
            </marker>
          ))}
        </defs>
        {passes.map((p, i) => (
          <line
            key={p.id}
            x1={x(p.a[0])}
            y1={y(p.a[1])}
            x2={x(p.b[0])}
            y2={y(p.b[1])}
            stroke={difficultyColor(p.difficulty)}
            strokeWidth={p.progressive ? 2.6 : 1.6}
            strokeDasharray={p.complete ? undefined : "4 3"}
            strokeOpacity={0.35 + 0.65 * ((i + 1) / passes.length)}
            markerEnd={p.complete ? "url(#arr-c)" : "url(#arr-i)"}
          />
        ))}
      </g>
    );
  }

  if (layer === "zones") {
    const cells = zoneControl(meta, events, now);
    const w = (x(120) - x(0)) / ZONE_COLS, h = (y(80) - y(0)) / ZONE_ROWS;
    return (
      <g>
        {cells.map((c) => {
          const n = c.home + c.away;
          const share = n ? c.home / n : 0.5;
          const owner = share > 0.55 ? "home" : share < 0.45 ? "away" : null;
          const strength = owner ? Math.abs(share - 0.5) * 2 : 0;
          return (
            <g key={`${c.col}-${c.row}`}>
              <rect
                x={x(0) + c.col * w + 1}
                y={y(0) + c.row * h + 1}
                width={w - 2}
                height={h - 2}
                fill={owner ? col(owner) : "#9AA4AE"}
                fillOpacity={owner ? 0.18 + strength * 0.5 : n ? 0.12 : 0}
              />
              {n > 0 && (
                <text x={x(0) + c.col * w + w / 2} y={y(0) + c.row * h + h / 2} textAnchor="middle" dominantBaseline="central" className="num" fontSize={Math.max(12, unit * 2.2)} fontWeight={700} fill="#F2F5F8" stroke="#0B0F14" strokeWidth={3} paintOrder="stroke">
                  {owner ? `${meta[owner].short_name} ${Math.round((owner === "home" ? share : 1 - share) * 100)}%` : "50–50"}
                </text>
              )}
            </g>
          );
        })}
      </g>
    );
  }

  if (layer === "speed") {
    const marks = speedMarks(meta, events, filter);
    const top = [...marks].sort((a, b) => b.kmh - a.kmh).slice(0, 3).map((m) => m.id);
    return (
      <g>
        {marks.map((m) => (
          <g key={m.id}>
            <circle cx={x(m.p[0])} cy={y(m.p[1])} r={2 + ((m.kmh - 20) / 16) * unit * 1.6} fill={sprintColor(m.kmh)} fillOpacity={0.8} stroke={col(m.side)} strokeWidth={1.5}>
              <title>{`${m.player} · ${m.kmh.toFixed(1)} km/h`}</title>
            </circle>
            {top.includes(m.id) && (
              <text x={x(m.p[0])} y={y(m.p[1]) - unit * 2.4} textAnchor="middle" className="num" fontSize={Math.max(11, unit * 1.6)} fontWeight={700} fill="#F0E442" stroke="#0B0F14" strokeWidth={3} paintOrder="stroke">
                ⚡ {m.player.split(" ").slice(-1)[0]} {m.kmh.toFixed(1)}
              </text>
            )}
          </g>
        ))}
      </g>
    );
  }

  // touches
  const cells = touchGrid(meta, events, filter);
  const max = Math.max(1, ...cells.map((c) => Math.max(c.home, c.away)));
  const w = (x(120) - x(0)) / TOUCH_COLS, h = (y(80) - y(0)) / TOUCH_ROWS;
  return (
    <g>
      {cells.map((c) => {
        const s = c.home >= c.away ? "home" : "away";
        const v = Math.max(c.home, c.away) / max;
        return v > 0 ? (
          <rect key={`${c.col}-${c.row}`} x={x(0) + c.col * w} y={y(0) + c.row * h} width={w} height={h} rx={3} fill={col(s)} fillOpacity={0.1 + v * 0.75} />
        ) : null;
      })}
    </g>
  );
});

/** Small legend for the active map, bottom right of the pitch. */
export function MapLegend({ layer, labels }: { layer: Exclude<Layer, "live">; labels: Record<string, string> }) {
  return (
    <div className="pointer-events-none absolute bottom-3 right-3 rounded bg-bg/85 px-3 py-2 text-xs text-muted backdrop-blur">
      {layer === "shots" && (
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1"><svg width="14" height="14"><circle cx="7" cy="7" r="5" fill="#F2F5F8" stroke="#fff" strokeWidth="2" /></svg>{labels.goal}</span>
          <span className="flex items-center gap-1"><svg width="14" height="14"><circle cx="7" cy="7" r="5" fill="#9AA4AE" fillOpacity=".45" stroke="#9AA4AE" strokeWidth="2" /></svg>{labels.saved}</span>
          <span className="flex items-center gap-1"><svg width="14" height="14"><circle cx="7" cy="7" r="5" fill="none" stroke="#9AA4AE" strokeWidth="2" /></svg>{labels.missed}</span>
          <span>{labels.sizeXg}</span>
        </div>
      )}
      {layer === "passes" && (
        <div className="flex items-center gap-2">
          <span>{labels.easy}</span>
          <span className="h-2 w-24 rounded" style={{ background: `linear-gradient(90deg, ${[0, 40, 70, 100].map((d) => difficultyColor(d)).join(",")})` }} />
          <span>{labels.hard}</span>
          <span className="ml-2">- - {labels.incomplete}</span>
        </div>
      )}
      {layer === "zones" && <div>{labels.zonesHint}</div>}
      {layer === "speed" && <div>{labels.speedHint}</div>}
      {layer === "touches" && <div>{labels.touchesHint}</div>}
    </div>
  );
}
