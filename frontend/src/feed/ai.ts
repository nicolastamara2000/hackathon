/** Client for the Foundry writers. A failure means: keep the rule-based text. */
export type AIStatus = "off" | "failed";

export class AIError extends Error {
  constructor(public status: AIStatus) {
    super(status);
  }
}

async function write<T>(path: string, facts: unknown, locale: string): Promise<T> {
  const r = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lang: locale === "en" ? "en" : "es", facts }),
  }).catch(() => null);
  if (!r || !r.ok) throw new AIError(r?.status === 503 ? "off" : "failed");
  return r.json();
}

export interface AIStory {
  headline: string;
  paragraphs: string[];
  tactical_key: string;
  watch_next: string | null;
}

export interface AIPlayerReport {
  headline: string;
  role: string;
  strengths: string[];
  concerns: string[];
  vs_opponent: string;
  verdict: string;
}

export const writeStory = (facts: unknown, locale: string) => write<AIStory>("/api/ai/story", facts, locale);
export const writePlayerReport = (facts: unknown, locale: string) => write<AIPlayerReport>("/api/ai/player-report", facts, locale);
