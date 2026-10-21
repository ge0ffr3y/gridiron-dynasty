# FootballGM Sim: rules for the AI coding agent

A pro football league simulator and GM game. It starts from the real league as it stood after the 2025 season, with every name made fictional. Two modes share one engine: **GM Mode** (one team's decisions come from the user) and **Simulation Mode** (all 32 teams run by AI). Every game is simulated snap by snap.

The owner does not write code. Changes must be explainable in plain English and checkable by using the game, reading its stats pages, or reading the calibration scorecard.

Planning notes live in the owner's Obsidian vault: `Projects/FootballGM Sim Project/` (`01 - Overview`, `02 - Roadmap`, `03 - Devlog`). The roadmap defines the phases and each phase's "Done when" checks. `docs/overview.md` and `docs/roadmap.md` are snapshots of those notes; the vault is the source of truth.

## Hard rules

1. `packages/foundation`, `packages/sim-core` and `packages/game-engine` never use browser APIs (no `window`, `document`, DOM, IndexedDB, `localStorage`) or Node-only imports. They must run unchanged in a browser, a Web Worker, and Node.
2. Never use `Math.random()`, `Date.now()`, `new Date()` or `performance.now()` in simulation logic. All randomness comes from the seeded `RngStreams` in `sim-core`; each area of the sim uses its own named stream (`RNG_STREAMS`) so new random draws in one area never reshuffle another.
   In the simulation packages, also avoid `Math.exp/log/pow/sin/cos/...` and the `**` operator: browsers may round them differently, so the same seed would play out differently in Chrome and Safari. Use `dmath` from `sim-core` (exact `+ - * /` underneath). `Math.sqrt`, `Math.floor`, `Math.round`, `Math.min/max/abs`, `Math.imul` are fine. `tests/guardrails.test.ts` enforces this.
3. League time is the in-game calendar, never the real clock.
4. **Rules as data.** Every league rule (salary cap, contract rules, roster limits, overtime, kickoffs, playoff format, tiebreakers) lives in the versioned config in `rules/`. Every tuning number lives in config. No magic numbers in logic. Exact NFL values are checked against the current CBA or rulebook in the phase that first uses them, never typed from memory.
5. **Money is whole dollars** (`Dollars` in `sim-core`), never floating point. Every cap or contract rule gets a unit test with a worked example.
6. **Determinism.** Same starting data + same seed + same decisions = same league history. Don't iterate over unordered structures in a way that changes results; don't depend on timing.
7. **Truth vs. perception.** Players' true ratings are never shown directly; screens read through the perception layer (what the team's staff believes).
8. **Everything has a reason.** AI decisions, contract demands, play calls, and player development record why they happened.
9. **The league stays legal.** Roster sizes and cap compliance are validated after every transaction; validators run in tests.
10. **No real names or trademarks** in committed code or data: no real player or coach names, no NFL team names, logos, or "championship game". Real cities are fine. Restricted source data (e.g. Madden ratings) stays in `pipeline/private/`, which is git-ignored. Never commit it.
11. Run `npm test` and `npm run typecheck` before every commit. Never commit with failing tests.
12. Prefer simple, readable code over clever code. Add a short comment explaining _why_ for anything non-obvious.

## Working style

- Work **one roadmap phase at a time**, each on its own git branch (`phase-1-league-skeleton`, etc.). Merge to `main` when the phase's "Done when" items are met.
- At the start of a phase, read this file and the phase's goals, then **propose a plan before writing code**.
- Explain changes in plain English for a non-programmer. Say what changed in the game's behavior, not just in the code. Say how to _see_ each result (which screen, which seed, which scorecard line).
- Commit small and often so any change can be rolled back.
- Calibrate with evidence: many seeds and many seasons, compared against the real-NFL targets. Report honestly when a "Done when" item is only partly met.
- At the end of each phase, write a devlog entry in `docs/devlog/` (what was built, what surprised us, what broke, one screenshot), append the same entry to the Obsidian note `03 - Devlog`, and tick the roadmap boxes in `02 - Roadmap` that were actually verified (then refresh the `docs/` snapshots).
- Never push, publish, or deploy without the owner's go-ahead.

