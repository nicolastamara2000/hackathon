"""Event and match metadata schema.

Coordinates use a 120 x 80 pitch, always in the frame of the team performing
the action: that team attacks towards x = 120. Distances and speeds are metric.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

PITCH_LENGTH_M = 105.0
PITCH_WIDTH_M = 68.0

EventType = Literal[
    "Kick Off",
    "Pass",
    "Carry",
    "Dribble",
    "Pressure",
    "Tackle",
    "Interception",
    "Ball Recovery",
    "Shot",
    "Goal Keeper",
    "Foul Committed",
    "Card",
    "Substitution",
    "Physical Update",
    "Half Start",
    "Half End",
]


class Player(BaseModel):
    id: str
    name: str
    number: int
    position: str
    role: Literal["GK", "DEF", "MID", "FWD"]
    top_speed_kmh: float
    work_rate: float = Field(description="Expected distance per 90 minutes, km")


class Team(BaseModel):
    id: str
    name: str
    short_name: str
    city: str
    colors: tuple[str, str]
    formation: str
    strength: float = Field(description="0..1, overall quality")
    pressing: float = Field(description="0..1, pressing intensity")
    directness: float = Field(description="0..1, preference for long forward passes")
    lineup: list[Player]
    bench: list[Player]


class MatchMeta(BaseModel):
    match_id: str
    seed: int
    competition: str
    matchday: int
    kickoff_utc: str
    venue: str
    referee: str
    weather: str
    home: Team
    away: Team


class PlayerPhysical(BaseModel):
    player_id: str
    distance_m: float
    top_speed_kmh: float
    sprints: int


class Event(BaseModel):
    id: str
    index: int
    match_id: str
    period: int
    clock_s: float = Field(description="Seconds since kick-off of the match, continuous across halves")
    minute: int
    second: int
    type: EventType
    team_id: str | None = None
    player_id: str | None = None
    player_name: str | None = None
    possession: int = 0
    possession_team_id: str | None = None
    location: tuple[float, float] | None = None
    end_location: tuple[float, float] | None = None
    outcome: str | None = None
    under_pressure: bool = False
    # Type specific detail, kept flat so it serialises cleanly to JSON / Cosmos DB.
    recipient_id: str | None = None
    recipient_name: str | None = None
    pass_length_m: float | None = None
    pass_height: Literal["Ground", "Low", "High"] | None = None
    ball_speed_kmh: float | None = None
    player_speed_kmh: float | None = None
    body_part: str | None = None
    card: Literal["Yellow", "Red"] | None = None
    sub_in_id: str | None = None
    sub_in_name: str | None = None
    score: tuple[int, int] | None = None
    physical: list[PlayerPhysical] | None = None


def to_metres(dx: float, dy: float) -> float:
    """Distance in metres for a displacement given in 120 x 80 pitch units."""
    return ((dx * PITCH_LENGTH_M / 120.0) ** 2 + (dy * PITCH_WIDTH_M / 80.0) ** 2) ** 0.5
