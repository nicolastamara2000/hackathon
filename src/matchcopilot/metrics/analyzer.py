"""Streaming match analyzer.

Feed events one at a time with `ingest(event)`. It keeps the match state and
returns `Insight` cards when something worth showing happens. The numbers here
are deterministic and testable; agents only choose, explain and phrase them.
"""

from __future__ import annotations

import math
from collections import deque
from dataclasses import dataclass, field
from typing import Any

from .models import pass_difficulty, xg

WINDOW_S = 5 * 60
BASE_GOALS_PER_90 = 1.35
SPEED_ALERT_KMH = 33.0
DISTANCE_MILESTONES_M = (5_000, 10_000)
HARD_PASS = 45  # about the hardest 1% of completed passes


@dataclass
class Insight:
    id: str
    kind: str
    clock_s: float
    minute: int
    importance: float  # 0..1, drives what reaches the screen
    team_id: str | None = None
    player_id: str | None = None
    player_name: str | None = None
    facts: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {k: v for k, v in self.__dict__.items()}


@dataclass
class TeamStats:
    passes: int = 0
    passes_complete: int = 0
    shots: int = 0
    on_target: int = 0
    goals: int = 0
    xg: float = 0.0
    pressures: int = 0
    tackles: int = 0
    turnovers_won: int = 0
    possession_s: float = 0.0
    hard_passes_complete: int = 0

    def to_dict(self) -> dict:
        d = dict(self.__dict__)
        d["pass_completion"] = round(self.passes_complete / self.passes, 3) if self.passes else None
        d["xg"] = round(self.xg, 2)
        d["possession_s"] = round(self.possession_s, 1)
        return d


def _poisson_pmf(k: int, lam: float) -> float:
    return math.exp(-lam) * lam ** k / math.factorial(k)


def win_probability(score: tuple[int, int], minute: float, rate_home: float, rate_away: float) -> dict:
    """Home / draw / away probabilities from the score and remaining scoring rates (goals per 90)."""
    left = max(0.0, 95 - minute) / 90
    lh, la = rate_home * left, rate_away * left
    ph = [_poisson_pmf(k, lh) for k in range(11)]
    pa = [_poisson_pmf(k, la) for k in range(11)]
    home = draw = away = 0.0
    for i, a in enumerate(ph):
        for j, b in enumerate(pa):
            h, w = score[0] + i, score[1] + j
            p = a * b
            if h > w:
                home += p
            elif h == w:
                draw += p
            else:
                away += p
    total = home + draw + away
    return {"home": round(home / total, 3), "draw": round(draw / total, 3), "away": round(away / total, 3)}


