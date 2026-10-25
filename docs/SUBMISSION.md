# Submission kit

## Elevator pitch (for the project page)

**Match Co-pilot turns synthetic match events into live, explainable match intelligence that every
fan can tailor.**

Football coverage tells you what happened. Match Co-pilot tells you why it matters, as it happens.
A synthetic data engine simulates realistic 90-minute matches (about 1,900 events each, validated
against 15 top-flight benchmarks). A streaming metrics engine turns them into xG, pass difficulty,
a control vs chaos index and live win probability. A crew of four agents built with **Microsoft
Agent Framework** on **Microsoft Foundry** models then explains each key moment. A stats analyst
pulls evidence through tools, an explainer says why it matters, a narrator writes English and
Spanish on-screen lines, and a recap writer builds half-time and full-time stories from a shared
moment log. Every number an agent writes is fact-checked against the data. If a model call fails,
an instant template card stays on screen, so the broadcast never breaks.

The same intelligence reaches a casual fan and a data-hungry analyst as two different experiences.
Viewers pick Fan, Analyst or Player focus mode, their language, favorite club, favorite player and
the metric they care about. Cards are timed, machine-readable JSON with placement and duration, so
they can drive real broadcast overlays.

**Microsoft and Azure technology:** Microsoft Foundry (models), Microsoft Agent Framework
(multi-agent crew, tools, structured outputs), Azure Container Apps (app), Azure Event Hubs
(event stream), Azure Cosmos DB (card feed), managed identity (no keys), Bicep + Azure Developer
CLI (one-command deploy), GitHub Actions (CI), GitHub Copilot.

## Demo video script (under 2 minutes)

| Time | Screen | Voice-over |
| --- | --- | --- |
| 0:00-0:12 | App idle, then Start match | "Football stories don't end with the scoreline. Match Co-pilot explains why every moment matters, live." |
| 0:12-0:30 | Pitch moving, stats panel, control chart | "This is a synthetic match: 1,900 realistic events, checked against 15 top-flight benchmarks. Metrics update every minute: xG, win probability, and our control versus chaos index." |
| 0:30-0:50 | A goal: full-screen card with the AI badge | "When a goal lands, four AI agents on Microsoft Foundry go to work: a stats analyst, an explainer, a narrator and a recap writer, built with Agent Framework. Every number they write is fact-checked." |
| 0:50-1:10 | Switch Fan to Analyst | "Same moment, two experiences. Fans get the story. Analysts get the numbers: xG, shot speed, win-probability swing." |
| 1:10-1:25 | Switch to ES, then Player focus on a forward | "In Spanish too. Or follow one player all match: sprints, top speed, every touch that matters." |
| 1:25-1:45 | Half-time recap card, then README architecture | "At half-time the recap writer tells the story of the half. Underneath: Event Hubs, Container Apps, Cosmos DB, one-command deploy with azd." |
| 1:45-1:55 | Logo / repo URL | "Match Co-pilot: every match, made for every fan." |

Recording tips: use 40x speed so a goal comes quickly, pick a fixture with goals (seed 7 has 7),
and use no copyrighted music.

## Testing instructions (for judges)

1. Open the demo URL and press **Start match**.
2. Switch **Fan / Analyst / Player focus**, **EN / ES**, and pick a favorite club or player.
3. Machine-readable feed: `GET /api/live/{seed}/cards`. Health: `GET /healthz`.
4. Run locally: see README, "Run the app locally". Tests: `pytest`.
