"""Personalizer: the same cards, shaped per viewer.

A casual fan and a data-hungry analyst get two different experiences from one
stream: different cards, different words, different numbers, their language,
their club, their player.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

from .cards import Card

Mode = Literal["fan", "analyst", "player"]

METRIC_KINDS = {  # a viewer who follows one metric sees every card that moves it
    "xg": {"goal", "big_chance", "rocket_shot"},
    "control": {"control_shift"},
    "pass_difficulty": {"hard_pass"},
    "speed": {"speed_alert", "rocket_shot"},
    "distance": {"distance_milestone"},
}


class ViewerProfile(BaseModel):
    mode: Mode = "fan"
    lang: Literal["en", "es"] = "en"
    favorite_team: str | None = None
    favorite_player: str | None = None
    metric: str | None = None


def score(card: Card, p: ViewerProfile) -> float:
    s = card.importance
    if p.favorite_team and card.team_id == p.favorite_team:
        s += 0.15
    if p.favorite_player and card.player_id == p.favorite_player:
        s += 0.4
    if p.metric and card.kind in METRIC_KINDS.get(p.metric, set()):
        s += 0.3
    return s


def threshold(p: ViewerProfile) -> float:
    return {"fan": 0.6, "analyst": 0.35, "player": 0.75}[p.mode]


def view(card: Card, p: ViewerProfile) -> dict | None:
    """The card as this viewer sees it, or None if it is not for them."""
    always = card.kind in ("goal", "half_time", "full_time")
    mine = p.favorite_player is not None and card.player_id == p.favorite_player
    if p.mode == "player":  # player focus: only their moments, plus the ones nobody can miss
        if not (always or mine):
            return None
    elif not always and score(card, p) < threshold(p):
        return None
    t = card.text.get(p.lang) or card.text["en"]
    is_fav = p.favorite_team is not None and card.team_id == p.favorite_team
    out = {
        "card_id": card.card_id, "version": card.version, "minute": card.minute, "clock_s": card.clock_s,
        "kind": card.kind, "placement": card.placement, "duration_s": card.duration_s,
        "team_id": card.team_id, "player_id": card.player_id, "player_name": card.player_name,
        "source": card.source, "tags": card.tags, "your_team": is_fav,
        "your_player": p.favorite_player is not None and card.player_id == p.favorite_player,
    }
    if p.mode == "analyst" and always:  # big moments keep the headline, numbers go underneath
        out.update(headline=t.fan, body=t.analyst, metrics=card.metrics)
    elif p.mode == "analyst":
        out.update(headline=t.analyst, body=t.why, metrics=card.metrics)
    else:
        out.update(headline=t.fan, body=t.why if card.importance >= 0.6 or out["your_player"] else None,
                   metrics={})
    return out
