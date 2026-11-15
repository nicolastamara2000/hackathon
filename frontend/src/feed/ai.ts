/** Client for the Foundry writers. A failure means: keep the rule-based text. */
import { STATIC } from "./static";

/** off: no writer on this server. failed: the writer ran but gave no checked text. none: the static demo has no recording for this moment. */
export type AIStatus = "off" | "failed" | "none";

export class AIError extends Error {
  constructor(public status: AIStatus) {
    super(status);
  }
}

/** One text written by the live Foundry agents, saved by scripts/export-ai.ts. */
export interface Recorded {
  kind: "story" | "player";
  lang: "en" | "es";
  minute: number;
  player?: string;
  text: Record<string, unknown>;
}

let recorded: Promise<Recorded[]> | null = null;
const loadRecorded = () =>
  (recorded ??= fetch(`${import.meta.env.BASE_URL}ai-recorded.json`)
    .then((r) => (r.ok ? r.json() : { texts: [] }))
    .then((d: { texts?: Recorded[] }) => d.texts ?? [])
    .catch(() => []));

/** Static demo: the latest recorded text written at or before the current minute. */
async function replay<T>(kind: Recorded["kind"], facts: unknown, lang: "en" | "es"): Promise<T> {
  const f = (facts ?? {}) as { minute?: number; player?: { name?: string } };
  const minute = f.minute ?? 0;
  const hit = (await loadRecorded())
    .filter((r) => r.kind === kind && r.lang === lang && r.minute <= minute && (kind === "story" || r.player === f.player?.name))
    .sort((a, b) => b.minute - a.minute)[0];
  if (!hit) throw new AIError("none");
  return { ...hit.text, recorded_minute: hit.minute } as T;
}

async function write<T>(path: string, facts: unknown, locale: string): Promise<T> {
  const lang = locale === "en" ? "en" : "es";
  if (STATIC) return replay<T>(path.endsWith("story") ? "story" : "player", facts, lang);
  const r = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lang, facts }),
  }).catch(() => null);
  if (!r || !r.ok) throw new AIError(r?.status === 503 ? "off" : "failed");
  return r.json();
}

export interface AIStory {
  headline: string;
  paragraphs: string[];
  tactical_key: string;
  watch_next: string | null;
  /** static demo only: the match minute the recorded text was written at */
  recorded_minute?: number;
}

export interface AIPlayerReport {
  headline: string;
  role: string;
  strengths: string[];
  concerns: string[];
  vs_opponent: string;
  verdict: string;
  recorded_minute?: number;
}

export const writeStory = (facts: unknown, locale: string) => write<AIStory>("/api/ai/story", facts, locale);
export const writePlayerReport = (facts: unknown, locale: string) => write<AIPlayerReport>("/api/ai/player-report", facts, locale);