## Layout

```
packages/foundation/   shared basics: seeded RNG, dmath, money, dates, positions and the rating model
packages/sim-core/     league logic: rules, data model, seasons, standings, AI. No UI, no browser or Node APIs
packages/game-engine/  the play-by-play engine (separately testable and calibratable); depends only on foundation
calibration/           real-NFL targets and fitted shapes (targets.json, built by the pipeline from nflverse)
apps/web/              the game: React + Tailwind + shadcn/ui; the sim runs in a Web Worker (src/sim/)
apps/runner/           Node CLI for headless calibration runs and experiments (tsx)
pipeline/              real-league import (Phase 6); pipeline/private/ and pipeline/cache/ are git-ignored
rules/                 versioned league rules config (one file per season)
tests/                 repo-wide guardrail tests
docs/                  overview and roadmap snapshots, devlog
```

## Commands

```
npm install          install everything
npm test             run all tests (vitest)
npm run typecheck    type-check every workspace
npm run format       format with Prettier (npm run format:check in CI)
npm run dev          start the web app locally
npm run build        production build of the web app
npm run sim -- --new-league --seed 42 [--out league.json]   generate a league, print a summary
npm run sim -- --seasons 100 --seed 7     simulate seasons; validates every schedule; prints champions and scoring
npm run pipeline -- calibration   rebuild calibration/targets.json from nflverse play-by-play (downloads ~80 MB once)
npm run pipeline -- matchups      rebuild calibration/matchups.json and charting.json (formations, coverages, penalties, expected points)
npm run pipeline -- people        rebuild calibration/people.json (snap shares, injuries, leaderboards, EPA)
npm run pipeline -- situations    rebuild calibration/situations.json (win probability, 4th downs, clock, replay)
npm run pipeline -- elements      rebuild calibration/elements.json (stadiums, city climates, weather effects, kickoffs, punts)
npm run pipeline -- league        build the real league into pipeline/private/out/ (needs the private Madden file; never committed)
npm run sim -- --calibrate [--leagues 4 --seasons 2 --seed 42]   scorecard: league stats and player-level stats vs. real NFL ranges
```

## Tech notes

