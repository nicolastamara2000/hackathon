/**
 * Static build for GitHub Pages (VITE_STATIC=1): no backend. The match replays in the
 * browser from the bundled feed, and the AI texts come from public/ai-recorded.json,
 * written by the live Foundry agents before the Azure demo was retired
 * (scripts/export-ai.ts).
 */
export const STATIC = import.meta.env.VITE_STATIC === "1";
