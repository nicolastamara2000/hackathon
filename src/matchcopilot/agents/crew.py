"""The agent crew: four specialised agents built on Microsoft Agent Framework.

    Producer (deterministic)  picks which insights deserve agent time
    Stats analyst             pulls evidence through tools over the live match state
    Explainer                 turns evidence into why the moment matters
    Narrator                  writes fan and analyst lines in English and Spanish
    Recap writer              half-time and full-time recaps from the shared moment log

Agents hand off through a shared `MatchContext` (match state + log of explained
moments). Every step has a timeout, the narration is fact-checked against the
numbers the agents were given, and any failure falls back to the template card,
so the overlay never breaks.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from dataclasses import dataclass, field
from typing import Literal

from agent_framework import Agent, tool
from pydantic import BaseModel, Field

from ..metrics.analyzer import MatchAnalyzer
from ..narration.cards import Card, CardText

log = logging.getLogger(__name__)

ENRICH_KINDS = {"goal", "big_chance", "control_shift", "hard_pass", "half_time", "full_time", "rocket_shot"}
ENRICH_MIN_IMPORTANCE = 0.5


# ----------------------------------------------------------------- outputs
class Evidence(BaseModel):
    key_numbers: list[str] = Field(description="3 to 5 facts, each with its number and unit, taken from tools")
    context: str = Field(description="What led to this moment in the last few minutes, one sentence")
    comparison: str | None = Field(default=None, description="How it compares with the rest of the match")


class Explanation(BaseModel):
    why: str = Field(description="Why the moment matters, one or two sentences, cause and effect")
    theme: Literal["control", "chaos", "pressure", "rhythm", "quality", "momentum", "individual"]
    confidence: float = Field(ge=0, le=1)


class Narration(BaseModel):
    en: CardText
    es: CardText


class Recap(BaseModel):
    en: CardText
    es: CardText
    turning_point_minute: int | None = None


# ----------------------------------------------------------------- instructions
STATS_INSTRUCTIONS = """You are the stats analyst of a live football broadcast.
You receive one match insight as JSON. Use your tools to pull the evidence that explains it:
team stats, the control trend, the player's numbers. Report only numbers you read from the
insight or from tools. Never invent a number."""

EXPLAINER_INSTRUCTIONS = """You are a tactical explainer for football fans.
Given an insight and the evidence, say WHY the moment matters, not only what happened:
cause and effect, control versus chaos, pressure, rhythm, quality of chances, momentum.
Use only the numbers you were given. Be concrete and short."""

NARRATOR_INSTRUCTIONS = """You write on-screen text for a live football overlay, in English and
Latin American Spanish. For each language write:
- fan: a casual-fan headline, at most 14 words, no jargon, energetic
- analyst: one line with the key numbers, at most 30 words
- why: one sentence on why it matters
Use only names and numbers present in the input. Spanish must be natural, not a word-for-word
translation. No emojis."""

RECAP_INSTRUCTIONS = """You write half-time and full-time recaps for a football broadcast in English
and Latin American Spanish. Use the score, the stats and the log of key moments you are given.
fan: the story of the half in at most 20 words. analyst: the numbers that explain the result, at
most 40 words. why: the turning point and why. Use only the numbers you were given."""


# ----------------------------------------------------------------- shared state
@dataclass
class MatchContext:
    analyzer: MatchAnalyzer
    teams: dict[str, str]
    moments: list[dict] = field(default_factory=list)  # explained moments, shared by all agents


def build_tools(ctx: MatchContext) -> list:
    a = ctx.analyzer

    @tool
    def get_match_snapshot() -> str:
        """Current score, minute, team stats, win probability and latest control index."""
        snap = a.snapshot()
        snap.pop("control_history", None)
        return json.dumps(snap)

    @tool
    def get_control_trend(minutes: int = 10) -> str:
        """Control index (-1 away .. +1 home) and chaos (0..1) per minute for the last N minutes."""
        hist = [h for h in a.control_history if h["minute"] >= a.minute - minutes]
        return json.dumps({"home": ctx.analyzer.home, "away": ctx.analyzer.away, "trend": hist})

    @tool
    def get_player_summary(player_id: str) -> str:
        """Match numbers for one player: passes, shots, xG, goals, pressures, distance, top speed."""
        return json.dumps(a.player_summary(player_id))

    @tool
    def get_recent_moments(n: int = 5) -> str:
        """The last N key moments already explained in this match."""
        return json.dumps(ctx.moments[-n:])

    return [get_match_snapshot, get_control_trend, get_player_summary, get_recent_moments]


# ----------------------------------------------------------------- fact check
_NUM = re.compile(r"(?<![\w.])-?\d+(?:[.,]\d+)?")
_FREE = {0.0, 1.0, 2.0, 45.0, 90.0}  # counts and clock marks a writer may use without a source


def _values(obj) -> list[float]:
    vals = []
    for raw in _NUM.findall(json.dumps(obj, ensure_ascii=False)):
        try:
            vals.append(abs(float(raw)))
        except ValueError:
            pass
    return vals


def unsupported_numbers(text: str, sources: list) -> list[str]:
    """Numbers in `text` that match no number in `sources`, allowing rounding and 0.68 -> 68%."""
    allowed = _values(sources)
    bad = []
    for raw in _NUM.findall(text):
        n = abs(float(raw.replace(",", ".")))
        if n in _FREE:
            continue
        ok = any(abs(n - a) <= (0.006 if a < 1 else 0.51) or (a <= 1 and abs(n - 100 * a) <= 0.51)
                 for a in allowed)
        if not ok:
            bad.append(raw)
    return bad


# ----------------------------------------------------------------- the crew
class MatchCrew:
    def __init__(self, client, ctx: MatchContext, step_timeout_s: float | None = None):
        self.ctx = ctx
        self.timeout = step_timeout_s or float(os.getenv("AGENT_STEP_TIMEOUT_S", "45"))
        # reasoning models (gpt-5 family): low effort keeps a 3-step handoff fast enough for live play
        effort = os.getenv("FOUNDRY_REASONING_EFFORT", "low")
        self.extra_options = {"reasoning": {"effort": effort}} if effort and effort != "none" else {}
        tools = build_tools(ctx)
        self.stats = Agent(client, STATS_INSTRUCTIONS, name="stats_analyst", tools=tools)
        self.explainer = Agent(client, EXPLAINER_INSTRUCTIONS, name="explainer")
        self.narrator = Agent(client, NARRATOR_INSTRUCTIONS, name="narrator")
        self.recapper = Agent(client, RECAP_INSTRUCTIONS, name="recap_writer", tools=tools[:1] + tools[3:])
        self.failures = 0

    @staticmethod
    def wants(insight: dict) -> bool:
        """Producer: only important moments get agent time; the rest stay template cards."""
        return insight["kind"] in ENRICH_KINDS and (
            insight["importance"] >= ENRICH_MIN_IMPORTANCE or insight["kind"] in ("half_time", "full_time"))

    async def _run(self, agent: Agent, prompt: str, fmt):
        resp = await asyncio.wait_for(
            agent.run(prompt, options={"response_format": fmt, **self.extra_options}), self.timeout)
        value = resp.value
        if value is None:
            value = fmt.model_validate_json(resp.text)
        return value

    async def enrich(self, card: Card, insight: dict) -> Card:
        """Run the crew on one card. Returns an upgraded card, or the template card on any failure."""
        try:
            if insight["kind"] in ("half_time", "full_time"):
                return await self._recap(card, insight)
            payload = json.dumps({"insight": insight, "teams": self.ctx.teams})
            evidence: Evidence = await self._run(self.stats, payload, Evidence)
            explanation: Explanation = await self._run(
                self.explainer, json.dumps({"insight": insight, "evidence": evidence.model_dump()}), Explanation)
            sources = [insight, evidence.model_dump(), self.ctx.analyzer.snapshot()]
            narration = None
            for attempt in range(2):
                draft: Narration = await self._run(self.narrator, json.dumps({
                    "insight": insight, "teams": self.ctx.teams, "evidence": evidence.model_dump(),
                    "explanation": explanation.model_dump(),
                    "style_example": {k: v.model_dump() for k, v in card.text.items()},
                    **({"fix": "Your last draft used numbers not in the input. Use only given numbers."}
                       if attempt else {})}), Narration)
                text = " ".join(t for lang in (draft.en, draft.es) for t in (lang.fan, lang.analyst, lang.why))
                bad = unsupported_numbers(text, sources)
                if not bad:
                    narration = draft
                    break
                log.warning("narration for %s had unsupported numbers %s", card.card_id, bad)
            if narration is None:
                raise ValueError("narration failed the fact check twice")
            self.ctx.moments.append({"minute": insight["minute"], "kind": insight["kind"],
                                     "team": self.ctx.teams.get(insight.get("team_id") or ""),
                                     "player": insight.get("player_name"), "why": explanation.why,
                                     "theme": explanation.theme})
            return card.model_copy(update={
                "text": {"en": narration.en, "es": narration.es}, "source": "agents", "version": card.version + 1,
                "tags": sorted(set(card.tags) | {explanation.theme})})
        except Exception as exc:  # timeouts, model errors, bad JSON: keep the template card
            self.failures += 1
            log.warning("crew fell back to template for %s: %r", card.card_id, exc)
            return card.model_copy(update={"tags": sorted(set(card.tags) | {"fallback"})})

    async def _recap(self, card: Card, insight: dict) -> Card:
        payload = json.dumps({"insight": insight, "teams": self.ctx.teams, "moments": self.ctx.moments})
        recap: Recap = await self._run(self.recapper, payload, Recap)
        text = " ".join(t for lang in (recap.en, recap.es) for t in (lang.fan, lang.analyst, lang.why))
        bad = unsupported_numbers(text, [insight, self.ctx.moments, self.ctx.analyzer.snapshot()])
        if bad:
            raise ValueError(f"recap used unsupported numbers {bad}")
        metrics = dict(card.metrics)
        if recap.turning_point_minute is not None:
            metrics["turning_point_minute"] = recap.turning_point_minute
        return card.model_copy(update={"text": {"en": recap.en, "es": recap.es}, "source": "agents",
                                       "version": card.version + 1, "metrics": metrics})


def make_client():
    """Foundry chat client from env (FOUNDRY_PROJECT_ENDPOINT, FOUNDRY_MODEL), or None for template-only mode."""
    if not (os.getenv("FOUNDRY_PROJECT_ENDPOINT") and os.getenv("FOUNDRY_MODEL")):
        return None
    from agent_framework.foundry import FoundryChatClient
    from azure.identity import DefaultAzureCredential

    return FoundryChatClient(credential=DefaultAzureCredential())
