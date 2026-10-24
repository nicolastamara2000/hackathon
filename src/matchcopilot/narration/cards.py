"""Overlay cards: the machine-readable output that sits on screen beside the match.

Every insight becomes a card at once from deterministic templates (EN + ES), so
the overlay never waits on a model. When the agents finish, they upgrade the same
card in place (same card_id, higher version, source="agents").
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Lang = Literal["en", "es"]
LANGS: tuple[Lang, ...] = ("en", "es")


class CardText(BaseModel):
    fan: str = Field(description="Casual-fan headline, at most 14 words, no jargon")
    analyst: str = Field(description="Analyst line with the key numbers, at most 30 words")
    why: str = Field(description="Why this moment matters, one sentence")


class Card(BaseModel):
    card_id: str
    match_id: str
    clock_s: float
    minute: int
    kind: str
    importance: float
    team_id: str | None = None
    player_id: str | None = None
    player_name: str | None = None
    placement: Literal["lower_third", "side_panel", "top_bar", "full_screen"] = "lower_third"
    duration_s: int = 8
    text: dict[str, CardText]
    metrics: dict = Field(default_factory=dict)
    tags: list[str] = Field(default_factory=list)
    source: Literal["template", "agents"] = "template"
    version: int = 1


PLACEMENT = {
    "goal": ("full_screen", 12), "half_time": ("full_screen", 20), "full_time": ("full_screen", 30),
    "control_shift": ("side_panel", 15), "big_chance": ("lower_third", 10), "hard_pass": ("lower_third", 7),
    "speed_alert": ("lower_third", 6), "distance_milestone": ("lower_third", 6), "rocket_shot": ("lower_third", 8),
    "card": ("top_bar", 8), "substitution": ("top_bar", 8),
}

# metrics worth showing on the card, per kind (the rest of the facts stay server side)
SHOWN = {
    "goal": ["xg", "shot_speed_kmh", "win_prob_swing", "score"],
    "big_chance": ["xg", "outcome", "shot_speed_kmh"],
    "hard_pass": ["difficulty", "length_m", "forward_m", "ball_speed_kmh"],
    "control_shift": ["control", "chaos", "possession_home", "turnovers_per_min"],
    "speed_alert": ["top_speed_kmh", "sprints"],
    "distance_milestone": ["distance_m"],
    "rocket_shot": ["shot_speed_kmh", "xg"],
}


def _pct(x: float) -> str:
    return f"{round(100 * x)}%"


def template_text(insight: dict, teams: dict[str, str]) -> dict[str, CardText]:
    """Deterministic EN/ES text for an insight. Used instantly and as the fallback."""
    k, f = insight["kind"], insight["facts"]
    p = insight.get("player_name") or ""
    team = teams.get(insight.get("team_id") or "", "")
    home, away = list(teams.values())
    m = insight["minute"]

    if k == "goal":
        h, a = f["score"]
        side = "home" if insight["team_id"] == list(teams)[0] else "away"
        before, after = _pct(f["win_prob_before"][side]), _pct(f["win_prob_after"][side])
        return {
            "en": CardText(fan=f"GOAL! {p} scores for {team}. {home} {h}-{a} {away}",
                           analyst=f"{p} {m}': xG {f['xg']:.2f}, {f['shot_speed_kmh']:.0f} km/h. "
                                   f"{team} win chance {before} to {after}.",
                           why=f"{team}'s chance of winning moved from {before} to {after}."),
            "es": CardText(fan=f"¡GOL! {p} marca para {team}. {home} {h}-{a} {away}",
                           analyst=f"{p} {m}': xG {f['xg']:.2f}, {f['shot_speed_kmh']:.0f} km/h. "
                                   f"Probabilidad de victoria de {team}: {before} a {after}.",
                           why=f"La probabilidad de que gane {team} pasó de {before} a {after}."),
        }
    if k == "big_chance":
        miss = {"Saved": ("saved", "atajada"), "Off T": ("off target", "desviado"),
                "Blocked": ("blocked", "bloqueado")}.get(f["outcome"], (f["outcome"], f["outcome"]))
        return {
            "en": CardText(fan=f"Huge chance for {p}, {miss[0]}!",
                           analyst=f"{p}: {f['xg']:.2f} xG shot {miss[0]}. {team} total xG {f['team_xg']:.2f}.",
                           why=f"A shot like this goes in about {_pct(f['xg'])} of the time."),
            "es": CardText(fan=f"¡Ocasión clarísima de {p}, {miss[1]}!",
                           analyst=f"{p}: remate de {f['xg']:.2f} xG {miss[1]}. xG total de {team}: {f['team_xg']:.2f}.",
                           why=f"Un remate así termina en gol cerca del {_pct(f['xg'])} de las veces."),
        }
    if k == "hard_pass":
        return {
            "en": CardText(fan=f"What a pass from {p}!",
                           analyst=f"{p} to {f['recipient']}: difficulty {f['difficulty']}/100, {f['length_m']:.0f} m, "
                                   f"{f['forward_m']:.0f} m forward{', under pressure' if f['under_pressure'] else ''}.",
                           why=f"Only about {100 - f['difficulty']}% of passes like this are completed."),
            "es": CardText(fan=f"¡Qué pase de {p}!",
                           analyst=f"{p} para {f['recipient']}: dificultad {f['difficulty']}/100, {f['length_m']:.0f} m, "
                                   f"{f['forward_m']:.0f} m hacia adelante{', bajo presión' if f['under_pressure'] else ''}.",
                           why=f"Solo cerca del {100 - f['difficulty']}% de los pases así se completan."),
        }
    if k == "control_shift":
        if f["state"] == "chaos":
            return {
                "en": CardText(fan="The game has turned chaotic!",
                               analyst=f"Chaos index {f['chaos']:.2f}: {f['turnovers_per_min']:.1f} turnovers per minute "
                                       f"over the last {f['window_min']} min.",
                               why="Nobody keeps the ball, so the next mistake could decide the game."),
                "es": CardText(fan="¡El partido se volvió un caos!",
                               analyst=f"Índice de caos {f['chaos']:.2f}: {f['turnovers_per_min']:.1f} pérdidas por minuto "
                                       f"en los últimos {f['window_min']} min.",
                               why="Nadie retiene la pelota: el próximo error puede decidir el partido."),
            }
        poss = f["possession_home"] if insight["team_id"] == list(teams)[0] else 1 - f["possession_home"]
        return {
            "en": CardText(fan=f"{team} are taking control.",
                           analyst=f"{team}: {_pct(poss)} possession in the last {f['window_min']} min, "
                                   f"control index {abs(f['control']):.2f}.",
                           why=f"{team} are dictating the rhythm and pinning the opponent back."),
            "es": CardText(fan=f"{team} toma el control.",
                           analyst=f"{team}: {_pct(poss)} de posesión en los últimos {f['window_min']} min, "
                                   f"índice de control {abs(f['control']):.2f}.",
                           why=f"{team} marca el ritmo y empuja al rival hacia atrás."),
        }
    if k == "speed_alert":
        return {
            "en": CardText(fan=f"{p} hits {f['top_speed_kmh']:.1f} km/h!",
                           analyst=f"{p}: top speed {f['top_speed_kmh']:.1f} km/h, sprints so far: {f['sprints']}.",
                           why=f"That is above the {f['threshold_kmh']:.0f} km/h elite sprint mark."),
            "es": CardText(fan=f"¡{p} llega a {f['top_speed_kmh']:.1f} km/h!",
                           analyst=f"{p}: velocidad máxima {f['top_speed_kmh']:.1f} km/h, sprints: {f['sprints']}.",
                           why=f"Supera la marca de élite de {f['threshold_kmh']:.0f} km/h."),
        }
    if k == "distance_milestone":
        km = f["distance_m"] / 1000
        return {
            "en": CardText(fan=f"{p} has covered {km:.1f} km.", analyst=f"{p} ({f['position']}): {km:.1f} km at {m}'.",
                           why="A sign of the work rate behind the team's shape."),
            "es": CardText(fan=f"{p} ya recorrió {km:.1f} km.", analyst=f"{p} ({f['position']}): {km:.1f} km al {m}'.",
                           why="Muestra el esfuerzo detrás del orden del equipo."),
        }
    if k == "rocket_shot":
        return {
            "en": CardText(fan=f"Rocket from {p}: {f['shot_speed_kmh']:.0f} km/h!",
                           analyst=f"{p}: {f['shot_speed_kmh']:.0f} km/h shot, xG {f['xg']:.2f}.",
                           why="Power over placement: a low-percentage shot hit very hard."),
            "es": CardText(fan=f"¡Misil de {p}: {f['shot_speed_kmh']:.0f} km/h!",
                           analyst=f"{p}: remate a {f['shot_speed_kmh']:.0f} km/h, xG {f['xg']:.2f}.",
                           why="Potencia antes que precisión: un remate difícil pero muy fuerte."),
        }
    if k == "card":
        return {
            "en": CardText(fan=f"Yellow card for {p}.", analyst=f"{p} ({team}) booked at {m}'.",
                           why="One more foul means a red card, so every duel gets riskier."),
            "es": CardText(fan=f"Amarilla para {p}.", analyst=f"{p} ({team}) amonestado al {m}'.",
                           why="Otra falta significa la roja: cada duelo se vuelve más riesgoso."),
        }
    if k == "substitution":
        return {
            "en": CardText(fan=f"{team} change: {f['player_on']} on for {f['player_off']}.",
                           analyst=f"{m}': {f['player_on']} replaces {f['player_off']} ({team}).",
                           why="Fresh legs change the pressing and the tempo."),
            "es": CardText(fan=f"Cambio en {team}: entra {f['player_on']}, sale {f['player_off']}.",
                           analyst=f"{m}': {f['player_on']} reemplaza a {f['player_off']} ({team}).",
                           why="Piernas frescas cambian la presión y el ritmo."),
        }
    if k in ("half_time", "full_time"):
        h, a = f["score"]
        ids = list(teams)
        st = f["stats"]
        en_label, es_label = ("Half-time", "Entretiempo") if k == "half_time" else ("Full-time", "Final")
        line = (f"xG {st[ids[0]]['xg']:.2f}-{st[ids[1]]['xg']:.2f}, shots {st[ids[0]]['shots']}-{st[ids[1]]['shots']}, "
                f"pass completion {_pct(st[ids[0]]['pass_completion'] or 0)}-{_pct(st[ids[1]]['pass_completion'] or 0)}.")
        line_es = (f"xG {st[ids[0]]['xg']:.2f}-{st[ids[1]]['xg']:.2f}, remates {st[ids[0]]['shots']}-{st[ids[1]]['shots']}, "
                   f"pases completados {_pct(st[ids[0]]['pass_completion'] or 0)}-{_pct(st[ids[1]]['pass_completion'] or 0)}.")
        return {
            "en": CardText(fan=f"{en_label}: {home} {h}-{a} {away}", analyst=line,
                           why="The chance quality shows whether the scoreline is fair."),
            "es": CardText(fan=f"{es_label}: {home} {h}-{a} {away}", analyst=line_es,
                           why="La calidad de las ocasiones muestra si el marcador es justo."),
        }
    return {lang: CardText(fan=k, analyst=k, why="") for lang in LANGS}


def card_from_insight(insight: dict, match_id: str, teams: dict[str, str]) -> Card:
    placement, duration = PLACEMENT.get(insight["kind"], ("lower_third", 8))
    shown = {key: insight["facts"][key] for key in SHOWN.get(insight["kind"], []) if key in insight["facts"]}
    return Card(card_id=insight["id"], match_id=match_id, clock_s=insight["clock_s"], minute=insight["minute"],
                kind=insight["kind"], importance=insight["importance"], team_id=insight.get("team_id"),
                player_id=insight.get("player_id"), player_name=insight.get("player_name"),
                placement=placement, duration_s=duration, text=template_text(insight, teams), metrics=shown)
