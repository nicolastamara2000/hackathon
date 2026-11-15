/**
 * Record the Foundry-written AI texts from the live PITCHIQ app, for the static
 * GitHub Pages demo (public/ai-recorded.json).
 *
 * The facts are computed here with the same browser engines the app uses (match 7,
 * at half-time and full-time), then POSTed to the live /api/ai/* writers, exactly as
 * the "Write it" buttons do.
 *
 *   npm run export:ai -- https://<your-app>.azurecontainerapps.io
 *   npm run export:ai -- --dry-run          # only print the facts, call nothing
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { MatchEvent, MatchMeta } from "../src/feed/types";
import type { Locale } from "../src/i18n/strings";
import { playerFacts, storyFacts } from "../src/stats/aiFacts";
import { computeStats } from "../src/stats/engine";
import { influence } from "../src/stats/influence";
import { findBreaks } from "../src/stats/time";
import { turningPoints } from "../src/stats/turning";

const here = dirname(fileURLToPath(import.meta.url));
const { meta, events } = JSON.parse(readFileSync(join(here, "../src/mock/data/match-7.json"), "utf8")) as { meta: MatchMeta; events: MatchEvent[] };
const OUT = join(here, "../public/ai-recorded.json");

const args = process.argv.slice(2);
const dry = args.includes("--dry-run");
const base = args.find((a) => a.startsWith("http"))?.replace(/\/+$/, "");
if (!dry && !base) {
  console.error("Usage: npm run export:ai -- https://<your-app-url>   (or --dry-run)");
  process.exit(1);
}

const breaks = findBreaks(events);
const end = events[events.length - 1].clock_s;
const moments = [
  { clock: breaks.he1 ?? end / 2, ended: false },
  { clock: end, ended: true },
];

// players with a recording: each team's Player-focus default (first forward) + the 3 most influential
const fwd = (s: "home" | "away") => (meta[s].lineup.find((p) => p.role === "FWD") ?? meta[s].lineup[0]).id;
const players = [...new Set([fwd("home"), fwd("away"), ...influence(meta, events).slice(0, 3).map((p) => p.id)])];

const LOCALES: { locale: Locale; lang: "en" | "es" }[] = [
  { locale: "en", lang: "en" },
  { locale: "es-419", lang: "es" },
];

type Job = { kind: "story" | "player"; lang: "en" | "es"; minute: number; player?: string; facts: unknown };
const jobs: Job[] = [];
for (const { clock, ended } of moments) {
  const stats = computeStats(meta, events, clock);
  const tps = turningPoints(meta, events, clock);
  for (const { locale, lang } of LOCALES) {
    jobs.push({ kind: "story", lang, minute: stats.minute, facts: storyFacts(meta, events, clock, stats, tps, ended, locale) });
    for (const id of players) {
      const facts = playerFacts(meta, events, clock, stats.minute, id, tps, locale);
      if (facts) jobs.push({ kind: "player", lang, minute: stats.minute, player: facts.player.name, facts });
    }
  }
}

if (dry) {
  console.log(JSON.stringify(jobs.slice(0, 2), null, 2));
  console.log(`${jobs.length} texts would be requested: ${jobs.map((j) => `${j.kind}${j.player ? `:${j.player}` : ""}@${j.minute}/${j.lang}`).join(", ")}`);
  process.exit(0);
}

async function call(j: Job, attempt = 1): Promise<Record<string, unknown> | null> {
  const path = j.kind === "story" ? "/api/ai/story" : "/api/ai/player-report";
  const r = await fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lang: j.lang, facts: j.facts }) }).catch((e) => {
    console.warn(`  network error: ${e}`);
    return null;
  });
  if (r?.ok) return r.json();
  if (r?.status === 503) throw new Error("The AI writer is not configured on this server (503).");
  if (attempt < 3) return call(j, attempt + 1); // 502 = failed fact check or timeout: the writer tries again
  return null;
}

const texts: object[] = [];
for (const [i, j] of jobs.entries()) {
  const label = `${j.kind}${j.player ? ` ${j.player}` : ""} ${j.minute}' ${j.lang}`;
  process.stdout.write(`[${i + 1}/${jobs.length}] ${label} ... `);
  const text = await call(j);
  console.log(text ? "ok" : "skipped");
  if (text) {
    delete text.source;
    texts.push({ kind: j.kind, lang: j.lang, minute: j.minute, ...(j.player ? { player: j.player } : {}), text });
  }
}
writeFileSync(OUT, JSON.stringify({ match_id: meta.match_id, recorded_utc: new Date().toISOString(), source: "Microsoft Foundry agents on the live PITCHIQ app", texts }, null, 1));
console.log(`\n${texts.length}/${jobs.length} texts saved to ${OUT}`);
