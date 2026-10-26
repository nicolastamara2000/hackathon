import { memo } from "react";
import type { MatchEvent, MatchMeta } from "../feed/types";
import type { Strings } from "../i18n/strings";
import type { TeamPalette } from "../lib/teamColors";
import { Crest } from "./Scoreboard";

/** Player focus: a persistent card with the player's own live numbers. */
export const PlayerPanel = memo(function PlayerPanel({
  meta,
  events,
  clock,
  playerId,
  palette,
  t,
}: {
  meta: MatchMeta;
  events: MatchEvent[];
  clock: number;
  playerId?: string;
  palette: TeamPalette;
  t: Strings;
}) {
  const side = meta.home.lineup.concat(meta.home.bench).some((p) => p.id === playerId) ? "home" : "away";
  const team = meta[side];
  const p = [...team.lineup, ...team.bench].find((x) => x.id === playerId);
  if (!p) return <p className="p-5 text-muted">{t.pickPlayer}</p>;

  let touches = 0, passes = 0, complete = 0, shots = 0, xg = 0, top = 0, distance = 0, sprints = 0;
  for (const e of events) {
    if (e.clock_s > clock) break;
    if (e.type === "Physical Update") {
      const me = e.physical?.find((x) => x.player_id === p.id);
      if (me) {
        distance = me.distance_m;
        sprints = me.sprints;
        top = Math.max(top, me.top_speed_kmh);
      }
      continue;
    }
    if (e.player_id !== p.id) continue;
    touches++;
    if (e.type === "Pass") {
      passes++;
      if (e.outcome === "Complete") complete++;
    }
    if (e.type === "Shot") {
      shots++;
      xg += e.xg ?? 0;
    }
    top = Math.max(top, e.player_speed_kmh ?? 0);
  }
  const rows: [string, string][] = [
    [t.touches, String(touches)],
    [t.passes, passes ? `${complete}/${passes}` : "0"],
    [t.shots.replace(/ \(.*\)/, ""), String(shots)],
    [t.xg, xg.toFixed(2)],
    [t.distanceKm, (distance / 1000).toFixed(1)],
    [t.topSpeed, top ? top.toFixed(1) : "–"],
    [t.sprints, String(sprints)],
  ];
  return (
    <div className="p-4">
      <div className="flex items-center gap-3 rounded-lg p-3" style={{ background: palette[side], color: side === "home" ? palette.onHome : palette.onAway }}>
        <div className="num text-tv-lg font-bold leading-none">{p.number}</div>
        <div className="min-w-0 flex-1">
          <div className="num truncate text-tv-sm font-bold uppercase leading-tight">{p.name}</div>
          <div className="text-sm opacity-90">
            {p.position} · {team.name}
          </div>
        </div>
        <Crest team={team} size={36} />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2">
        {rows.map(([k, v]) => (
          <div key={k} className="rounded bg-raised/60 px-3 py-2">
            <dt className="text-xs text-muted">{k}</dt>
            <dd className="num text-tv-sm leading-none">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
});
