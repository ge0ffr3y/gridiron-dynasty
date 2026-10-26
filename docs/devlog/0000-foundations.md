# Devlog 0: Foundations

_Phase 0, October 2026_

The project exists. Nothing football happens yet; this phase builds the scaffolding everything else stands on.

## What was built

- **Repo and plan.** A private GitHub repo with the overview and an 18-phase roadmap.
- **Monorepo.** Six workspaces: `sim-core` (league logic), `game-engine` (play-by-play), `web` (the game), `runner` (headless sims), `pipeline` (real-league import), plus `rules/` for the league rules config.
- **Seeded randomness with named streams.** Every random outcome comes from one league seed, split into separate streams (schedule, games, injuries, draft, AI…). Drawing an extra injury roll never changes the schedule or a game. Tested: same seed gives the same numbers, streams don't affect each other, and saved states resume exactly.
- **Browser-proof math.** `exp`, `log`, and `pow` built only from basic arithmetic, because the built-in versions can round differently in Chrome and Safari. They match the built-ins to about one part in 10^14. A guardrail test fails the build if simulation code uses the built-ins, the real clock, `Math.random`, or browser or Node APIs.
- **Money as whole dollars.** Splitting a $10,000,001 bonus over three years gives pieces that add back to exactly $10,000,001.
- **App shell.** React + Tailwind + shadcn/ui, sidebar with the screens to come (each marked with the phase that builds it), light/dark theme.
- **Worker bridge.** The simulation runs in a background worker. On load, page and worker each draw numbers from seed 42 and compare: the panel shows "Sim worker: ready" and "page and worker agree".
- **CI** runs formatting, type checks, tests, and the build on every push.

## What's not done

- **Hosting.** The repo is private and GitHub Pages needs a public repo on the free plan. Decision pending: Vercel, or make the repo public.

---

[Index](README.md) · [1: A league to browse →](0001-league-skeleton.md)
