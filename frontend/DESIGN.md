# Broadcast UI: design notes

React + TypeScript + Tailwind, D3 (pitch, momentum strip), Recharts (win %, xG), Framer Motion (overlays).
Served by FastAPI at `/`. The first UI stays at `/classic`.

## Live Match View: wireframe

```
┌ [crest] EASTBROOK WANDERERS  1 – 2  SILVERLAKE TOWN [crest] ─────────── 61:50  2nd half ● LIVE ┐
│ WIN PROBABILITY [ EBW 7% |//// Draw 21% ////| SLT 72% ...........................................] │
├──────────────────────────────────────────────────────────────┬──────────────────────────────────┤
│ D3 PITCH  22 dots (shirt no.), name tag on ball carrier and  │ RIGHT PANEL (by mode)            │
│ receiver, sprint badge > 25 km/h, ball trail colored+thick   │ Analyst: gauge, 12 KPIs, win %,  │
│ by ball speed, lower-third GOAL overlay                      │ xG step, latest actions, JSON    │
│                                                              │ Fan: emoji + 1 line + 1 big %    │
├──────────────────────────────────────────────────────────────┴──────────────────────────────────┤
│ MOMENTUM  ▲ home / ▼ away mirrored wave · markers ● goal ▲ chance ▮ card ⇄ sub · HT ┆ · scrub ◀▶ │
│ 0′ ───── 15′ ───── 30′ ───── 45′ ┆ ───── 60′ ───●(playhead) //// not played ////  [1× 10× 20× 60×] │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

TV 1920×1080: grid `1fr | 420px`, no page scroll. Mobile 390 px: scoreboard, pitch, panel, strip stacked.

## Tokens (`src/styles/tokens.css`)

| Token | Dark | Light | Use |
| --- | --- | --- | --- |
| bg | #0B0F14 | #F4F6F9 | page |
| surface | #121821 | #FFFFFF | panels |
| raised | #1A2230 | #ECF0F5 | cards, hover |
| line | #273142 | #D6DDE6 | hairlines |
| ink | #F2F5F8 (16.9:1) | #0B0F14 | text |
| muted | #9AA7B8 (7.4:1) | #4A5568 (7.5:1) | secondary text |
| accent | #56B4E9 | #0072B2 | focus, selection |
| good / warn / bad | #009E73 / #E69F00 / #D55E00 | darker | pass difficulty, alerts |
| home / away | from match config | from match config | nudged to ≥ 3:1 on surface; away uses its 2nd color if too close to home |

Data colors are Okabe-Ito (color-blind safe). Nothing relies on color alone: win % draw is hatched,
difficulty badges print Easy/Med/Hard, momentum uses up/down position, markers use shape, the
ball trail encodes speed in width as well as color.

Type: Barlow Condensed (numbers, tabular figures via `.num`), Inter (text).
Scale 11 / 12 / 14 / 16 / 20 / 24, TV sizes 28 / 40 / 64 / 96 px (full-screen text ≥ 28 px).
Spacing: 4 px base (4, 8, 12, 16, 24, 32, 48). Radius 4 / 8 / 12.
Motion: overlays slide in 300 ms `cubic-bezier(0.2, 0.8, 0.2, 1)`, fade out 200 ms.

## Data feed

`src/feed/types.ts` mirrors `generator/schema.py`. Without `VITE_FEED_URL` the app replays a
match from our own generator (`scripts/export_mock.py`, seed 7, EBW 4–3 SLT), with `xg` and
`pass_difficulty` from the server-side models. Messages: `hello`, `event`, `stats`, `clock`, `end`.
`src/stats/engine.ts` builds the stats object (possession, field tilt, PPDA 5′, xG, xT, passes,
progressive passes, difficulty, win probability, momentum, control/chaos, rhythm, pressure shift)
and records the source event ids for every number.

Off-ball player positions are inferred (formation slot shifted with the ball and the phase of
play) because the feed is events, not tracking data. The ball carrier is always at the event location.
