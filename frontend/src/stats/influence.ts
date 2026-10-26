import type { MatchEvent, MatchMeta } from "../feed/types";
import type { Side } from "./engine";
import { xT } from "./geometry";

/** Players ranked by a custom PITCHIQ index: xT added + xG + 0.05 x high recoveries. */
export function influence(meta: MatchMeta, events: MatchEvent[]) {
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
