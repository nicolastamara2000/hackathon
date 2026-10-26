import json

from fastapi.testclient import TestClient

from matchcopilot.api.app import app


def test_health_and_fixtures():
    with TestClient(app) as c:
        assert c.get("/healthz").json()["ok"] is True
        fixtures = c.get("/api/matches").json()
        assert len(fixtures) >= 3 and all("home" in f for f in fixtures)
        meta = c.get(f"/api/matches/{fixtures[0]['seed']}").json()
        assert len(meta["home"]["lineup"]) == 11


def test_stream_delivers_personalized_cards_until_the_end():
    with TestClient(app) as c:
        c.post("/api/live/7/start?speed=0&restart=true")
        kinds, langs_ok, end = [], True, False
        with c.stream("GET", "/api/live/7/stream?mode=fan&lang=es") as r:
            for line in r.iter_lines():
                if not line.startswith("data: "):
                    continue
                msg = json.loads(line[6:])
                if msg["type"] == "card":
                    kinds.append(msg["card"]["kind"])
                    if msg["card"]["kind"] == "goal":
                        langs_ok &= msg["card"]["headline"].startswith("¡GOL!")
                if msg["type"] == "end":
                    end = True
                    break
        assert end and "goal" in kinds and "full_time" in kinds and langs_ok
        cards = c.get("/api/live/7/cards").json()
        assert len(cards) >= len(kinds)


def test_react_ui_stream_gets_full_events_with_model_values():
    with TestClient(app) as c:
        c.post("/api/live/7/start?speed=0&restart=true")
        types, shot_xg, pass_diff = set(), [], []
        with c.stream("GET", "/api/live/7/stream?mode=analyst&lang=en&events=true") as r:
            for line in r.iter_lines():
                if not line.startswith("data: "):
                    continue
                msg = json.loads(line[6:])
                if msg["type"] == "event":
                    e = msg["event"]
                    types.add(e["type"])
                    if e["type"] == "Shot":
                        shot_xg.append(e["xg"])
                    if e["type"] == "Pass":
                        pass_diff.append(e["pass_difficulty"])
                if msg["type"] == "end":
                    break
        assert {"Card", "Substitution", "Half End", "Physical Update"} <= types
        assert shot_xg and all(0 < x < 1 for x in shot_xg)
        assert pass_diff and all(0 <= d <= 100 for d in pass_diff)
