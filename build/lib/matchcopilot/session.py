"""A live match session: events in, cards out.

Pipeline per event: ingest -> interpret (MatchAnalyzer) -> template card published at
once -> important cards handed to the agent crew in the background -> upgraded card
published with the same card_id and a higher version. Subscribers (viewers, storage)
get every published card and a state snapshot once a match minute.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator, Awaitable, Callable

from .agents.crew import MatchContext, MatchCrew
from .metrics.analyzer import MatchAnalyzer
from .narration.cards import Card, card_from_insight

log = logging.getLogger(__name__)

Publish = Callable[[dict], Awaitable[None]]


class MatchSession:
    def __init__(self, meta: dict, client=None, max_parallel_agents: int = 3):
        self.meta = meta
        self.match_id = meta["match_id"]
        self.analyzer = MatchAnalyzer(meta)
        self.teams = {meta["home"]["id"]: meta["home"]["name"], meta["away"]["id"]: meta["away"]["name"]}
        self.ctx = MatchContext(analyzer=self.analyzer, teams=self.teams)
        self.crew = MatchCrew(client, self.ctx) if client is not None else None
        self.sem = asyncio.Semaphore(max_parallel_agents)
        self.cards: dict[str, Card] = {}
        self.subscribers: list[Publish] = []
        self.tasks: set[asyncio.Task] = set()
        self.last_minute = -1
        self.done = False

    def subscribe(self, fn: Publish) -> None:
        self.subscribers.append(fn)

    async def _publish(self, msg: dict) -> None:
        for fn in list(self.subscribers):
            try:
                await fn(msg)
            except Exception:  # a broken subscriber must not stop the match
                log.exception("subscriber failed")

    async def _publish_card(self, card: Card) -> None:
        self.cards[card.card_id] = card
        await self._publish({"type": "card", "card": card})

    async def _enrich(self, card: Card, insight: dict) -> None:
        async with self.sem:
            upgraded = await self.crew.enrich(card, insight)
        if upgraded.version > card.version:
            await self._publish_card(upgraded)

    async def ingest(self, event: dict) -> None:
        insights = self.analyzer.ingest(event)
        await self._publish({"type": "event", "event": {k: event.get(k) for k in (
            "index", "minute", "second", "clock_s", "type", "team_id", "player_name", "location",
            "end_location", "outcome")}})
        for ins in insights:
            d = ins.to_dict()
            card = card_from_insight(d, self.match_id, self.teams)
            await self._publish_card(card)
            if self.crew is not None and MatchCrew.wants(d):
                t = asyncio.create_task(self._enrich(card, d))
                self.tasks.add(t)
                t.add_done_callback(self.tasks.discard)
        if event.get("minute", -1) != self.last_minute and event.get("type") == "Physical Update":
            self.last_minute = event["minute"]
            await self._publish({"type": "state", "state": self.analyzer.snapshot()})

    async def run(self, events: AsyncIterator[dict]) -> None:
        async for e in events:
            await self.ingest(e)
        if self.tasks:
            await asyncio.gather(*self.tasks, return_exceptions=True)
        self.done = True
        await self._publish({"type": "state", "state": self.analyzer.snapshot()})
        await self._publish({"type": "end"})
