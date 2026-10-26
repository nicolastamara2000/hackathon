"""HTTP API: live match broadcasts as Server-Sent Events, personalized per viewer.

One broadcast per match is shared by every viewer (the agents run once per moment,
not once per viewer). Each viewer's stream is shaped by their profile.

    GET  /api/matches                         fixtures available to broadcast
    GET  /api/matches/{seed}                  match metadata (clubs, lineups)
    POST /api/live/{seed}/start?speed=30      start (or restart) a broadcast
    GET  /api/matches/{seed}/events?until=1800 events of a match (landing preview)
    POST /api/live/{seed}/speed?speed=60      change the speed of a running broadcast
    POST /api/ai/story, /api/ai/player-report  long-form text from Foundry agents, over client facts
    GET  /api/live/{seed}/stream?mode=fan&lang=es&team=HCF&player=HCF-9&metric=xg&events=true
    GET  /api/live/{seed}/cards               every card so far, machine-readable

    GET  /         React broadcast UI (frontend/dist)     GET  /classic   the first web UI
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from ..agents.crew import make_client
from ..agents.writers import WriteRequest, Writers
from ..generator.engine import generate_match
from ..narration.cards import Card
from ..narration.personalize import ViewerProfile, view
from ..session import MatchSession
from .sources import Pace, event_source, eventhub_enabled
from .store import make_store

log = logging.getLogger(__name__)

FIXTURES = [7, 21, 33, 8, 9]
DEFAULT_SPEED = float(os.getenv("REPLAY_SPEED", "20"))
WEB_DIR = next((d for d in (Path(os.getenv("WEB_DIR", "web")).resolve(),
                             Path(__file__).resolve().parents[3] / "web") if d.exists()), Path("web"))
# React broadcast UI (frontend/, built with `npm run build`), served at / (classic UI at /classic)
FRONTEND_DIR = next((d for d in (Path(os.getenv("FRONTEND_DIR", "frontend/dist")).resolve(),
                                  Path(__file__).resolve().parents[3] / "frontend" / "dist") if d.exists()), None)
PITCH_EVENTS = {"Pass", "Carry", "Shot", "Dribble", "Kick Off", "Interception", "Ball Recovery", "Tackle"}


class Broadcast:
    def __init__(self, seed: int, speed: float, client, store=None):
        self.seed = seed
        meta, self.events = generate_match(seed)
        self.meta = meta.model_dump()
        self.session = MatchSession(self.meta, client=client)
        self.backlog: list[dict] = []
        self.queues: set[asyncio.Queue] = set()
        self.session.subscribe(self._fanout)
        if store is not None:
            self.session.subscribe(store)
        self.pace = Pace(speed)
        self.task = asyncio.create_task(self.session.run(event_source(self.meta, self.events, self.pace)))

    async def _fanout(self, msg: dict) -> None:
        self.backlog.append(msg)
        for q in list(self.queues):
            q.put_nowait(msg)


class Hub:
    def __init__(self):
        self.live: dict[int, Broadcast] = {}
        self.client = make_client()
        self.writers = Writers(self.client) if self.client else None
        self.store = make_store()

    def start(self, seed: int, speed: float, restart: bool = False) -> Broadcast:
        b = self.live.get(seed)
        if b is None or restart or b.task.done():
            if b is not None and not b.task.done():
                b.task.cancel()
            b = Broadcast(seed, speed, self.client, self.store)
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


def _render(msg: dict, profile: ViewerProfile, all_events: bool = False) -> dict | None:
    """`all_events` (the React UI) gets every event type; the classic UI only on-ball ones."""
    if msg["type"] == "card":
        v = view(msg["card"], profile)
        return {"type": "card", "card": v} if v else None
    if msg["type"] == "event":
        if not all_events and msg["event"]["type"] not in PITCH_EVENTS:
            return None
        return {"type": "event", "event": msg["event"]}
    return msg


def _sse(obj: dict) -> str:
    return f"data: {json.dumps(obj, ensure_ascii=False, default=str)}\n\n"


@app.get("/healthz")
async def healthz():
    return {"ok": True, "agents": hub.client is not None, "cosmos": hub.store is not None,
            "eventhub": eventhub_enabled(), "live": len(hub.live)}


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


@app.get("/api/matches/{seed}/events")
async def match_events(seed: int, until: float | None = Query(None, ge=0)):
    """Events of a match up to `until` (match clock seconds): the landing page previews the opening phase."""
    _, events = generate_match(seed)
    return [e.model_dump(exclude_none=True) for e in events if until is None or e.clock_s <= until]


async def _write(req: WriteRequest, kind: str):
    if hub.writers is None:
        raise HTTPException(503, "AI writer not configured")
    if len(json.dumps(req.facts)) > 60_000:
        raise HTTPException(413, "facts too large")
    try:
        write = hub.writers.story if kind == "story" else hub.writers.player_report
        return {"source": "agents", **(await write(req.facts, req.lang))}
    except Exception as exc:  # timeout, model error, failed fact check: the UI keeps the rule-based text
        log.warning("%s writer failed: %r", kind, exc)
        raise HTTPException(502, "AI writer failed") from exc


@app.post("/api/ai/story")
async def ai_story(req: WriteRequest):
    """Match story written by the Foundry story agent from verified facts computed by the client."""
    return await _write(req, "story")


@app.post("/api/ai/player-report")
async def ai_player_report(req: WriteRequest):
    """One-match player report written by the Foundry scout agent from verified facts."""
    return await _write(req, "player")


@app.post("/api/live/{seed}/start")
async def start(seed: int, speed: float = DEFAULT_SPEED, restart: bool = False):
    b = hub.start(seed, speed, restart)
    return {"match_id": b.meta["match_id"], "speed": speed, "agents": hub.client is not None}


@app.post("/api/live/{seed}/speed")
async def set_speed(seed: int, speed: float = Query(..., ge=1, le=120)):
    """Change the replay speed of a running broadcast (every viewer of it follows)."""
    b = hub.live.get(seed)
    if b is None or b.task.done():
        raise HTTPException(404, "broadcast not running")
    b.pace.speed = speed
    return {"speed": speed}


@app.get("/api/live/{seed}/cards")
async def cards(seed: int):
    b = hub.live.get(seed)
    if b is None:
        raise HTTPException(404, "broadcast not started")
    return [c.model_dump() for c in sorted(b.session.cards.values(), key=lambda c: c.clock_s)]


@app.get("/api/live/{seed}/stream")
async def stream(request: Request, seed: int, mode: str = "fan", lang: str = "en",
                 team: str | None = None, player: str | None = None, metric: str | None = None,
                 speed: float = DEFAULT_SPEED, history: bool = Query(True), events: bool = Query(False)):
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
                    if (r := _render(msg, profile, events)) and (events or msg["type"] != "event"):
                        yield _sse(r)
            while True:
                if await request.is_disconnected():
                    break
                try:
                    msg = await asyncio.wait_for(q.get(), 15)
                except TimeoutError:
                    yield ": keep-alive\n\n"
                    continue
                if (r := _render(msg, profile, events)) is not None:
                    yield _sse(r)
                if msg["type"] == "end":
                    break
        finally:
            b.queues.discard(q)

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


if WEB_DIR.exists():
    app.mount("/static", StaticFiles(directory=WEB_DIR), name="static")

    @app.get("/classic")
    async def classic():
        return FileResponse(WEB_DIR / "index.html")

    if FRONTEND_DIR is None:
        @app.get("/")
        async def index():
            return FileResponse(WEB_DIR / "index.html")


if FRONTEND_DIR is not None:
    # the React broadcast UI is the main page; mounted last so /api routes win
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="app")
