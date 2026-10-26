import { memo, useMemo, useState } from "react";
import type { MatchEvent, MatchMeta } from "../feed/types";
import type { Locale } from "../i18n/strings";
import { tpText } from "../i18n/turning";
import type { TeamPalette } from "../lib/teamColors";
import type { TurningPoint } from "../stats/turning";
import { TP_ICON } from "./TurningPoints";

type Kind = "all" | "shots" | "passes" | "defence" | "discipline";
const KINDS: Record<Exclude<Kind, "all">, Set<string>> = {
  shots: new Set(["Shot", "Goal Keeper"]),
  passes: new Set(["Pass", "Carry", "Dribble"]),
  defence: new Set(["Pressure", "Tackle", "Interception", "Ball Recovery"]),
  discipline: new Set(["Foul Committed", "Card", "Substitution"]),
};
const HIDDEN = new Set(["Physical Update"]);

const L = (locale: Locale) =>
  locale === "en"
    ? {
        kinds: { all: "All", shots: "Shots", passes: "Passes", defence: "Defence", discipline: "Fouls, cards, subs" } as Record<Kind, string>,
        both: "Both", all: "All", half: "Half", jump: "Go to moment", cited: "Cited by turning points", none: "No events match these filters.",
        speed: "speed", xg: "xG", diff: "difficulty", at: "at", showing: "Showing the latest",
      }
    : {
        kinds: { all: "Todo", shots: "Tiros", passes: "Pases", defence: "Defensa", discipline: "Faltas, tarjetas, cambios" } as Record<Kind, string>,
        both: "Ambos", all: "Todos", half: "Tiempo", jump: "Ir al momento", cited: "Citado por puntos de quiebre", none: "Ningún evento coincide con los filtros.",
        speed: "velocidad", xg: "xG", diff: "dificultad", at: "en", showing: "Mostrando los últimos",
      };

/** Live event feed: filters by kind, team and half; an event opens its context and the turning points that cite it. */
export const EventFeed = memo(function EventFeed({
  events, clock, meta, palette, locale, tps, onJump, onTurning,
}: {
  events: MatchEvent[];
  clock: number;
  meta: MatchMeta;
  palette: TeamPalette;
  locale: Locale;
  tps: TurningPoint[];
  onJump(clock_s: number): void;
  onTurning(tp: TurningPoint): void;
}) {
  const l = L(locale);
  const [kind, setKind] = useState<Kind>("all");
  const [team, setTeam] = useState<"" | "home" | "away">("");
  const [half, setHalf] = useState<0 | 1 | 2>(0);
  const [open, setOpen] = useState<string | null>(null);
  const cites = useMemo(() => {
    const m = new Map<string, TurningPoint[]>();
    for (const tp of tps) for (const id of tp.evidence) m.set(id, [...(m.get(id) ?? []), tp]);
    return m;
  }, [tps]);
  const LIMIT = 150;
  const list: MatchEvent[] = [];
  for (let i = events.length - 1; i >= 0 && list.length < LIMIT; i--) {
    const e = events[i];
    if (e.clock_s > clock || HIDDEN.has(e.type)) continue;
    if (kind !== "all" && !KINDS[kind].has(e.type)) continue;
    if (team && e.team_id !== meta[team].id) continue;
    if (half && e.period !== half) continue;
    list.push(e);
  }

  const chip = (on: boolean) => `rounded-full px-2.5 py-1 text-xs font-semibold ${on ? "bg-accent text-bg" : "ring-1 ring-line hover:bg-raised"}`;
  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-10 flex flex-col gap-1.5 border-b border-line bg-surface px-3 py-2">
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(l.kinds) as Kind[]).map((k) => (
            <button key={k} onClick={() => setKind(k)} aria-pressed={kind === k} className={chip(kind === k)}>
              {l.kinds[k]}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(["", "home", "away"] as const).map((s) => (
            <button key={s || "both"} onClick={() => setTeam(s)} aria-pressed={team === s} className={chip(team === s)}>
              {s ? meta[s].short_name : l.both}
            </button>
          ))}
          <span className="mx-1 w-px bg-line" />
          {([0, 1, 2] as const).map((h) => (
            <button key={h} onClick={() => setHalf(h)} aria-pressed={half === h} className={chip(half === h)}>
              {h ? `${l.half} ${h}` : l.all}
            </button>
          ))}
        </div>
      </div>
      {!list.length && <p className="p-4 text-sm text-muted">{l.none}</p>}
      <ol>
        {list.map((e) => {
          const side = e.team_id === meta.home.id ? "home" : e.team_id === meta.away.id ? "away" : null;
          const cited = cites.get(e.id) ?? [];
          const isOpen = open === e.id;
          return (
            <li key={e.id} className="border-b border-line/60">
              <button onClick={() => setOpen(isOpen ? null : e.id)} aria-expanded={isOpen} className="grid w-full grid-cols-[3rem_0.5rem_minmax(0,1fr)_auto] items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-raised">
                <span className="num text-muted">
                  {e.minute}:{String(e.second).padStart(2, "0")}
                </span>
                <span className="h-2 w-2 rounded-full" style={{ background: side ? palette[side] : "rgb(var(--muted))" }} />
                <span className="truncate">
                  <span className="font-semibold">{e.type}</span>
                  {e.player_name ? ` · ${e.player_name}` : ""}
                  {e.recipient_name ? ` → ${e.recipient_name}` : ""}
                </span>
                <span className="flex items-center gap-1 text-xs text-muted">
                  {cited.length > 0 && <span className="rounded-sm bg-accent/15 px-1 text-accent">◆ {cited.length}</span>}
                  {e.type === "Shot" ? `${(e.xg ?? 0).toFixed(2)} xG` : e.outcome ?? ""}
                </span>
              </button>
              {isOpen && (
                <div className="bg-raised/40 px-3 pb-3 pt-1 text-sm">
                  <p className="num text-xs text-muted">
                    {[
                      e.location ? `${l.at} (${e.location[0].toFixed(0)}, ${e.location[1].toFixed(0)})` : null,
                      e.xg !== undefined ? `${l.xg} ${e.xg.toFixed(2)}` : null,
                      e.pass_difficulty !== undefined ? `${l.diff} ${e.pass_difficulty}/100` : null,
                      e.pass_length_m ? `${Math.round(e.pass_length_m)} m` : null,
                      e.ball_speed_kmh ? `${l.speed} ${Math.round(e.ball_speed_kmh)} km/h` : null,
                      e.under_pressure ? "under pressure" : null,
                      `id ${e.id}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {cited.length > 0 && (
                    <div className="mt-2">
                      <div className="eyebrow mb-1">{l.cited}</div>
                      {cited.map((tp) => (
                        <button key={tp.id} onClick={() => onTurning(tp)} className="block w-full truncate rounded px-2 py-1 text-left hover:bg-raised">
                          <span className="num text-muted">{tp.minute}′</span> {TP_ICON[tp.kind]} {tpText(tp, meta, locale).headline}
                        </button>
                      ))}
                    </div>
                  )}
                  <button onClick={() => onJump(e.clock_s - 4)} className="mt-2 rounded px-3 py-1 text-xs font-semibold ring-1 ring-line hover:bg-raised">
                    ↺ {l.jump}
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {list.length === LIMIT && (
        <p className="p-3 text-2xs text-muted">
          {l.showing} {LIMIT}.
        </p>
      )}
    </div>
  );
});
