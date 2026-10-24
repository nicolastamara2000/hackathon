from matchcopilot.generator.engine import generate_match, goal_geometry, shot_quality
from matchcopilot.generator.validate import validate


def test_same_seed_same_match():
    _, a = generate_match(42)
    _, b = generate_match(42)
    assert [e.model_dump() for e in a] == [e.model_dump() for e in b]


def test_different_seeds_differ():
    _, a = generate_match(1)
    _, b = generate_match(2)
    assert len(a) != len(b) or a[100].model_dump() != b[100].model_dump()


def test_clock_is_monotonic_and_halves_are_ordered():
    _, events = generate_match(3)
    clocks = [e.clock_s for e in events]
    assert clocks == sorted(clocks)
    periods = [e.period for e in events]
    assert periods == sorted(periods)
    assert events[0].type == "Half Start" and events[-1].type == "Half End"


def test_score_matches_goals():
    _, events = generate_match(5)
    goals = [e for e in events if e.type == "Shot" and e.outcome == "Goal"]
    final = events[-1].score
    assert sum(final) == len(goals)


def test_locations_stay_on_pitch():
    _, events = generate_match(9)
    for e in events:
        for loc in (e.location, e.end_location):
            if loc:
                assert 0 <= loc[0] <= 120 and 0 <= loc[1] <= 80


def test_eleven_players_each_side_in_physical_updates():
    meta, events = generate_match(11)
    phys = [e for e in events if e.type == "Physical Update"]
    assert len(phys) >= 90
    assert all(len(e.physical) == 22 for e in phys)


def test_fictional_clubs_only():
    meta, _ = generate_match(13)
    real_words = {"Arsenal", "Chelsea", "Liverpool", "Manchester", "Tottenham", "Everton"}
    assert not any(w in meta.home.name or w in meta.away.name for w in real_words)


def test_shot_quality_falls_with_distance():
    assert shot_quality(114, 40, False, False) > shot_quality(102, 40, False, False) > shot_quality(90, 40, False, False)
    dist, _ = goal_geometry(108, 40)
    assert 10 < dist < 11


def test_realism_targets():
    report = validate(n_matches=20, seed0=100)
    bad = {k: v for k, v in report.items() if not v["ok"]}
    assert not bad, bad
