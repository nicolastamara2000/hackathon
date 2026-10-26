"""Long-form writers on Foundry: the AI match story and the AI player report.

The browser computes every number (stats engine, turning point engine, player
numbers) and sends them as `facts`. The writers only explain those facts in
football language: they never compute. Each draft is fact-checked against the
facts it was given, retried once with a correction, and rejected otherwise, so
the UI falls back to the rule-based text.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
from typing import Literal

from agent_framework import Agent
from pydantic import BaseModel, Field

from .crew import unsupported_numbers

log = logging.getLogger(__name__)

LANG = {"en": "English", "es": "Latin American Spanish (voseo is fine, natural football vocabulary)"}


class StoryOut(BaseModel):
    headline: str = Field(description="At most 12 words, the story of the match so far")
    paragraphs: list[str] = Field(description="3 or 4 short paragraphs, at most 70 words each, in match order")
    tactical_key: str = Field(description="One sentence: the tactical idea that decided or is deciding the match")
    watch_next: str | None = Field(default=None, description="One sentence hypothesis of what to watch next; null at full time")


class PlayerReportOut(BaseModel):
    headline: str = Field(description="At most 12 words on the player's match")
    role: str = Field(description="One or two sentences: how the player is used and where they influence play")
    strengths: list[str] = Field(description="2 or 3 strengths, each one sentence backed by a number from the facts")
    concerns: list[str] = Field(description="1 or 2 weaknesses or open questions, each one sentence")
    vs_opponent: str = Field(description="One sentence comparing the player with the opponent who plays the same position")
    verdict: str = Field(description="One sentence scouting verdict for this match only")


STORY_INSTRUCTIONS = """You are a football analyst writing the match story for fans and coaches.
You get verified facts as JSON: score, team stats, goals, turning points (with what was observed and
why it matters), and the most influential players. Tell the story in match order like a good match
report: phases of control, how each team tried to play, pressing, build-up, transitions, chances,
and how the game turned. Explain cause and effect in football terms (press, block height, overloads,
half-spaces, rest defence, transitions, set pieces), not only numbers.
Rules: use only names and numbers present in the facts; never compute new numbers (no sums,
differences or percentages that are not given); if phase is "live" do not say who won; say
"suggests" or "points to" for interpretations. No emojis, no headings inside paragraphs."""

PLAYER_INSTRUCTIONS = """You are a football scout writing a one-match performance report.
You get verified facts as JSON: the player's role and position, their numbers, the numbers of the opponent
who plays the same position, their key actions with minutes, and their team's turning points. Describe how the player
influenced the game in football terms: positioning, involvement in build-up, progression, risk taking,
duels, defensive work, movement and pace. Back each strength with a number from the facts.
Rules: use only names and numbers present in the facts; never compute new numbers; one match is a
small sample, so keep the verdict proportionate. No emojis."""


class Writers:
    def __init__(self, client, timeout_s: float | None = None):
        self.timeout = timeout_s or float(os.getenv("WRITER_TIMEOUT_S", "60"))
        effort = os.getenv("FOUNDRY_REASONING_EFFORT", "low")
        self.extra = {"reasoning": {"effort": effort}} if effort and effort != "none" else {}
        self.story_agent = Agent(client, STORY_INSTRUCTIONS, name="story_writer")
        self.player_agent = Agent(client, PLAYER_INSTRUCTIONS, name="scout_writer")
        self.cache: dict[str, dict] = {}

    async def _write(self, agent: Agent, facts: dict, lang: str, fmt: type[BaseModel]) -> dict:
        key = hashlib.sha256(json.dumps([agent.name, lang, facts], sort_keys=True).encode()).hexdigest()
        if key in self.cache:
            return self.cache[key]
        prompt = {"write_in": LANG.get(lang, LANG["en"]), "facts": facts}
        for attempt in range(2):
            resp = await asyncio.wait_for(
                agent.run(json.dumps(prompt, ensure_ascii=False), options={"response_format": fmt, **self.extra}),
                self.timeout)
            out = resp.value if resp.value is not None else fmt.model_validate_json(resp.text)
            body = out.model_dump()
            bad = unsupported_numbers(json.dumps(body, ensure_ascii=False), [facts])
            if not bad:
                self.cache[key] = body
                return body
            log.warning("%s draft used unsupported numbers %s", agent.name, bad)
            prompt["fix"] = f"Your last draft used numbers not in the facts: {bad}. Use only the given numbers."
        raise ValueError("draft failed the fact check twice")

    async def story(self, facts: dict, lang: str) -> dict:
        return await self._write(self.story_agent, facts, lang, StoryOut)

    async def player_report(self, facts: dict, lang: str) -> dict:
        return await self._write(self.player_agent, facts, lang, PlayerReportOut)


class WriteRequest(BaseModel):
    lang: Literal["en", "es"] = "en"
    facts: dict
