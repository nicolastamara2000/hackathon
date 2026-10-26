import { memo } from "react";
import type { MatchEvent, MatchMeta } from "../feed/types";
import type { Strings } from "../i18n/strings";
import type { TeamPalette } from "../lib/teamColors";
import { Crest } from "./Scoreboard";

const surname = (n: string) => n.split(" ").slice(-1)[0];
const ICON: Record<string, string> = { Shot: "🥅", Dribble: "💨", Pass: "🎯", Card: "🟨", Tackle: "🛡️", Interception: "✋" };

function numbers(events: MatchEvent[], clock: number, id: string) {
  const n = { touches: 0, passes: 0, complete: 0, shots: 0, xg: 0, top: 0, distance: 0, sprints: 0 };
  for (const e of events) {
    if (e.clock_s > clock) break;
    if (e.type === "Physical Update") {
      const me = e.physical?.find((x) => x.player_id === id);
      if (me) {
        n.distance = me.distance_m;
        n.sprints = me.sprints;
        n.top = Math.max(n.top, me.top_speed_kmh);
      }
      continue;
    }
    if (e.player_id !== id) continue;
    n.touches++;
    if (e.type === "Pass") {
      n.passes++;
      if (e.outcome === "Complete") n.complete++;
    }
    if (e.type === "Shot") {
      n.shots++;
      n.xg += e.xg ?? 0;
    }
    n.top = Math.max(n.top, e.player_speed_kmh ?? 0);
  }
  return n;
}

/** Player focus: the player's card, a head-to-head with the opponent in the same position, and their key actions. */
export const PlayerPanel = memo(function PlayerPanel({
  meta,
  events,
  clock,
  playerId,
  palette,
  t,
  onJump,
}: {
  meta: MatchMeta;
  events: MatchEvent[];
  clock: number;
  playerId?: string;
  palette: TeamPalette;
  t: Strings;
  onJump(clock_s: number): void;
}) {
  const side = meta.home.lineup.concat(meta.home.bench).some((p) => p.id === playerId) ? "home" : "away";
  const team = meta[side];
  const p = [...team.lineup, ...team.bench].find((x) => x.id === playerId);
  if (!p) return <p className="p-5 text-muted">{t.pickPlayer}</p>;

  const opp = meta[side === "home" ? "away" : "home"];
  const rival = opp.lineup.find((x) => x.position === p.position) ?? opp.lineup.find((x) => x.role === p.role);
  const me = numbers(events, clock, p.id);
  const them = rival ? numbers(events, clock, rival.id) : null;
  const rows: [string, number, number | null, (v: number) => string][] = [
    [t.touches, me.touches, them?.touches ?? null, String],
    [t.passes, me.complete, them?.complete ?? null, String],
    [t.shots.replace(/ \(.*\)/, ""), me.shots, them?.shots ?? null, String],
    [t.xg, me.xg, them?.xg ?? null, (v) => v.toFixed(2)],
    [t.distanceKm, me.distance / 1000, them ? them.distance / 1000 : null, (v) => v.toFixed(1)],
    [t.topSpeed, me.top, them?.top ?? null, (v) => (v ? v.toFixed(1) : "–")],
    [t.sprints, me.sprints, them?.sprints ?? null, String],
  ];
  const actions = events
    .filter((e) => e.clock_s <= clock && e.player_id === p.id && (e.type === "Shot" || e.type === "Dribble" || (e.type === "Pass" && (e.pass_difficulty ?? 0) >= 55) || e.type === "Card" || e.type === "Tackle" || e.type === "Interception"))
    .slice(-8)
    .reverse();
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
      <div className="mt-4 flex items-center justify-between text-xs text-muted">
        <span className="font-semibold text-ink">{surname(p.name)}</span>
        <span>{t.vs}</span>
        <span className="font-semibold text-ink">{rival ? `${surname(rival.name)} · ${opp.short_name}` : "–"}</span>
      </div>
      <dl className="mt-1 flex flex-col gap-1.5">
        {rows.map(([k, a, b, f]) => {
          const tot = a + (b ?? 0) || 1;
          return (
            <div key={k}>
              <div className="flex items-baseline justify-between text-sm">
                <dd className={`num text-lg leading-none ${b !== null && a > b ? "font-bold" : ""}`}>{f(a)}</dd>
                <dt className="text-xs text-muted">{k}</dt>
                <dd className={`num text-lg leading-none ${b !== null && b > a ? "font-bold" : ""}`}>{b === null ? "–" : f(b)}</dd>
              </div>
              <div className="mt-0.5 flex h-1.5 overflow-hidden rounded-sm bg-raised">
                <div style={{ width: `${(a / tot) * 100}%`, background: palette[side] }} />
                <div className="ml-auto" style={{ width: `${((b ?? 0) / tot) * 100}%`, background: palette[side === "home" ? "away" : "home"] }} />
              </div>
            </div>
          );
        })}
      </dl>
      <h3 className="eyebrow mt-4">{t.keyActions}</h3>
      {actions.length ? (
        <ol className="mt-1 flex flex-col gap-1">
          {actions.map((e) => (
            <li key={e.id}>
              <button onClick={() => onJump(e.clock_s - 4)} className="flex w-full items-center gap-2 rounded bg-raised/60 px-3 py-1.5 text-left text-sm hover:bg-raised">
                <span className="num w-9">{e.minute}′</span>
                <span>{ICON[e.type] ?? "•"}</span>
                <span className="truncate">{e.type === "Pass" ? `${t.passTo} ${surname(e.recipient_name ?? "")}` : e.type}</span>
                <span className="num ml-auto text-muted">
                  {e.type === "Shot" ? `${(e.xg ?? 0).toFixed(2)} xG · ${e.outcome}` : e.type === "Pass" ? `${t.difficultyShort} ${e.pass_difficulty}` : e.outcome ?? ""}
                </span>
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-1 text-sm text-muted">{t.noActions}</p>
      )}
    </div>
  );
});
