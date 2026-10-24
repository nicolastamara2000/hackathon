"""HTTP API: live match broadcasts as Server-Sent Events, personalized per viewer.

One broadcast per match is shared by every viewer (the agents run once per moment,
not once per viewer). Each viewer's stream is shaped by their profile.

    GET  /api/matches                         fixtures available to broadcast
    GET  /api/matches/{seed}                  match metadata (clubs, lineups)
    POST /api/live/{seed}/start?speed=30      start (or restart) a broadcast
    GET  /api/live/{seed}/stream?mode=fan&lang=es&team=HCF&player=HCF-9&metric=xg
    GET  /api/live/{seed}/cards               every card so far, machine-readable
"""

from __future__ import annotations

import asyncio
import json
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from ..agents.crew import make_client
from ..generator.engine import generate_match
from ..narration.cards import Card
from ..narration.personalize import ViewerProfile, view
from ..session import MatchSession
from .sources import event_source

FIXTURES = [7, 21, 33, 8, 9]
DEFAULT_SPEED = float(os.getenv("REPLAY_SPEED", "20"))
WEB_DIR = Path(__file__).resolve().parents[3] / "web"
PITCH_EVENTS = {"Pass", "Carry", "Shot", "Dribble", "Kick Off", "Interception", "Ball Recovery", "Tackle"}


class Broadcast:
    def __init__(self, seed: int, speed: float, client):
        self.seed = seed
        meta, self.events = generate_match(seed)
        self.meta = meta.model_dump()
        self.session = MatchSession(self.meta, client=client)
        self.backlog: list[dict] = []
        self.queues: set[asyncio.Queue] = set()
        self.session.subscribe(self._fanout)
        self.task = asyncio.create_task(self.session.run(event_source(self.meta, self.events, speed)))

    async def _fanout(self, msg: dict) -> None:
        if msg["type"] == "event" and msg["event"]["type"] not in PITCH_EVENTS:
            return
        self.backlog.append(msg)
        for q in list(self.queues):
            q.put_nowait(msg)


class Hub:
    def __init__(self):
        self.live: dict[int, Broadcast] = {}
        self.client = make_client()

    def start(self, seed: int, speed: float, restart: bool = False) -> Broadcast:
        b = self.live.get(seed)
        if b is None or restart or b.task.done():
            if b is not None and not b.task.done():
                b.task.cancel()
            b = Broadcast(seed, speed, self.client)
            self.live[seed] = b
        return b


hub: Hub | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global hub
    hub = Hub()
    yield
    for b in hub.live.values():
        b.task.cancel()


app = FastAPI(title="Match Co-pilot", version="0.1.0", lifespan=lifespan)


def _render(msg: dict, profile: ViewerProfile) -> dict | None:
    if msg["type"] == "card":
        v = view(msg["card"], profile)
        return {"type": "card", "card": v} if v else None
    if msg["type"] == "event":
        return {"type": "event", "event": msg["event"]}
    return msg


def _sse(obj: dict) -> str:
    return f"data: {json.dumps(obj, ensure_ascii=False, default=str)}\n\n"


@app.get("/healthz")
async def healthz():
    return {"ok": True, "agents": hub.client is not None, "live": len(hub.live)}


@app.get("/api/matches")
async def matches():
    out = []
    for seed in FIXTURES:
        meta, _ = generate_match(seed)
        out.append({"seed": seed, "match_id": meta.match_id, "home": meta.home.name, "away": meta.away.name,
                    "venue": meta.venue, "kickoff_utc": meta.kickoff_utc,
                    "live": seed in hub.live and not hub.live[seed].task.done()})
    return out


@app.get("/api/matches/{seed}")
async def match_meta(seed: int):
    meta, _ = generate_match(seed)
    return meta.model_dump()


@app.post("/api/live/{seed}/start")
async def start(seed: int, speed: float = DEFAULT_SPEED, restart: bool = False):
    b = hub.start(seed, speed, restart)
    return {"match_id": b.meta["match_id"], "speed": speed, "agents": hub.client is not None}


@app.get("/api/live/{seed}/cards")
async def cards(seed: int):
    b = hub.live.get(seed)
    if b is None:
        raise HTTPException(404, "broadcast not started")
    return [c.model_dump() for c in sorted(b.session.cards.values(), key=lambda c: c.clock_s)]


@app.get("/api/live/{seed}/stream")
async def stream(request: Request, seed: int, mode: str = "fan", lang: str = "en",
                 team: str | None = None, player: str | None = None, metric: str | None = None,
                 speed: float = DEFAULT_SPEED, history: bool = Query(True)):
    profile = ViewerProfile(mode=mode, lang=lang, favorite_team=team or None,
                            favorite_player=player or None, metric=metric or None)
    b = hub.start(seed, speed)
    q: asyncio.Queue = asyncio.Queue()

    async def gen() -> AsyncIterator[str]:
        b.queues.add(q)
        try:
            yield _sse({"type": "hello", "meta": b.meta, "profile": profile.model_dump(),
                        "agents": hub.client is not None})
            if history:
                for msg in list(b.backlog):
                    if (r := _render(msg, profile)) and msg["type"] != "event":
                        yield _sse(r)
            while True:
                if await request.is_disconnected():
                    break
                try:
                    msg = await asyncio.wait_for(q.get(), 15)
                except TimeoutError:
                    yield ": keep-alive\n\n"
                    continue
                if (r := _render(msg, profile)) is not None:
                    yield _sse(r)
                if msg["type"] == "end":
                    break
        finally:
            b.queues.discard(q)

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


if WEB_DIR.exists():
    app.mount("/static", StaticFiles(directory=WEB_DIR), name="static")

    @app.get("/")
    async def index():
        return FileResponse(WEB_DIR / "index.html")
