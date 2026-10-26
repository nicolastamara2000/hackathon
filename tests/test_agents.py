import asyncio
import json

import agent_framework as af
import pytest

from matchcopilot.agents.crew import Evidence, Explanation, MatchCrew, Narration, Recap, unsupported_numbers
from matchcopilot.generator.engine import generate_match
from matchcopilot.narration.personalize import ViewerProfile, view
from matchcopilot.session import MatchSession


def _text(fan, analyst, why):
    return {"fan": fan, "analyst": analyst, "why": why}


class ScriptedClient(af.BaseChatClient):
    """Stands in for a Foundry model: answers each agent with valid structured output."""

    def __init__(self, invent_numbers=False, fail=False):
        super().__init__()
        self.invent, self.fail, self.calls = invent_numbers, fail, []

    async def _answer(self, messages, options):
        fmt = options.get("response_format")
        self.calls.append(fmt.__name__ if fmt else None)
        if self.fail:
            raise RuntimeError("model unavailable")
        if fmt is Evidence:
            body = {"key_numbers": ["xG 0.3"], "context": "Sustained pressure.", "comparison": None}
        elif fmt is Explanation:
            body = {"why": "It flips the game.", "theme": "momentum", "confidence": 0.8}
        elif fmt is Narration:
            n = "4321" if self.invent else ""
            body = {"en": _text(f"Big moment {n}".strip(), "Numbers line", "Because it matters"),
                    "es": _text("Gran momento", "Línea de números", "Porque importa")}
        elif fmt is Recap:
            body = {"en": _text("Recap", "Recap numbers", "Turning point"),
                    "es": _text("Resumen", "Números", "Punto de quiebre"), "turning_point_minute": None}
        else:
            body = {}
        return af.ChatResponse(messages=[af.Message(role="assistant", contents=[af.Content.from_text(json.dumps(body))])])

    def _inner_get_response(self, *, messages, stream, options, **kwargs):
        return self._answer(messages, options)


async def _events(events):
    for e in events:
        yield e.model_dump(exclude_none=True)


def _run_session(client, seed=7):
    meta, events = generate_match(seed)
    session = MatchSession(meta.model_dump(), client=client)
    seen = []

    async def collect(msg):
        seen.append(msg)

    session.subscribe(collect)
    asyncio.run(session.run(_events(events)))
    return session, seen


def test_template_only_mode_publishes_cards_without_a_model():
    session, seen = _run_session(None)
    cards = [m["card"] for m in seen if m["type"] == "card"]
    assert len(cards) > 30
    assert all(c.source == "template" for c in cards)
    assert seen[-1]["type"] == "end"


def test_crew_upgrades_important_cards():
    client = ScriptedClient()
    session, seen = _run_session(client)
    upgraded = [m["card"] for m in seen if m["type"] == "card" and m["card"].source == "agents"]
    assert upgraded and all(c.version == 2 for c in upgraded)
    assert {"Evidence", "Explanation", "Narration", "Recap"} <= set(client.calls)
    assert session.ctx.moments  # explained moments are shared with the recap writer


def test_model_failure_falls_back_to_template():
    session, seen = _run_session(ScriptedClient(fail=True))
    assert not any(m["card"].source == "agents" for m in seen if m["type"] == "card")
    assert session.crew.failures > 0


def test_invented_numbers_are_rejected():
    session, seen = _run_session(ScriptedClient(invent_numbers=True))
    assert not any(m["card"].source == "agents" and m["card"].kind != "full_time" and m["card"].kind != "half_time"
                   for m in seen if m["type"] == "card")


def test_fact_check_accepts_rounded_and_percent_numbers():
    src = [{"xg": 0.365, "win_prob": 0.681, "speed": 111.3}]
    assert unsupported_numbers("xG 0.37, 68% to win, 111 km/h", src) == []
    assert unsupported_numbers("he ran 42 km", src) == ["42"]


def test_personalization_differs_by_mode_and_language():
    session, seen = _run_session(None)
    cards = [m["card"] for m in seen if m["type"] == "card"]
    fan = [v for c in cards if (v := view(c, ViewerProfile(mode="fan", lang="es")))]
    analyst = [v for c in cards if (v := view(c, ViewerProfile(mode="analyst")))]
    assert len(analyst) > len(fan) > 0
    assert any(v["metrics"] for v in analyst) and not any(v["metrics"] for v in fan)
    goal = next(v for v in fan if v["kind"] == "goal")
    assert goal["headline"].startswith("¡GOL!")


def test_player_focus_mode_follows_the_player():
    session, seen = _run_session(None)
    cards = [m["card"] for m in seen if m["type"] == "card"]
    pid = next(c.player_id for c in cards if c.kind == "goal")
    prof = ViewerProfile(mode="player", favorite_player=pid)
    shown = [v for c in cards if (v := view(c, prof))]
    assert all(v["your_player"] or v["kind"] in ("goal", "half_time", "full_time") for v in shown)
    assert any(v["your_player"] for v in shown)


class WriterClient(af.BaseChatClient):
    """Answers the story and scout writers; can slip in a number that is not in the facts."""

    def __init__(self, invent=False):
        super().__init__()
        self.invent, self.calls = invent, 0

    async def _answer(self, messages, options):
        from matchcopilot.agents.writers import PlayerReportOut, StoryOut
        fmt = options.get("response_format")
        self.calls += 1
        n = " with 77 passes" if self.invent else ""
        if fmt is StoryOut:
            body = {"headline": f"Eastbrook press{n}", "paragraphs": ["Eastbrook won it high: 9 high recoveries."],
                    "tactical_key": "The press.", "watch_next": None}
        else:
            body = {"headline": "Busy night", "role": "Holding midfielder.", "strengths": ["47 touches."],
                    "concerns": ["Few shots."], "vs_opponent": "Out-touched his man.", "verdict": "Solid."}
        return af.ChatResponse(messages=[af.Message(role="assistant", contents=[af.Content.from_text(json.dumps(body))])])

    def _inner_get_response(self, *, messages, stream, options, **kwargs):
        return self._answer(messages, options)


def test_story_writer_passes_fact_check_and_caches():
    from matchcopilot.agents.writers import Writers
    client = WriterClient()
    w = Writers(client)
    facts = {"score": [2, 0], "high_recoveries": 9}
    out = asyncio.run(w.story(facts, "en"))
    assert out["headline"].startswith("Eastbrook") and client.calls == 1
    asyncio.run(w.story(facts, "en"))
    assert client.calls == 1  # cached


def test_writer_rejects_invented_numbers_after_one_retry():
    from matchcopilot.agents.writers import Writers
    client = WriterClient(invent=True)
    with pytest.raises(ValueError):
        asyncio.run(Writers(client).story({"high_recoveries": 9}, "es"))
    assert client.calls == 2


def test_player_report_endpoint_without_foundry_is_503():
    from fastapi.testclient import TestClient
    from matchcopilot.api.app import app
    with TestClient(app) as c:
        r = c.post("/api/ai/player-report", json={"lang": "en", "facts": {"touches": 47}})
    assert r.status_code == 503
