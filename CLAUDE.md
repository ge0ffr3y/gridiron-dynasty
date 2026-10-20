# FootballGM Sim: rules for the AI coding agent

A pro football league simulator and GM game. It starts from the real league as it stood after the 2025 season, with every name made fictional. Two modes share one engine: **GM Mode** (one team's decisions come from the user) and **Simulation Mode** (all 32 teams run by AI). Every game is simulated snap by snap.

The owner does not write code. Changes must be explainable in plain English and checkable by using the game, reading its stats pages, or reading the calibration scorecard.

Planning notes live in the owner's Obsidian vault: `Projects/FootballGM Sim Project/` (`01 - Overview`, `02 - Roadmap`, `03 - Devlog`). The roadmap defines the phases and each phase's "Done when" checks. `docs/overview.md` and `docs/roadmap.md` are snapshots of those notes; the vault is the source of truth.

## Hard rules

1. `packages/sim-core` and `packages/game-engine` never use browser APIs (no `window`, `document`, DOM, IndexedDB, `localStorage`) or Node-only imports. They must run unchanged in a browser, a Web Worker, and Node.
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
packages/sim-core/     league logic: rules, contracts, cap, AI, seeded RNG, dmath, money. No UI, no browser or Node APIs
packages/game-engine/  the play-by-play engine (separately testable and calibratable)
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
npm run sim -- --seed 42   headless runner
npm run pipeline     data pipeline (Phase 6)
```

## Tech notes

- TypeScript everywhere, npm workspaces. Packages are consumed as TypeScript source (no build step); imports have no file extension.
- The web app uses Tailwind v4 with shadcn/ui-style components in `apps/web/src/components/ui/` (`components.json` is set up, so `npx shadcn add <component>` works from `apps/web`). Colors come only from the theme tokens in `src/index.css`, which has light and dark sets.
- The page talks to the simulation only through the worker messages in `apps/web/src/sim/protocol.ts`.
