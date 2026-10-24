import pytest

from matchcopilot.generator.engine import generate_match
from matchcopilot.metrics.analyzer import MatchAnalyzer, win_probability
from matchcopilot.metrics.models import pass_difficulty, xg


@pytest.fixture(scope="module")
def analysed():
    meta, events = generate_match(7)
    a = MatchAnalyzer(meta.model_dump())
    insights = []
    for e in events:
        insights += a.ingest(e.model_dump(exclude_none=True))
    return meta, events, a, insights


def test_xg_is_higher_close_to_goal():
    close = {"location": (114, 40), "body_part": "Foot", "under_pressure": False}
    far = {"location": (92, 40), "body_part": "Foot", "under_pressure": False}
    assert xg(close) > 0.3 > 0.05 > xg(far)


def test_long_pressured_pass_into_box_is_harder():
    easy = {"location": (40, 40), "end_location": (50, 40), "pass_length_m": 9, "under_pressure": False}
    hard = {"location": (70, 10), "end_location": (110, 40), "pass_length_m": 45, "under_pressure": True}
    assert pass_difficulty(hard) > pass_difficulty(easy) + 30


def test_win_probability_sums_to_one_and_respects_score():
    wp = win_probability((2, 0), 85, 1.4, 1.4)
    assert abs(sum(wp.values()) - 1) < 1e-6
    assert wp["home"] > 0.9
    assert win_probability((0, 0), 0, 1.4, 1.4)["draw"] > 0.2


def test_goal_insights_match_score(analysed):
    meta, events, a, insights = analysed
    goals = [i for i in insights if i.kind == "goal"]
    final = events[-1].score
    assert len(goals) == sum(final)
    assert all(i.importance >= 0.8 for i in goals)


def test_stats_are_consistent(analysed):
    meta, events, a, _ = analysed
    passes = [e for e in events if e.type == "Pass"]
    s = a.team_stats()
    assert sum(t["passes"] for t in s.values()) == len(passes)
    assert sum(t["possession_s"] for t in s.values()) > 90 * 60 * 0.8


def test_control_shifts_are_debounced(analysed):
    *_, insights = analysed
    shifts = [i for i in insights if i.kind == "control_shift"]
    assert 2 <= len(shifts) <= 14
    minutes = [i.minute for i in shifts]
    assert all(b - a >= 4 for a, b in zip(minutes, minutes[1:]))


def test_one_speed_alert_per_player(analysed):
    *_, insights = analysed
    ids = [i.player_id for i in insights if i.kind == "speed_alert"]
    assert len(ids) == len(set(ids))


def test_snapshot_shape(analysed):
    meta, _, a, _ = analysed
    snap = a.snapshot()
    assert set(snap["score"]) == {meta.home.id, meta.away.id}
    assert snap["control"] is not None and -1 <= snap["control"]["control"] <= 1