class MatchAnalyzer:
    def __init__(self, meta: dict):
        self.meta = meta
        self.home = meta["home"]["id"]
        self.away = meta["away"]["id"]
        self.names = {meta[s]["id"]: meta[s]["name"] for s in ("home", "away")}
        self.players = {p["id"]: p for s in ("home", "away") for p in meta[s]["lineup"] + meta[s]["bench"]}
        self.player_team = {p["id"]: meta[s]["id"] for s in ("home", "away")
                            for p in meta[s]["lineup"] + meta[s]["bench"]}
        self.stats = {self.home: TeamStats(), self.away: TeamStats()}
        self.score = [0, 0]
        self.minute = 0
        self.clock_s = 0.0
        self.window: deque[dict] = deque()  # recent events for the control index
        self.last_poss: tuple[str | None, float] = (None, 0.0)
        self.control_history: list[dict] = []
        self.last_control_state: str | None = None
        self._pending: tuple[str | None, int] = (None, 0)
        self._last_shift_min = -99
        self.win_prob = win_probability((0, 0), 0, *self._rates())
        self.speed_alerted: set[str] = set()
        self.distance_alerted: set[tuple[str, int]] = set()
        self.player_stats: dict[str, dict] = {}
        self._n = 0

    # --------------------------------------------------------------- helpers
    def _id(self) -> str:
        self._n += 1
        return f"{self.meta['match_id']}-I{self._n:04d}"

    def _rates(self) -> tuple[float, float]:
        """Scoring rates per 90: prior from team strength, blended with in-match xG pace."""
        sh, sa = self.meta["home"]["strength"], self.meta["away"]["strength"]
        prior_h = BASE_GOALS_PER_90 * math.exp(1.5 * (sh - sa)) * 1.08
        prior_a = BASE_GOALS_PER_90 * math.exp(1.5 * (sa - sh)) / 1.08
        played = max(self.minute, 1) / 90
        w = 0.4 * min(played, 1.0)  # in-match xG pace earns trust slowly
        pace_h = self.stats[self.home].xg / played
        pace_a = self.stats[self.away].xg / played
        rh = (1 - w) * prior_h + w * pace_h
        ra = (1 - w) * prior_a + w * pace_a
        return max(rh, 0.6 * prior_h), max(ra, 0.6 * prior_a)

    def _pstat(self, pid: str) -> dict:
        return self.player_stats.setdefault(pid, {"passes": 0, "passes_complete": 0, "shots": 0, "xg": 0.0,
                                                  "goals": 0, "pressures": 0, "tackles": 0,
                                                  "hard_passes_complete": 0, "distance_m": 0.0,
                                                  "top_speed_kmh": 0.0, "sprints": 0})

    def _insight(self, kind: str, importance: float, e: dict | None = None, **facts) -> Insight:
        return Insight(id=self._id(), kind=kind, clock_s=self.clock_s, minute=self.minute,
                       importance=round(min(max(importance, 0.0), 1.0), 2),
                       team_id=(e or {}).get("team_id"), player_id=(e or {}).get("player_id"),
                       player_name=(e or {}).get("player_name"), facts=facts)

    # ------------------------------------------------------------- control
    def control_index(self) -> dict:
        """Control (-1 away .. +1 home) and chaos (0 calm .. 1 chaotic) over the last 5 minutes."""
        evs = list(self.window)
        if len(evs) < 10:
            return {"control": 0.0, "chaos": 0.0, "possession_home": 0.5, "turnovers_per_min": 0.0}
        poss = {self.home: 0.0, self.away: 0.0}
        for a, b in zip(evs, evs[1:]):
            if a.get("possession_team_id") in poss:
                poss[a["possession_team_id"]] += b["clock_s"] - a["clock_s"]
        tot = sum(poss.values()) or 1.0
        poss_h = poss[self.home] / tot

        def side(team):
            passes = [e for e in evs if e["type"] == "Pass" and e.get("team_id") == team]
            comp = sum(e.get("outcome") == "Complete" for e in passes) / len(passes) if passes else 0.0
            final_third = sum(1 for e in evs if e.get("team_id") == team and e.get("location")
                              and e["location"][0] > 80 and e["type"] in ("Pass", "Carry", "Shot", "Dribble"))
            presses = sum(1 for e in evs if e["type"] == "Pressure" and e.get("team_id") == team)
            xg_ = sum(e.get("_xg", 0.0) for e in evs if e.get("team_id") == team and e["type"] == "Shot")
            return comp, final_third, presses, xg_

        ch, fh, prh, xh = side(self.home)
        ca, fa, pra, xa = side(self.away)
        territory = (fh - fa) / max(fh + fa, 1)
        control = 0.45 * (2 * poss_h - 1) + 0.2 * (ch - ca) * 2 + 0.25 * territory + 0.1 * math.tanh((xh - xa) * 3)
        minutes = max((evs[-1]["clock_s"] - evs[0]["clock_s"]) / 60, 1.0)
        turnovers = sum(1 for e in evs if e["type"] in ("Interception", "Ball Recovery", "Tackle")) / minutes
        duels = sum(1 for e in evs if e["type"] in ("Dribble", "Tackle", "Foul Committed")) / minutes
        chaos = min(1.0, 0.12 * turnovers + 0.10 * duels + 0.002 * (prh + pra) / minutes * 10)
        return {"control": round(max(-1.0, min(1.0, control)), 3), "chaos": round(chaos, 3),
                "possession_home": round(poss_h, 3), "turnovers_per_min": round(turnovers, 2)}

    def _control_state(self, c: dict) -> str:
        if c["chaos"] > 0.62:
            return "chaos"
        if c["control"] > 0.22:
            return f"control:{self.home}"
        if c["control"] < -0.22:
            return f"control:{self.away}"
        return "balanced"

    # --------------------------------------------------------------- ingest
    def ingest(self, e: dict) -> list[Insight]:
        out: list[Insight] = []
        self.clock_s = e["clock_s"]
        self.minute = e["minute"]
        t = e.get("type")
        team = e.get("team_id")
        st = self.stats.get(team) if team else None

        # possession time
        pt, since = self.last_poss
        if pt in self.stats:
            self.stats[pt].possession_s += max(0.0, e["clock_s"] - since)
        self.last_poss = (e.get("possession_team_id"), e["clock_s"])

        if t == "Pass" and st is not None:
            st.passes += 1
            ps = self._pstat(e["player_id"])
            ps["passes"] += 1
            diff = pass_difficulty(e)
            e["_difficulty"] = diff
            if e.get("outcome") == "Complete":
                st.passes_complete += 1
                ps["passes_complete"] += 1
                fwd = (e["end_location"][0] - e["location"][0]) * 105 / 120
                if diff >= HARD_PASS:
                    st.hard_passes_complete += 1
                    ps["hard_passes_complete"] += 1
                if diff >= HARD_PASS and fwd >= 10:  # only hard passes that move the team forward reach the screen
                    out.append(self._insight("hard_pass", 0.35 + 0.004 * (diff - HARD_PASS) + 0.01 * max(fwd, 0), e,
                                             difficulty=diff, length_m=e.get("pass_length_m"),
                                             ball_speed_kmh=e.get("ball_speed_kmh"),
                                             under_pressure=e.get("under_pressure", False),
                                             forward_m=round(fwd, 1), recipient=e.get("recipient_name")))
        elif t == "Shot" and st is not None:
            x = xg(e)
            e["_xg"] = x
            st.shots += 1
            st.xg += x
            ps = self._pstat(e["player_id"])
            ps["shots"] += 1
            ps["xg"] += x
            if e.get("outcome") in ("Goal", "Saved"):
                st.on_target += 1
            before = self.win_prob
            if e.get("outcome") == "Goal":
                st.goals += 1
                ps["goals"] += 1
                self.score = list(e.get("score") or self.score)
            self.win_prob = win_probability(tuple(self.score), self.minute, *self._rates())
            side = "home" if team == self.home else "away"
            swing = round(self.win_prob[side] - before[side], 3)
            if e.get("outcome") == "Goal":
                imp = 0.8 + min(0.2, abs(swing))
                out.append(self._insight("goal", imp, e, xg=round(x, 3), shot_speed_kmh=e.get("ball_speed_kmh"),
                                         body_part=e.get("body_part"), score=list(self.score),
                                         win_prob_before=before, win_prob_after=self.win_prob,
                                         win_prob_swing=swing, player_goals=ps["goals"]))
            elif x >= 0.15:
                out.append(self._insight("big_chance", 0.45 + x, e, xg=round(x, 3), outcome=e.get("outcome"),
                                         shot_speed_kmh=e.get("ball_speed_kmh"), body_part=e.get("body_part"),
                                         team_xg=round(st.xg, 2)))
            elif e.get("ball_speed_kmh", 0) >= 110:
                out.append(self._insight("rocket_shot", 0.4, e, shot_speed_kmh=e.get("ball_speed_kmh"),
                                         xg=round(x, 3), outcome=e.get("outcome")))
        elif t == "Pressure" and st is not None:
            st.pressures += 1
            self._pstat(e["player_id"])["pressures"] += 1
        elif t == "Tackle" and st is not None:
            st.tackles += 1
            st.turnovers_won += 1
            self._pstat(e["player_id"])["tackles"] += 1
        elif t in ("Interception", "Ball Recovery") and st is not None:
            st.turnovers_won += 1
        elif t == "Card":
            out.append(self._insight("card", 0.55, e, card=e.get("card")))
        elif t == "Substitution":
            out.append(self._insight("substitution", 0.3, e, player_off=e.get("player_name"),
                                     player_on=e.get("sub_in_name")))
        elif t == "Physical Update":
            for p in e.get("physical", []):
                ps = self._pstat(p["player_id"])
                ps.update(distance_m=p["distance_m"], top_speed_kmh=p["top_speed_kmh"], sprints=p["sprints"])
                info = self.players.get(p["player_id"], {})
                ctx = {"team_id": self.player_team.get(p["player_id"]), "player_id": p["player_id"],
                       "player_name": info.get("name")}
                if p["top_speed_kmh"] >= SPEED_ALERT_KMH and p["player_id"] not in self.speed_alerted:
                    self.speed_alerted.add(p["player_id"])
                    out.append(self._insight("speed_alert", 0.35, ctx, top_speed_kmh=p["top_speed_kmh"],
                                             threshold_kmh=SPEED_ALERT_KMH, sprints=p["sprints"]))
                for m in DISTANCE_MILESTONES_M:
                    if p["distance_m"] >= m and (p["player_id"], m) not in self.distance_alerted:
                        self.distance_alerted.add((p["player_id"], m))
                        if m == DISTANCE_MILESTONES_M[-1]:
                            out.append(self._insight("distance_milestone", 0.25, ctx, distance_m=p["distance_m"],
                                                     milestone_m=m, position=info.get("position")))
            # control index once a minute
            self._trim_window()
            c = self.control_index()
            c["minute"] = self.minute
            self.control_history.append(c)
            state = self._control_state(c)
            # debounce: a state must hold for 2 straight minutes, and shifts are at least 4 minutes apart
            self._pending = (state, self._pending[1] + 1) if state == self._pending[0] else (state, 1)
            if self._pending[1] >= 2 and state != self.last_control_state:
                prev = self.last_control_state
                self.last_control_state = state
                newsworthy = state != "balanced" and self.minute - self._last_shift_min >= 4
                if prev is not None and self.minute >= 8 and newsworthy:
                    self._last_shift_min = self.minute
                    team_ = state.split(":")[1] if state.startswith("control:") else None
                    out.append(self._insight(
                        "control_shift", 0.5 + 0.3 * abs(c["control"]), {"team_id": team_},
                        state=state.split(":")[0], previous=prev.split(":")[0],
                        previous_team=prev.split(":")[1] if prev.startswith("control:") else None,
                        **c, window_min=WINDOW_S // 60))
        elif t == "Half End":
            out.append(self._insight("half_time" if e["period"] == 1 else "full_time", 0.9, None,
                                     score=list(self.score), stats=self.team_stats(), win_prob=self.win_prob))

        if t not in ("Physical Update", "Half Start", "Half End"):
            self.window.append(e)
        return out

    def _trim_window(self) -> None:
        while self.window and self.clock_s - self.window[0]["clock_s"] > WINDOW_S:
            self.window.popleft()

    # ----------------------------------------------------------------- views
    def team_stats(self) -> dict:
        return {self.home: self.stats[self.home].to_dict(), self.away: self.stats[self.away].to_dict()}

    def snapshot(self) -> dict:
        """Full current state, for the API and for agents' shared context."""
        return {
            "match_id": self.meta["match_id"],
            "minute": self.minute,
            "score": {self.home: self.score[0], self.away: self.score[1]},
            "teams": self.names,
            "stats": self.team_stats(),
            "win_prob": self.win_prob,
            "control": self.control_history[-1] if self.control_history else None,
            "control_history": self.control_history[-30:],
        }

    def player_summary(self, player_id: str) -> dict:
        ps = dict(self._pstat(player_id))
        ps["xg"] = round(ps["xg"], 2)
        info = self.players.get(player_id, {})
        return {"player_id": player_id, "name": info.get("name"), "position": info.get("position"),
                "team_id": self.player_team.get(player_id), **ps}