- TypeScript everywhere, npm workspaces. Packages are consumed as TypeScript source (no build step); imports have no file extension.
- The web app uses Tailwind v4 with shadcn/ui-style components in `apps/web/src/components/ui/` (`components.json` is set up, so `npx shadcn add <component>` works from `apps/web`). Colors come only from the theme tokens in `src/index.css`, which has light and dark sets.
- The page talks to the simulation only through the worker messages in `apps/web/src/sim/protocol.ts`. The worker owns the open league, saves it to IndexedDB (Dexie, `sim/db.ts`), and answers screen requests with data from `sim-core/src/views.ts`. Add a screen by adding a view function in sim-core, a method in `protocol.ts`, and a handler in `sim.worker.ts`.
- **League data model** (`sim-core/src/league/schema.ts`): zod schemas; TypeScript types are inferred from them and the same schemas validate imported files. A league is plain JSON (no classes). `serializeLeague()` sorts keys, so the same league is always byte-identical; `fingerprint()` hashes the file text and is shown on screen. Changing the schema in a way old files can't load means bumping `LEAGUE_FORMAT_VERSION`.
- **Rules** (`rules/2026.json`, loaded by `sim-core/src/rules.ts`): every block carries a `source` note saying where the numbers came from.
- **Ratings** (`sim-core/src/players/`): 28 attributes (0-100, our own scale), position overall = weighted average shifted so an average starter shows 75 everywhere. Weights, physical profiles, and sizes are config in `positions.ts`; generation tuning is in `generate/config.ts`.
- **Perception** (`sim-core/src/perception.ts`): screens get ratings only via `perceivePlayer()`; a guardrail test fails if `apps/web/src` touches `.ratings`, `.hidden`, or `.personality`.
- **Decisions** (`sim-core/src/decisions.ts`): `askTeam()` routes each team decision to the AI (answers with a reason) or queues it for the human (`pendingDecisions`). Add a decision kind by extending `DecisionRequestSchema` and `AI_POLICIES`.
- **Seasons** (`sim-core/src/season/`): `flow.ts` moves the calendar one step at a time (`advance`), `actions.ts` maps the sim buttons onto it, `schedule.ts` builds the 272-game schedule (formula from the rotation tables in the rules, then a seeded week search; `validate.ts` checks every rule), `standings.ts` + `tiebreakers.ts` + `seeding.ts` implement the official NFL tie-breaking procedures (each step records a reason), `playoffs.ts` the 7-team bracket with reseeding, `draftOrder.ts` the draft order with tied clubs rotating each round. Games are placeholder scores (`placeholderGame.ts`) until the Phase 3 engine replaces `playGames()` in `flow.ts`.
- Coin tosses in tiebreakers hash the league seed, season, and clubs instead of drawing random numbers, so computing standings (any number of times) never changes the future. Keep anything a screen can trigger free of RNG draws.
- A new fictional league plays a placeholder 2025 season at creation, so 2026 has real standings for the schedule, same-place games, draft order, and History. The first league day is the day after that championship (Feb 9, 2026).
- League saves carry `formatVersion` (now 6). Saves from format 2 on are upgraded automatically (`upgrade()` in `serialize.ts`); older ones are refused with a plain-English message. Add an upgrade step whenever a change should keep old saves working.
- Team identities and conference names are placeholders (`generate/teams.ts`, rules file) until the Phase 6 naming session; none may be a real pro team's nickname.
- **Package layering:** `foundation` ← `game-engine` ← `sim-core` ← apps. The engine never imports sim-core; sim-core builds lineups and calls `simulateGame()`. Shared types the league stores (box score, stat lines) are defined in the engine, and sim-core's zod schemas are checked against them at compile time.
- **The game engine** (`packages/game-engine/src/`): `engine.ts` runs a game snap by snap; `playcall.ts` is the tendency-table play caller; `units.ts` turns a lineup into unit strengths; `boxscore.ts` builds stats from the play list; `calibrate.ts` measures seasons for the scorecard. Real-NFL shapes (yardage quantiles, completion by depth, kicking) come from `calibration/targets.json` (`REAL` in `config.ts`); the engine's own knobs are in `TUNING`. When tuning, change one knob at a time and judge by `npm run sim -- --calibrate` across several seeds, never one season.
- Nudging a random draw: use `shiftedUniform()` (log-odds shift). Never add to a uniform number and clamp it: that piles draws onto the extreme value and, with a tail, produces 200-yard plays (Phase 3 found this the hard way).
- Every game has its own seed (`gameSeed()` in `season/flow.ts`), so games don't depend on play order. Season stat totals count regular-season games only; playoff box scores stay on the games.
- Play-by-play is NOT in the league file: the worker stores it in the `playLogs` IndexedDB table for the current and previous season (`apps/web/src/sim/db.ts`), and `gameView()` renders it as text. Box scores and stats are in the league file.
- `tests/calibration.test.ts` keeps the core stats inside the real ranges in CI; if a change breaks it, run the scorecard.
- **Who plays (Phase 4b).** Teams carry a depth chart (`team.depthChart`: automatic, or a custom order per spot). `season/depthChart.ts` builds it (best overall at each spot, counting second positions via `familiarity`) and hands the engine a `DepthChart` with injured players left off. Inside a game, `game-engine/src/sideline.ts` picks who is on the field before each snap: tired players (energy drains per snap, by stamina) give way to the next man, and players hurt during the game leave. Fatigue drains and injury rates are in `TUNING.fatigue` / `TUNING.injuries`; the real targets are in `calibration/people.json`.
- **Injuries between games** (`season/injuries.ts`): a player who doesn't return to the game he was hurt in misses a number of his team's games drawn from the real distribution; `player.injury.gamesRemaining` counts down after each team game, and everyone heals at the new league year (the full injury model is Phase 9).
- **EPA** (`game-engine/src/epa.ts`): every run and dropback gets expected points added from the expected-points table in `calibration/matchups.json`, with nflverse's conventions (touchdown 7, safety -2, half end 0). The pipeline measures the real targets with the same table so the two compare fairly.
- **Game management (Phase 5a).** `winprob.ts` is a logistic win-probability model fitted to real outcomes (weights in `calibration/situations.json`); every snap stores the home team's chance as `play.wp`. `decisions.ts` makes 4th-down and 2-point calls by comparing each option's win probability (the analytics baseline), then applies real coaches' caution and the team's `gameStyle` (aggressiveness, 2-point aggressiveness, adaptability; 0.5 = typical, set by coaches from Phase 10). Notes on plays explain each call. `review.ts` handles close calls, booth reviews and coach challenges. Halftime adjustments and a momentum knob (zero by default) live in `TUNING.adjustments` / `TUNING.momentum`. Situational scorecard ranges are widened to two standard errors of one season's sampling noise (`targetsNote` in `situations.json`).
- **Special teams and the elements (Phase 5b).** Kickoffs follow the 2026 dynamic-kickoff rules in `rules/2026.json` (`game.kickoff`): the real 2025 mix of touchbacks, landing-zone kicks, short and out-of-bounds kicks, moved by the kicker's leg, wind and altitude; returns pit the returner's speed against the kicking team's coverage. Onside kicks are rule-based (trailing by at most `onsideMaxDeficit` late in the 4th quarter or overtime), at the real recovery rate. Punts pin near midfield, and muffs, blocked punts and field goals, and fakes happen at real rates (`TUNING.specialTeams`, `calibration/elements.json`). Each team has a `stadium` (roof, surface, elevation; no names). `sim-core/src/season/weather.ts` draws each game's weather from the home city's climate for that week with the game's own seed, stores it on the game, and passes `conditions` to the engine; `game-engine/src/weather.ts` turns them into effects measured from real games, relative to the average real conditions (the engine's base tables already include average weather). Dome vs. cold-or-windy lines are "info" on the scorecard: real teams in cold cities differ in quality, so they aren't pass/fail.
- **Play and watch.** `playGameNow()` in `season/flow.ts` plays one of this week's games early (the week's sim skips games already played); results match simming the whole week because games, weather and injuries have their own seeds and depth charts are set per team. The web app's `/game/:id/watch` replays a game's play-by-play live (`components/LiveTicker.tsx`).
- **The real league (Phase 6).** `npm run pipeline -- league` (`pipeline/src/league/`) builds the starting league from nflverse end-of-2025 rosters, bios, snap counts and scores, the end-of-2025 coaching staffs (`pipeline/private/coaches-2025.csv`, collected from public team season pages), and the private Madden ratings file (`pipeline/private/madden/ratings-2025.csv`). Madden attributes are mixed into ours (`MADDEN_MAP` in `madden.ts`), then moved onto our scale per position so real starters match the starters of our generated leagues (`ratings.ts`); players Madden lacks get ratings around a target from their 2025 role and draft slot. Names come from a hash of each person's id (`names.ts`) and are redrawn if they match any real player or coach; colleges map to fictional schools. `sim-core/src/realLeague.ts` (`assembleRealLeague`) turns those facts into a league, runs the real 2025 season through the normal standings and draft-order code, and starts 2026; `startRealLeague` makes each new game from the file with its own name and seed. Outputs live in `pipeline/private/out/` (league file and a private report with real names), plus a copy in `apps/web/public/private/` that the New League dialog loads; both are git-ignored. `tests/realLeague.test.ts` checks the build and skips where the private files are missing (CI).
- Calibration data lives in `calibration/` and is rebuilt by `npm run pipeline -- calibration` or `-- matchups`; every engine tuning number is in `packages/game-engine/src/config.ts` (`TUNING`). `calibration/charting.json` is derived from FTN charting data (CC-BY-SA-4.0): numbers from that source go only in that file, never into another committed file.
