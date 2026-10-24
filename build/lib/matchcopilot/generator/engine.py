"""Possession-based match simulator.

The simulator walks the ball through possessions. Each action (pass, carry,
dribble, shot) is sampled from probabilities that depend on pitch zone,
pressure, team quality and a latent momentum process. Momentum is an
Ornstein-Uhlenbeck process, so matches have real swings of control that the
analytics layer can detect and explain.

Everything is seeded: the same seed always produces the same match.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

from .schema import Event, MatchMeta, Player, PlayerPhysical, Team, to_metres
from .teams import CLUBS, build_team

HALF_S = 45 * 60
GOAL = (120.0, 40.0)

VENUES = ["Harbourside Park", "Redmill Lane", "Northgate Arena", "Kingsbridge Road",
          "Vale Stadium", "Lakeside Ground", "Eastbrook Park", "Moorfield"]
REFEREES = ["A. Lindgren", "P. Okoye", "M. Serrano", "J. Whitfield", "R. Tanaka"]
WEATHER = ["Clear, 14C", "Light rain, 9C", "Overcast, 11C", "Windy, 8C", "Clear, 19C"]

ROLE_WEIGHTS = {  # zone -> role -> weight, for picking the player on the ball
    0: {"GK": 0.08, "DEF": 0.62, "MID": 0.25, "FWD": 0.05},
    1: {"GK": 0.00, "DEF": 0.25, "MID": 0.50, "FWD": 0.25},
    2: {"GK": 0.00, "DEF": 0.08, "MID": 0.35, "FWD": 0.57},
}


def _zone(x: float) -> int:
    return 0 if x < 40 else (1 if x < 80 else 2)


def _mirror(loc: tuple[float, float]) -> tuple[float, float]:
    return (round(120.0 - loc[0], 1), round(80.0 - loc[1], 1))


def goal_geometry(x: float, y: float) -> tuple[float, float]:
    """Distance to goal centre (m) and the angle the goal mouth subtends (rad)."""
    gx, gy = (GOAL[0] - x) * 105 / 120, (y - GOAL[1]) * 68 / 80
    dist = math.hypot(gx, gy)
    half = 7.32 / 2
    a = math.atan2(half - gy, max(gx, 0.01)) - math.atan2(-half - gy, max(gx, 0.01))
    return dist, abs(a)


def shot_quality(x: float, y: float, pressed: bool, header: bool) -> float:
    """Ground-truth chance quality used by the simulator to resolve shots."""
    dist, angle = goal_geometry(x, y)
    logit = -1.55 + 1.6 * angle - 0.092 * dist - 0.35 * pressed - 0.55 * header
    return 1.0 / (1.0 + math.exp(-logit))


@dataclass
class _Phys:
    distance_m: float = 0.0
    top_speed_kmh: float = 0.0
    sprints: int = 0


@dataclass
class _State:
    elapsed: float = 0.0
    period: int = 1
    period_start: float = 0.0
    period_end: float = HALF_S
    momentum: float = 0.0  # > 0 favours home
    score: list[int] = field(default_factory=lambda: [0, 0])
    possession: int = 0
    next_phys: float = 60.0


class MatchSimulator:
    def __init__(self, home: Team, away: Team, seed: int, match_id: str | None = None,
                 matchday: int = 1, realtime_phys_s: float = 60.0):
        self.home, self.away = home, away
        self.rng = np.random.default_rng(seed)
        self.seed = seed
        self.match_id = match_id or f"SYN-{seed:06d}-{home.short_name}-{away.short_name}"
        self.matchday = matchday
        self.phys_every = realtime_phys_s
        self.events: list[Event] = []
        self.s = _State()
        self.on_pitch: dict[str, list[Player]] = {home.id: list(home.lineup), away.id: list(away.lineup)}
        self.bench: dict[str, list[Player]] = {home.id: list(home.bench), away.id: list(away.bench)}
        self.phys: dict[str, _Phys] = {p.id: _Phys() for t in (home, away) for p in t.lineup + t.bench}
        self.subs = self._plan_subs()

    # ------------------------------------------------------------------ helpers
    def _other(self, team: Team) -> Team:
        return self.away if team.id == self.home.id else self.home

    def _advantage(self, team: Team) -> float:
        opp = self._other(team)
        adv = (team.strength - opp.strength) * 1.2
        adv += 0.04 if team.id == self.home.id else -0.04
        adv += self.s.momentum if team.id == self.home.id else -self.s.momentum
        if self.s.period == 2:  # trailing teams push
            diff = self.s.score[0] - self.s.score[1]
            diff = diff if team.id == self.home.id else -diff
            adv += 0.06 * min(max(-diff, 0), 2) - 0.03 * min(max(diff, 0), 2)
        return float(np.clip(adv, -0.6, 0.6))

    def _pick(self, team: Team, x: float, exclude: Player | None = None) -> Player:
        weights = ROLE_WEIGHTS[_zone(x)]
        players = [p for p in self.on_pitch[team.id] if p is not exclude]
        w = np.array([weights[p.role] for p in players]) + 1e-6
        return players[int(self.rng.choice(len(players), p=w / w.sum()))]

    def _speed(self, p: Player, lo: float, hi: float) -> float:
        v = round(float(p.top_speed_kmh * self.rng.uniform(lo, hi)), 1)
        ph = self.phys[p.id]
        ph.top_speed_kmh = max(ph.top_speed_kmh, v)
        return v

    def _clock(self) -> tuple[int, int]:
        offset = 0 if self.s.period == 1 else HALF_S
        t = offset + (self.s.elapsed - self.s.period_start)
        return int(t // 60), int(t % 60)

    def _advance(self, dt: float) -> None:
        """Move the clock, evolve momentum and emit physical updates on schedule."""
        steps = max(1, int(dt // 5))
        h = dt / steps
        for _ in range(steps):
            theta, sigma = 1 / 420, 0.026
            self.s.momentum += -theta * self.s.momentum * h + sigma * math.sqrt(h) * self.rng.normal()
            self.s.momentum = float(np.clip(self.s.momentum, -0.7, 0.7))
            self.s.elapsed += h
            while self.s.elapsed >= self.s.next_phys:
                self._physical_update()
                self.s.next_phys += self.phys_every
                self._maybe_sub()

    def _emit(self, type_: str, team: Team | None = None, player: Player | None = None,
              **kw) -> Event:
        minute, second = self._clock()
        ev = Event(
            id=f"{self.match_id}-{len(self.events):05d}",
            index=len(self.events),
            match_id=self.match_id,
            period=self.s.period,
            clock_s=round(self.s.elapsed, 2),
            minute=minute,
            second=second,
            type=type_,
            team_id=team.id if team else None,
            player_id=player.id if player else None,
            player_name=player.name if player else None,
            possession=self.s.possession,
            possession_team_id=kw.pop("possession_team_id", None),
            **kw,
        )
        self.events.append(ev)
        return ev

    # ------------------------------------------------------------- physical
    def _physical_update(self) -> None:
        minutes = self.phys_every / 60
        snapshot = []
        for team in (self.home, self.away):
            for p in self.on_pitch[team.id]:
                ph = self.phys[p.id]
                per_min = p.work_rate * 1000 / 95
                ph.distance_m += per_min * minutes * float(self.rng.normal(1.0, 0.07))
                rate = {"GK": 0.01, "DEF": 0.22, "MID": 0.24, "FWD": 0.34}[p.role]
                for _ in range(self.rng.poisson(rate * minutes)):
                    ph.sprints += 1
                    self._speed(p, 0.80, 1.0)
                snapshot.append(PlayerPhysical(player_id=p.id, distance_m=round(ph.distance_m, 1),
                                               top_speed_kmh=ph.top_speed_kmh, sprints=ph.sprints))
        self._emit("Physical Update", physical=snapshot)

    # ---------------------------------------------------------- substitutions
    def _plan_subs(self) -> list[tuple[float, str]]:
        plan = []
        for team in (self.home, self.away):
            for minute in sorted(self.rng.uniform(58, 84, size=3)):
                plan.append((float(minute) * 60, team.id))
        return sorted(plan)

    def _maybe_sub(self) -> None:
        if self.s.period != 2 or not self.subs:
            return
        minute, _ = self._clock()
        while self.subs and minute * 60 >= self.subs[0][0]:
            _, team_id = self.subs.pop(0)
            team = self.home if team_id == self.home.id else self.away
            outfield = [p for p in self.on_pitch[team_id] if p.role != "GK"]
            out = outfield[int(self.rng.integers(len(outfield)))]
            options = [b for b in self.bench[team_id] if b.role == out.role] or \
                      [b for b in self.bench[team_id] if b.role != "GK"]
            if not options:
                continue
            sub_in = options[0]
            self.bench[team_id].remove(sub_in)
            idx = self.on_pitch[team_id].index(out)
            self.on_pitch[team_id][idx] = sub_in.model_copy(update={"position": out.position})
            self._emit("Substitution", team, out, sub_in_id=sub_in.id, sub_in_name=sub_in.name)

    # ------------------------------------------------------------- the match
    def run(self) -> tuple[MatchMeta, list[Event]]:
        for period in (1, 2):
            self._play_period(period)
        return self._meta(), self.events

    def _meta(self) -> MatchMeta:
        r = np.random.default_rng(self.seed + 7)
        return MatchMeta(
            match_id=self.match_id,
            seed=self.seed,
            competition="Synthetic Premier Division",
            matchday=self.matchday,
            kickoff_utc=f"2026-10-{int(r.integers(1, 28)):02d}T{int(r.choice([12, 14, 15, 17, 19])):02d}:00:00Z",
            venue=VENUES[[c[1] for c in CLUBS].index(self.home.short_name) % len(VENUES)],
            referee=str(r.choice(REFEREES)),
            weather=str(r.choice(WEATHER)),
            home=self.home,
            away=self.away,
        )

    def _play_period(self, period: int) -> None:
        s = self.s
        s.period = period
        s.period_start = s.elapsed
        stoppage = float(self.rng.integers(1, 4 if period == 1 else 7)) * 60 + float(self.rng.uniform(0, 50))
        s.period_end = s.elapsed + HALF_S + stoppage
        self._emit("Half Start")
        team = self.home if period == 1 else self.away
        state = (team, (60.0, 40.0), "Kick Off", None)
        while s.elapsed < s.period_end:
            state = self._possession(*state)
        self._emit("Half End", score=tuple(s.score))
        if period == 1:  # half-time: the clock jumps 15 minutes, nobody runs
            s.elapsed += 15 * 60
            s.next_phys = s.elapsed + self.phys_every

    def _possession(self, team: Team, loc, pattern: str, opener):
        """Play one possession. Returns the next (team, location, pattern, opener)."""
        s = self.s
        s.possession += 1
        opp = self._other(team)
        x, y = loc
        pk = {"possession_team_id": team.id}
        actor = self._pick(team, x)

        if opener is not None:  # the event that won the ball for this team
            kind, player = opener
            self._emit(kind, team, player, location=(round(x, 1), round(y, 1)), outcome="Won", **pk)
            actor = player
        if pattern == "Kick Off":
            actor = next(p for p in self.on_pitch[team.id] if p.position == "ST")
            self._emit("Kick Off", team, actor, location=(60.0, 40.0), score=tuple(s.score), **pk)
        if pattern == "Corner":
            return self._corner(team, actor, loc)

        while s.elapsed < s.period_end:
            adv = self._advantage(team)
            dz = 1.0 if x > 80 else 0.0
            press_p = 0.12 + 0.16 * opp.pressing + 0.10 * (x / 120) - 0.06 * adv
            pressed = self.rng.random() < press_p
            if pressed:
                presser = self._pick(opp, 120 - x)
                self._emit("Pressure", opp, presser, location=_mirror((x, y)),
                           player_speed_kmh=self._speed(presser, 0.55, 0.92), **pk)
                self._advance(0.4)
                if self.rng.random() < 0.045:  # foul while pressing
                    return self._foul(team, opp, presser, actor, (x, y))

            dist, _ = goal_geometry(x, y)
            shot_p = 0.0 if dist > 35 else 0.19 * math.exp(-dist / 20.0) * (1 + 0.8 * adv)
            r = self.rng.random()
            if r < shot_p:
                return self._shot(team, actor, (x, y), pressed, header=False)
            r = self.rng.random()
            if r < 0.80:
                nxt = self._pass(team, actor, (x, y), pressed, adv)
                if nxt[0] == "keep":
                    _, actor, (x, y) = nxt
                    continue
                return nxt[1]
            if r < 0.95 - 0.04 * dz:
                if pressed and self.rng.random() < 0.12:  # tackled on the carry
                    defender = self._pick(opp, 120 - x)
                    self._emit("Tackle", opp, defender, location=_mirror((x, y)), outcome="Won",
                               possession_team_id=team.id)
                    self._advance(1.0)
                    return (opp, _mirror((x, y)), "Regular Play", None)
                (x, y) = self._carry(team, actor, (x, y))
                continue
            nxt = self._dribble(team, opp, actor, (x, y), adv)
            if nxt[0] == "keep":
                (x, y) = nxt[1]
                continue
            return nxt[1]
        return (team, (x, y), "Regular Play", None)

    # ----------------------------------------------------------- actions
    def _pass(self, team: Team, actor: Player, loc, pressed: bool, adv: float):
        x, y = loc
        opp = self._other(team)
        long_bias = 0.25 * team.directness + (0.2 if x < 40 else 0.0)
        length_m = float(np.clip(self.rng.lognormal(math.log(14.0 + 10 * long_bias), 0.55), 4, 75))
        for attempt in range(6):  # players rarely aim out of play: resample most such passes
            mix = self.rng.random()
            if mix < 0.55:
                theta = self.rng.normal(0, 0.55)
            elif mix < 0.85:
                theta = self.rng.choice([-1, 1]) * self.rng.normal(1.45, 0.3)
            else:
                theta = self.rng.normal(math.pi, 0.5)
            dx = length_m * math.cos(theta) * 120 / 105
            dy = length_m * math.sin(theta) * 80 / 68
            ex, ey = x + dx, y + dy
            out = not (0 <= ex <= 120 and 0 <= ey <= 80)
            if not out or self.rng.random() < 0.08:
                break
            length_m *= 0.85
        ex, ey = float(np.clip(ex, 0.5, 119.5)), float(np.clip(ey, 0.5, 79.5))
        backward = math.cos(theta) < -0.3
        in_box = ex > 102 and 18 < ey < 62
        p_ok = (0.965 - 0.0065 * max(0.0, length_m - 8) - 0.11 * pressed - 0.12 * in_box
                - 0.05 * (ex > 80) + 0.07 * adv + 0.06 * backward)
        complete = (not out) and self.rng.random() < p_ok
        height = "High" if length_m > 30 and self.rng.random() < 0.7 else ("Low" if length_m > 20 else "Ground")
        speed = round(float(np.clip(22 + 1.35 * length_m + self.rng.normal(0, 6), 18, 105)), 1)
        dt = 0.9 + length_m / 15 + abs(self.rng.normal(1.4, 0.7))
        pk = {"possession_team_id": team.id}
        if complete:
            rec = self._pick(team, ex, exclude=actor)
            self._emit("Pass", team, actor, location=(round(x, 1), round(y, 1)),
                       end_location=(round(ex, 1), round(ey, 1)), outcome="Complete",
                       under_pressure=pressed, recipient_id=rec.id, recipient_name=rec.name,
                       pass_length_m=round(length_m, 1), pass_height=height, ball_speed_kmh=speed, **pk)
            self._advance(dt)
            return ("keep", rec, (ex, ey))
        outcome = "Out" if out else "Incomplete"
        self._emit("Pass", team, actor, location=(round(x, 1), round(y, 1)),
                   end_location=(round(ex, 1), round(ey, 1)), outcome=outcome, under_pressure=pressed,
                   pass_length_m=round(length_m, 1), pass_height=height, ball_speed_kmh=speed, **pk)
        self._advance(dt)
        if out:
            if ex >= 119:
                self._advance(18)
                return ("end", (opp, (6.0, 40.0), "Goal Kick", None))
            self._advance(10)
            return ("end", (opp, _mirror((ex, ey)), "Throw-in", None))
        winner = self._pick(opp, 120 - ex)
        kind = "Interception" if self.rng.random() < 0.22 else "Ball Recovery"
        return ("end", (opp, _mirror((ex, ey)), "Regular Play", (kind, winner)))

    def _carry(self, team: Team, actor: Player, loc):
        x, y = loc
        d = float(np.clip(self.rng.gamma(2.2, 3.2), 1.5, 30))
        theta = self.rng.normal(0, 0.7)
        ex = float(np.clip(x + d * math.cos(theta) * 120 / 105, 0.5, 119.5))
        ey = float(np.clip(y + d * math.sin(theta) * 80 / 68, 0.5, 79.5))
        self._emit("Carry", team, actor, location=(round(x, 1), round(y, 1)), end_location=(round(ex, 1), round(ey, 1)),
                   player_speed_kmh=self._speed(actor, 0.45, 0.97 if d > 12 else 0.8), possession_team_id=team.id)
        self._advance(1.0 + d / 5.5)
        return (ex, ey)

    def _dribble(self, team: Team, opp: Team, actor: Player, loc, adv: float):
        x, y = loc
        defender = self._pick(opp, 120 - x)
        win = self.rng.random() < 0.52 + 0.18 * adv
        pk = {"possession_team_id": team.id}
        self._emit("Dribble", team, actor, location=(round(x, 1), round(y, 1)),
                   outcome="Complete" if win else "Incomplete",
                   player_speed_kmh=self._speed(actor, 0.6, 0.98), **pk)
        self._advance(1.5)
        if win:
            return ("keep", (min(119.5, x + 4), y))
        if self.rng.random() < 0.22:
            return ("end", self._foul(team, opp, defender, actor, (x, y)))
        self._emit("Tackle", opp, defender, location=_mirror((x, y)), outcome="Won", **pk)
        self._advance(1.0)
        return ("end", (opp, _mirror((x, y)), "Regular Play", None))

    def _foul(self, team: Team, opp: Team, fouler: Player, fouled: Player, loc):
        self._emit("Foul Committed", opp, fouler, location=_mirror(loc), possession_team_id=team.id)
        if self.rng.random() < 0.13:
            self._emit("Card", opp, fouler, card="Yellow", possession_team_id=team.id)
        self._advance(float(self.rng.uniform(15, 35)))
        return (team, loc, "Free Kick", None)

    def _shot(self, team: Team, actor: Player, loc, pressed: bool, header: bool):
        s = self.s
        x, y = loc
        opp = self._other(team)
        q = shot_quality(x, y, pressed, header)
        r = self.rng.random()
        if r < q:
            outcome = "Goal"
        else:
            r2 = self.rng.random()
            outcome = "Saved" if r2 < 0.30 else ("Blocked" if r2 < 0.56 else "Off T")
        speed = float(np.clip(self.rng.normal(52, 8) if header else self.rng.normal(88, 14), 40, 125))
        ix = 0 if team.id == self.home.id else 1
        if outcome == "Goal":
            s.score[ix] += 1
        self._emit("Shot", team, actor, location=(round(x, 1), round(y, 1)),
                   end_location=(120.0, round(float(self.rng.uniform(36.5, 43.5)), 1)) if outcome in ("Goal", "Saved") else None,
                   outcome=outcome, under_pressure=pressed, body_part="Head" if header else "Foot",
                   ball_speed_kmh=round(speed, 1), score=tuple(s.score), possession_team_id=team.id)
        self._advance(1.5)
        gk = next(p for p in self.on_pitch[opp.id] if p.role == "GK")
        if outcome == "Goal":
            # the team that concedes gets a jolt of urgency
            s.momentum += -0.12 if team.id == self.home.id else 0.12
            self._advance(float(self.rng.uniform(45, 75)))
            return (opp, (60.0, 40.0), "Kick Off", None)
        if outcome == "Saved":
            self._emit("Goal Keeper", opp, gk, location=(2.0, 40.0), outcome="Saved", possession_team_id=team.id)
            if self.rng.random() < 0.3:
                self._advance(25)
                return (team, (119.5, 0.5 if self.rng.random() < 0.5 else 79.5), "Corner", None)
            self._advance(6)
            return (opp, (6.0, 40.0), "Regular Play", None)
        if outcome == "Blocked":
            if self.rng.random() < 0.4:
                self._advance(25)
                return (team, (119.5, 0.5 if self.rng.random() < 0.5 else 79.5), "Corner", None)
            winner = self._pick(opp, 120 - x)
            return (opp, _mirror((x, y)), "Regular Play", ("Ball Recovery", winner))
        self._advance(20)
        return (opp, (6.0, 40.0), "Goal Kick", None)

    def _corner(self, team: Team, taker: Player, loc):
        tx = float(self.rng.uniform(106, 116))
        ty = float(self.rng.uniform(30, 50))
        opp = self._other(team)
        ok = self.rng.random() < 0.38
        rec = self._pick(team, 110, exclude=taker)
        length_m = to_metres(tx - loc[0], ty - loc[1])
        self._emit("Pass", team, taker, location=loc, end_location=(round(tx, 1), round(ty, 1)),
                   outcome="Complete" if ok else "Incomplete", recipient_id=rec.id if ok else None,
                   recipient_name=rec.name if ok else None, pass_length_m=round(length_m, 1),
                   pass_height="High", ball_speed_kmh=round(float(self.rng.normal(68, 7)), 1),
                   possession_team_id=team.id)
        self._advance(2.0)
        if ok and self.rng.random() < 0.55:
            return self._shot(team, rec, (tx, ty), pressed=True, header=True)
        if ok:
            return (team, (tx, ty), "Regular Play", None)
        winner = self._pick(opp, 120 - tx)
        return (opp, _mirror((tx, ty)), "Regular Play", ("Ball Recovery", winner))


def generate_match(seed: int, home_index: int | None = None, away_index: int | None = None,
                   matchday: int = 1) -> tuple[MatchMeta, list[Event]]:
    """Generate one full synthetic match."""
    rng = np.random.default_rng(seed)
    if home_index is None or away_index is None:
        home_index, away_index = (int(i) for i in rng.choice(len(CLUBS), size=2, replace=False))
    home, away = build_team(home_index, seed), build_team(away_index, seed)
    return MatchSimulator(home, away, seed=seed, matchday=matchday).run()
