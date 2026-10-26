# Submission kit (PITCHIQ)

What the rules ask for (Official Rules, submission requirements):

1. **Project pitch / description**: what you built, which Microsoft and Azure technologies, what it does, what problem it solves. Text below.
2. **Demo video**: under 2 minutes, shows the working app, public URL (YouTube or Vimeo), no third-party trademarks or copyrighted music. Script below.
3. **Public GitHub repo URL**: https://github.com/nicolastamara2000/hackathon
4. **Working demo link + testing instructions**: below. Everything in English.

## Project description (paste on the project page)

**PITCHIQ turns synthetic match events into live, explainable football intelligence: what changed, why it matters and what to watch next.**

Stats sites tell you possession was 68%. They don't tell you that one team's press has cut the other's route through midfield, or when it started. PITCHIQ does, live, and shows the evidence behind every claim.

- **Synthetic data engine.** A Python generator simulates full 90-minute matches possession by possession, about 1,900 events each. Every event carries locations, ball, shot and player speeds, and physical snapshots for all 22 players. It is tuned to 15 public top-flight benchmarks, with fictional clubs and players.
- **Tactical Turning Point Engine.** Every minute of play it compares the last 10 minutes with the 10 before on eight signals: press height, forward-pass success, flank overloads, territory, threat (xT/xG), sterile possession, chaos and reaction to goals or subs. Each turning point carries the observed numbers, a confidence level, a lifecycle (new, developing, confirmed, no longer supported) and links to the events behind it.
- **Microsoft Agent Framework agents on Microsoft Foundry.**
  - Live moments go through a crew of four specialised agents: a stats analyst (tools over live match state), an explainer, a narrator in English and Latin American Spanish, and a recap writer.
  - A story writer and a scout writer produce the AI match story and the AI player performance report.
  - The agents explain only numbers the engines verified. Every number they write is fact-checked, and a failed or slow model call falls back to a rule-based card, so the broadcast never breaks.
- **One match, three experiences.** Fan mode gives one line and big numbers. Analyst mode adds event maps (shots by xG, passes by difficulty, control zones, sprints, touches) beside the live pitch, plus turning points, a filterable event feed and the match story. Player focus covers one player against their opponent in the same position, with an AI scouting report. Everything is available in English and Spanish, and replay speed can change during the match.

**Microsoft and Azure technology:**
- Microsoft Foundry (gpt-5-mini) and Microsoft Agent Framework: multi-agent crew, tools, structured outputs, shared state.
- Azure Event Hubs (event stream), Azure Container Apps (app), Azure Cosmos DB (card feed).
- Managed identity (no keys), Bicep and Azure Developer CLI (one-command deploy).
- GitHub Actions (CI) and GitHub Copilot.

## Demo video script (1:55, English)

About 75% product, 25% architecture. Record at 1920×1080 with seed 7 (Eastbrook vs Silverlake). Start in Analyst mode at 40× and use 90× to jump ahead. No music, or royalty-free music only. Do not mention or show any real league or club names.

| Time | Screen | Voice-over |
| --- | --- | --- |
| 0:00–0:10 | Landing: PITCHIQ, "From this match" card | "A stats site tells you possession was 68 percent. PITCHIQ tells you why the match is turning, while it happens." |
| 0:10–0:20 | Click the first match card, Analyst, Start match | "Every match here is synthetic: 1,900 realistic events, fictional clubs, tuned to real league averages." |
| 0:20–0:42 | Turning points tab: open a card such as "SLT pin EBW back", show Observed, Why it matters, What to watch next, then **Show on pitch** | "Every minute, the Turning Point Engine compares the last ten minutes with the ten before. Here, field tilt jumped from 16 to 84 percent. Each insight separates what we observed from our reading and our hypothesis, with a confidence level, and links to the exact events behind it." |
| 0:42–0:57 | Map buttons: Shots, then Sprints with the "Last 15′" window, live pitch still moving on the left | "Event maps open beside the live picture, never on top of it: chances by xG, passes by difficulty, control zones, sprints in any time window." |
| 0:57–1:12 | Story tab, press **Write it**, scroll the AI story | "At any minute, an agent on Microsoft Foundry writes the match story. It only explains numbers the engine has verified, and every number it writes is fact-checked." |
| 1:12–1:27 | Player focus, pick a player, press **Write it** on the AI report, then switch to Fan and ES | "Follow one player against their direct rival, with an AI scouting report. Or switch to Fan mode, in Spanish: one line, big numbers, no jargon." |
| 1:27–1:45 | Architecture slide (`docs/img/architecture.png`), then 5 s of the Foundry portal showing the project and the gpt-5-mini deployment | "Under the hood: the generator streams into Azure Event Hubs. Microsoft Agent Framework agents on Foundry analyse, explain, narrate and write. Cards go to Cosmos DB, and the app runs on Azure Container Apps, deployed with one azd command and managed identity, with no keys." |
| 1:45–1:55 | Back to the live pitch, then the PITCHIQ logo and repo URL | "PITCHIQ: don't just see what happened. Understand why." |

Recording tips:
- Press Restart before recording so turning points build up live.
- If the AI story says the writer is not configured, check the Container App's Foundry settings before recording that shot.
- Trim dead time and keep the cut under 1:58.

## Testing instructions (for judges)

1. Open the demo: https://ca-matchcopilot-thfqhhiyefk5q.wittysmoke-635db452.eastus2.azurecontainerapps.io/
2. Pick a match, a mode (Fan, Analyst or Player focus) and press **Start match**. Change the speed during the match with the 5×–90× buttons.
3. In Analyst mode, open a turning point and press **Show on pitch**, try the map buttons and time windows, and press **Write it** on the Story tab.
4. In Player focus, pick a player and press **Write it** for the AI report.
5. Machine-readable endpoints: `GET /api/live/{seed}/cards`, `GET /api/matches/{seed}/events`, `GET /healthz`.
6. Run locally and run the tests: see the README (`pytest`, `npm run build` in `frontend/`).
