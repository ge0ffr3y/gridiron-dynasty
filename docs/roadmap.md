# FootballGM Sim — Roadmap

Back to: [Overview](overview.md)

> [!TIP]
> **How to use this roadmap**
> - Work **one phase at a time**, each on its own git branch. Merge, deploy, tag (when marked), then start the next.
> - Every phase ends with **"Done when"** checks you can verify by using the game, reading its stats pages, or reading a calibration scorecard, not by reading code.
> - Each phase has a **kickoff prompt** to paste into Claude Code. Always start by asking it to read `CLAUDE.md` and this phase's goals, then propose a plan *before* writing code.
> - After each phase: write a devlog entry (repo `docs/devlog/` + the Obsidian `03 - Devlog` note) and tick the boxes here.
> - Exact NFL numbers (roster sizes, cap figures, kickoff spots, overtime rules…) are **never typed into code**. They go into the rules config and get checked against the current CBA / rulebook in the phase that needs them.

## The big idea behind the order

1. **Build the league's skeleton on a generated fictional league first** (Phases 1–2). Fast to iterate, no data headaches, and it doubles as the "fully fictional league" alternative start.
2. **Build the football engine next** (Phases 3–5), calibrated against real NFL play-by-play from the start. Everything else depends on games feeling real.
3. **Bring in the real league** (Phase 6), then layer on the front office one system at a time (Phases 7–12), each with simple AI so the league keeps running.
4. **Make the AI smart** (Phase 13) → Simulation Mode is complete. **Wrap a career around one team** (Phase 14) → GM Mode is complete.
5. **History, the exact real Day One, experiments, ship** (Phases 15–18).

Every phase adds its own screens, so there's always something to click through.

## Phase overview

| # | Phase | Key outcome | Size | Release |
|---|---|---|---|---|
| 0 | Foundations | Repo, tooling, CI, live app shell | S | — |
| 1 | League skeleton & generated league | Browse a full fictional league; save/load | M | — |
| 2 | Seasons, schedules & standings | NFL schedule formula, tiebreakers, playoffs (placeholder scores) | M | — |
| 3 | Game engine I: core football | Snap-by-snap games, box scores, play-by-play, first calibration | L | — |
| 4 | Game engine II: matchups & concepts | Formations, coverages, player-vs-player resolution, advanced stats | XL | ✅ **v0.1** |
| 5 | Game engine III: game management & elements | Special teams, clock, 4th downs, weather, situational calibration | L | ✅ **v0.2** |
| 6 | Real-league import I: people & ratings | Real 2025 rosters, ratings, coaches, all renamed | L | — |
| 7 | Contracts & the salary cap | Full cap engine; real contracts; team cap sheets match reality | XL | — |
| 8 | Roster rules, transactions & calendar | Full league year, waivers, practice squad, IR, trades | L | — |
| 9 | Player lifecycle | Development, aging, injuries, retirement | L | — |
| 10 | Coaches & staff | Philosophies, AI play callers, scheme fit, coaching carousel | L | — |
| 11 | Scouting & the draft | True vs. scouted ratings, draft classes, draft room | L | — |
| 12 | Free agency, negotiation & chemistry | Agents, market values, bidding, holdouts, morale | L | — |
| 13 | AI general managers & owners | Distinct AI front offices; exploit-resistant trade AI | XL | ✅ **v0.3** (Simulation Mode) |
| 14 | GM Mode career layer | Owner, job security, inbox, autopilot, getting fired | M | ✅ **v0.4** (GM Mode) |
| 15 | League history & storytelling | Real history, awards, records, Hall of Fame, newsfeed | L | — |
| 16 | Day One: the real 2026 start | Exact starting state the day after the 2025 championship game, fully validated | M | ✅ **v0.5** |
| 17 | Experiments & analytics | 1,000 alternate 2026 seasons; strategy experiments | M | — |
| 18 | Ship it | Licensing resolved, polish, performance, write-ups | M | ✅ **v1.0** |
| ★ | Stretch goals | 2D play viewer, hot-seat multiplayer, rules editor… | — | — |

**Ongoing tracks (every phase):** calibration scorecard stays green, determinism and invariant tests, performance budget, devlog, no real names or trademarks in anything committed.

---

## Decisions log

Decisions that block a phase. Record the answer here when made.

| Decision | Needed by | Answer |
|---|---|---|
| GitHub repo name, visibility, license | Phase 0 | `ge0ffr3y/footballgm-sim`, private for now; license when public |
| Hosting: GitHub Pages or Vercel | Phase 0 | Deferred: no hosting while private; set up when the repo goes public |
| Working title / app name | Phase 0 (placeholder ok) | "FootballGM Sim" as placeholder (rename before going public: "Football GM" is ZenGM's game) |
| League name, championship name, 32 team names, mascots, colors | Phase 6 | Deferred by the owner (Phase 6 planning): placeholder names stay; the naming session happens later |
| Is the generated real-league file published in the public repo, or built locally only? | Phase 6 | Built locally only (git-ignored), rebuilt by `npm run pipeline -- league`; revisit when the repo goes public (decided in Phase 6) |
| Real college names for prospects, or fictional schools? | Phase 11 | Fictional schools, the same mapping as players' colleges; each school has a scouting region (decided in Phase 11a) |
| Can more than one team be human-controlled? | Phase 14 | One person-run team for now. The owner has a long-range vision of multiplayer (see Stretch goals); decisions, delegation and the inbox are keyed by team so it stays possible (decided in Phase 14) |
| How far back imported history goes (since 1920 vs. championship era + all-time record books) | Phase 15 | The league's story from the first championship game (the 1966 season) on: champions, standings, awards, the Hall of Fame. Full player stats only from 1999 (what nflverse has); before that, only what still stands: league and franchise records (game, season, career) and award, All-Pro and Hall of Fame names. Owners read only the last ten real seasons; deeper history is for reading (decided in Phase 15) |
| Fully fictional league as an alternative start? | Phase 1 | *Effectively yes: it's how we build Phases 1–5* (built in Phase 1) |
| Release v0.1 timing | Phase 4 | When the repo goes public: README with screenshots, GitHub Pages deploy and the v0.1 tag together (decided after Phase 4b) |
| Real contract data (OverTheCap, directly or via nflverse): how to use it | Phase 7 | Treated as private like the Madden file: archived cap pages and contract data stay in `pipeline/private/` and `pipeline/cache/`; only derived numbers reach the local league file, and only the fitted rookie scale (shares of the cap) is committed. Revisit with the public release (decided in Phase 7) |
| Data licensing approach for the public release | Phase 18 (guardrails from Phase 6) | MIT for the code; only numbers derived from open sources are committed (`calibration/`); the real-league file and its private inputs (ratings, contracts, archived pages) are never published; nflverse CC-BY-4.0 and FTN CC-BY-SA-4.0 credited in `NOTICE.md`, `docs/data-sources.md` and the About page; a CI sweep hashes real names and nicknames (decided in Phase 18; not legal advice) |

---

## Phase 0 — Foundations

**Goal:** A working project skeleton deployed to the web, with the guardrails in place before any league code exists.

### Steps
- [x] Decide repo name, visibility, and license; create the GitHub repo *(ge0ffr3y/footballgm-sim, private for now; license chosen when it goes public)*
- [x] Scaffold the monorepo (npm workspaces): `packages/sim-core`, `packages/game-engine`, `apps/web`, `apps/runner`, `pipeline/`, `rules/`, `docs/`
- [x] `apps/web`: Vite + React + TypeScript + Tailwind + shadcn/ui, with a basic app shell (sidebar nav, header, light/dark theme)
- [ ] TypeScript strict mode, ESLint, Prettier across all packages *(strict TS and Prettier done; ESLint left out: typescript-eslint doesn't support TypeScript 7 yet, and the guardrail test already enforces the simulation bans)*
- [x] Vitest with one trivial passing test per package
- [x] **Seeded RNG** in `sim-core` with **named streams** (schedule, game, injuries, AI…) so adding a feature in one area doesn't reshuffle every other random outcome; test: same seed → same numbers
- [x] **Deterministic math helpers** (exp, log, pow…) and a lint rule banning `Math.random`, `Date.now`, and raw transcendental `Math.*` calls inside `sim-core` and `game-engine` (lesson carried over from Evolution Sim: those can differ across browsers) *(the ban is a guardrail test, as in Evolution Sim)*
- [x] **Money type:** all money stored as whole dollars (integers), never floating point
- [x] **Web Worker bridge:** the UI talks to the simulation only through a worker (hello-world round trip)
- [x] Write `CLAUDE.md` (rules below)
- [x] GitHub Action: typecheck, lint, test, build on every push *(format check stands in for lint)*
- [ ] Auto-deploy `apps/web` (GitHub Pages or Vercel) *(deferred until the repo goes public, then GitHub Pages; Phase 0 merged to main without it)*
- [x] Create `docs/devlog/` with entry #0, and the Obsidian `03 - Devlog` note

### `CLAUDE.md` rules to include
- `sim-core` and `game-engine` never import browser APIs (no `window`, `document`, DOM, IndexedDB).
- Never use `Math.random()` or `Date.now()` in simulation logic. Use the seeded RNG streams. Use the shared math helpers for exp/log/pow.
- League time is the in-game calendar, never the real clock.
- **Rules as data:** every league rule (cap, roster limits, overtime, kickoffs, playoff format, tiebreakers) lives in the versioned `rules/` config. Every tuning number lives in config. Nothing hard-coded.
- **Money is integers** (whole dollars). Every cap or contract rule gets a unit test with a worked example.
- **Everything has a reason:** every AI decision, contract demand, and play call records why.
- **No real names or trademarks** in committed code or data: no real player/coach names, no NFL team names, logos, or the league's trademarked championship name. Restricted source data stays in `pipeline/private/` (gitignored).
- The league must stay **legal** after every action (roster sizes, cap compliance); validators run in tests.
- Run tests before every commit; never commit with failing tests.
- Explain changes in plain English for a non-programmer. Prefer simple, readable code over clever code.

### Done when
- [ ] The live URL shows the app shell *(deferred with hosting; verified locally)* titled "FootballGM Sim" with a light/dark toggle
- [x] The page shows "Sim worker: ready" (the worker round trip works)
- [x] CI is green on GitHub
- [x] The RNG determinism test passes

<details>
<summary>Kickoff prompt</summary>

"We're starting FootballGM Sim, a pro football GM game and league simulator in TypeScript. Read the attached overview and roadmap. Phase 0: set up the npm-workspaces monorepo from the roadmap (sim-core, game-engine, web, runner, pipeline, rules, docs), the React + Tailwind + shadcn app shell, Vitest, a seeded RNG with named streams and a determinism test, deterministic math helpers with a lint ban on Math.random/Date.now, an integer money type, a Web Worker hello-world, CI, and deployment. Write CLAUDE.md with the roadmap's rules. Propose a plan first, then build step by step, explaining each step in plain English."

</details>

---

## Phase 1 — League skeleton & a generated league

**Goal:** A complete fictional league you can browse: 32 teams, ~2,800 players (90-man offseason rosters), coaches, all generated, saved in the browser.

### Steps
- [x] **Data model:** League, Season, Conference, Division, Team, Player, Coach, Staff, Contract (stub), DraftPick, Transaction
- [x] **Positions:** every NFL position (QB, RB, FB, WR, TE, OT, OG, C, EDGE, DT, LB, CB, S, K, P, LS, plus return roles) with **position flexibility** (e.g., a guard who can play center)
- [x] **Rating model v1:** our own physical / technical / mental attributes and scale; position-specific overall formulas
- [x] **Truth vs. perception layer:** ratings are stored as truth, but every screen reads through a "what your staff believes" layer (perfectly accurate for now, so scouting plugs in later without rewiring)
- [x] **Hidden traits & personality fields** (potential, work ethic, consistency, injury proneness, durability, coachability, clutch; ego, loyalty, leadership, priorities, temperament), generated now, used in later phases
- [x] **Player generator:** realistic size / speed / age / experience distributions by position
- [x] **Coach generator** with placeholder attributes
- [x] **Fictional name generator** (no duplicates within a league; later checked against a real-name blocklist)
- [x] Placeholder team identities: 32 real cities in the real conference/division alignment, placeholder names
- [x] **Rules config v1** (`rules/2026.json`) with schema validation (zod): league structure, roster limits; loaded and validated at startup
- [x] **Decision-maker interface:** every team decision goes through a "decider" that can be AI or Human. This is how "one engine, two modes" works; stubbed for now
- [x] Transaction / event log skeleton
- [x] **Save/load:** leagues stored in IndexedDB (Dexie); export/import a compressed league file; round-trip test
- [x] **UI:** New League dialog, league home, teams list, team page (roster table with TanStack Table: sort, filter), player page, coach page

### Done when
- [x] "New League" creates a full fictional league in a few seconds *(about 0.2 s including saving)*
- [x] You can browse every roster, sort by position or rating, and open any player or coach
- [x] Reloading the browser keeps the league; export → import gives the same league *(import checked through the worker with the same fingerprint; the browser download itself not clicked)*
- [x] Same seed → byte-identical league file (test)

<details>
<summary>Kickoff prompt</summary>

"Phase 1: build the league skeleton and a generated fictional league as described in the roadmap. Keep all league logic in sim-core. Ratings must be stored as truth and read through a perception layer. Add the rules config v1 with schema validation, the AI/Human decision-maker interface stub, IndexedDB save/load with export/import, and the browse screens. Plan first."

</details>

---

## Phase 2 — Seasons, schedules & standings

**Goal:** Sim complete seasons with placeholder scores: real NFL schedule formula, standings, every tiebreaker, and the 14-team playoff.

### Steps
- [x] **League calendar state machine:** offseason stages (stubs for now), preseason, regular-season weeks 1–18, playoff rounds, championship; an "advance" action moves through it
- [x] **Schedule formula:** division home-and-away, rotating same-conference division, rotating other-conference division, two same-place games, the 17th game vs. an other-conference same-place finisher; rotation tables in rules config
- [x] **Week assignment:** 17 games in 18 weeks, one bye per team inside the bye window, no conflicts; home/away balance (constraint solver)
- [x] **Schedule validator** test that checks every formula rule
- [x] **Placeholder game result:** team strength + home field + randomness → final score (replaced in Phase 3)
- [x] **Standings:** W-L-T, win %, division / conference / common-game records, points for/against, streaks, strength of victory and schedule
- [x] **Full NFL tiebreaker procedures** (two-club and three-plus-club, division, wild card, and draft order), coin toss via RNG; tests built from the NFL's published worked examples *(the NFL publishes none; built from hand-made scenarios, one per step; the coin toss is a fixed hash of the seed, season, and clubs rather than a random draw, so viewing standings never changes the future)*
- [x] **Playoffs:** 7 seeds per conference, top-seed bye, reseeding, neutral-site championship
- [x] **Draft order** from final standings and playoff exits
- [x] **Sim controls** (in the worker, with progress): sim one week, to the trade deadline, to end of regular season, through the playoffs, full season
- [x] **Season rollover:** archive the season, age everyone a year (placeholder), build next season's schedule from new standings
- [x] **UI:** schedule & results, standings (division / conference / league), playoff picture during the season, playoff bracket, list of past champions
- [x] **Headless runner v1:** `npm run sim -- --seasons 10 --seed 42`

### Done when
- [x] Every team plays 17 games in 18 weeks with one bye, and the validator passes for 20 straight generated seasons *(100 straight in the runner)*
- [x] Every tiebreaker worked-example test passes
- [x] The standings and bracket look right after a full season
- [x] 100 seasons (placeholder scores) run headless in under a minute *(7.8 s)*

<details>
<summary>Kickoff prompt</summary>

"Phase 2: implement the league calendar state machine, the NFL scheduling formula with a validator, standings, the full tiebreaker procedures with tests from the NFL's published examples, the 7-seed playoff, draft order, sim controls in the worker, season rollover, the schedule/standings/bracket screens, and headless runner v1. Game results are a placeholder strength-based score for now. Plan first."

</details>

---

## Phase 3 — Game engine I: core football

**Goal:** Replace placeholder scores with real snap-by-snap games that already produce believable basic stats.

### Steps
- [x] **Game state:** quarter, clock, down, distance, ball spot, possession, score, timeouts, play log
- [x] **Play types v1:** inside run, outside run, short / medium / deep pass, punt, field goal, extra point, 2-point try, kneel, spike
- [x] **Play-calling v1:** a tendency table by down, distance, field position, score, and time (later owned by coordinators in Phase 10)
- [x] **Resolution v1:** team-unit strengths (run blocking, pass protection, pass rush, coverage…) → outcome distributions: yards, completions, sacks, interceptions, fumbles
- [x] **Clock rules:** running vs. stopped clock, two-minute warning, end of half / game, from rules config
- [x] **Scoring:** touchdowns, field goals, safeties, extra points, 2-point conversions
- [x] Basic kickoffs and punts; overtime per rules config
- [x] **Player credit:** every play credits a passer / rusher / receiver / tackler
- [x] **Box score and play-by-play text** (e.g., "2nd & 7 at SEA 34 — pass short right to #81 for 12 yards")
- [x] **Stats:** player game / season / career stats; team stats *(season totals are regular season only; playoff stats stay in box scores for now)*
- [x] **Calibration targets v1:** pipeline script downloads nflverse play-by-play (recent seasons), computes league averages (points, plays, yards per play, completion %, sack rate, interception rate, run/pass split, punts, FG %), saves them as a targets file (these are facts; safe to commit)
- [x] **Calibration harness v1:** the runner sims N seasons and prints a **scorecard**: sim vs. real, with a pass/fail range for each stat
- [x] Engine tests: determinism, score equals the sum of scoring plays, clock never negative, downs and distance always valid
- [x] **UI:** game page with box score and scrollable play-by-play; scores link to games

### Done when
- [x] Reading a play-by-play feels like real football
- [x] The scorecard's core stats (points per game, yards per play, completion %, sack rate, turnovers) land inside real NFL ranges *(all 26 scorecard stats inside, across three independent sets of leagues)*
- [x] A full 272-game season sims in under 10 seconds *(about 0.25 s headless; 0.6 s in the browser including saving)*
- [x] Same seed → identical game, play for play

<details>
<summary>Kickoff prompt</summary>

"Phase 3: build game-engine v1 as a separate package: game state, core play types, a tendency-table play caller, unit-strength resolution, clock and scoring rules from the rules config, player credit, box scores, play-by-play text, and stats. Add a pipeline script that computes real NFL calibration targets from nflverse play-by-play, and a runner scorecard comparing sim vs. real. Plan first."

</details>

---

## Phase 4 — Game engine II: matchups & play concepts

**Goal:** Games are decided by real football concepts and individual player matchups, so better players and smarter calls visibly matter.

### Steps
- [ ] **Offense:** personnel groupings (11, 12, 21, 10…), formations; run schemes (inside zone, outside zone, power, counter, duo, draw), pass concepts (quick game, dropback, play-action, screens, RPOs, deep shots) *(4a: personnel, formations, run gaps, play-action, screens, RPOs, sneaks and short/medium/deep throws at real rates; named run schemes not yet)*
- [ ] **Defense:** personnel (base, nickel, dime), fronts, coverage shells (Cover 0/1/2/3/4/6, man vs. zone), blitz packages *(4a: packages, box counts, coverage shells, man/zone and 3–7 rushers; named fronts not yet)*
- [x] **Line play:** individual pass-rush vs. pass-protection wins → time to pressure, pressures, sacks; run blocking → lane quality → yards before contact *(yards before/after contact as a stat comes with 4b's advanced stats)*
- [x] **Receivers vs. defenders:** separation by route and coverage for each target
- [x] **Quarterback:** progression reads, decision (throw, check-down, throwaway, scramble), accuracy and ball placement
- [x] **After the throw:** catch probability, contested catches, drops, yards after catch, broken and missed tackles *(contested catches are folded into catch vs. breakup odds)*
- [x] **Turnovers** driven by decisions, accuracy, coverage, ball security, and hit power
- [x] **Penalties:** pre-snap and during the play, accept/decline logic, realistic rates *(21 types; 5.8–5.9 accepted per team-game vs. 6.02 real)*
- [x] **In-game injuries** (simple severity for now; full model in Phase 9) *(real per-snap rates by position; real games-missed distribution; 1.5 per team-game vs. 1.66 real, in range)*
- [x] **Fatigue & substitution:** snap shares, defensive line rotations, running back committees *(15 of 16 compared snap shares in range; the third receiver plays 66% vs. 56%)*
- [x] **Depth chart:** auto-built from ratings, editable by the user; position flexibility covers injuries
- [x] **Expanded stats:** targets, air yards, pressures, pass breakups, missed tackles, snap counts
- [ ] **Advanced stats:** expected points model built from nflverse data; EPA, success rate, pressure rate, yards after contact *(4b: EP table, EPA, success rate and pressure rate done, EPA in range; success rate 1.5 points low (situational runs, Phase 5); yards after contact not yet)*
- [ ] **Calibration v2:** position-level distributions (passing / rushing / receiving / sack leaders, passer rating spread, team point-differential spread) *(4b: player-level scorecard added, 32-40 of 48 lines in range; passing leaders too bunched until play-calling styles (Phase 10) and QB benchings (Phase 13))*
- [x] **UI:** depth chart editor, league leaders, team and player advanced stats
- [ ] **🚀 Release v0.1:** deploy, README with screenshots, tag *(tagged v0.1 and the README is done in Phase 18; the deploy waits for Pages, so this stays open)*

### Done when
- [x] Swapping an elite QB onto a bad team noticeably raises its scoring (in a test sim) *(+4.1 points a game over 300 games)*
- [ ] Season leaderboards look like a real NFL season (yardage leaders, sack leaders, interception leaders in real ranges) *(partly: rushing, receiving, sack and interception leaders mostly in range; passing leaders too bunched)*
- [x] A blitz-heavy defense produces more sacks *and* gives up more big plays *(test in CI)*
- [ ] Scorecard green for core and position-level stats *(core and all Phase 3-4a league stats green on three seed sets; success rate and some player-level lines not yet)*

<details>
<summary>Kickoff prompt</summary>

"Phase 4: deepen the game engine with personnel, formations, run and pass concepts, defensive fronts/coverages/blitzes, and individual matchup resolution (line play, separation, QB decisions, catch/YAC/tackling, turnovers, penalties, fatigue). Add the depth chart, expanded and advanced stats (EPA from an nflverse-based expected points model), and position-level calibration. Keep everything tunable from config. Plan first."

</details>

---

## Phase 5 — Game engine III: game management, special teams & the elements

**Goal:** Late-game situations, special teams, and weather all behave like the real thing, and situational stats match the real NFL.

### Steps
- [x] **Special teams under the current rules** (kickoff format, touchback spots, onside rules, fair catches, all from rules config): distance and hang time, returns, coverage, blocks, muffs, fakes *(5b: 2026 dynamic-kickoff rules checked against the rulebook; kickoff mix, onside kicks, returns vs. coverage, fair catches, pinning, blocks, muffs and fakes at real rates; hang time isn't modeled separately: punt distance comes from the leg and the wind)*
- [x] **Kicking:** range and accuracy by distance and weather; punter gross and net *(5b: FG % by distance and weather, gross 47.2-47.5 and net 41.6-41.8 vs. real 47.3 / 41.7)*
- [x] **Win probability model** (from nflverse data), used by game management and shown in the UI *(own logistic fit; as accurate as nflverse's model on real games)*
- [x] **Decision models:** 4th down (go / punt / kick), 2-point tries, driven by a coach-aggressiveness parameter around an analytics baseline
- [x] **Clock management:** hurry-up, two-minute drill, kneel-downs, milking the clock, timeouts on both sides, spikes, challenges and replay review
- [x] **Environment:** stadium table (dome / outdoor / retractable, surface, altitude), weather generated by city and week (temperature, wind, rain, snow) with effects on passing, kicking, and fumbles *(5b: effects fitted on 2022-25 games; saves are format 6)*
- [x] **Home-field advantage** (including crowd-noise false starts) *(real 2022-25 data shows no crowd-noise effect on false starts, so none is modeled; the general home edge keeps the home win rate in range)*
- [x] **In-game adjustments:** halftime adjustments and coordinators adapting to what's working; momentum kept small and tunable (can be set to zero) *(momentum defaults to zero)*
- [x] **Situational calibration:** pass rate by down and distance, 4th-down go rates by field zone, 2-point rates, kickoff touchback and return rates, FG % by distance, end-of-half scoring *(5b: kickoff touchbacks, onside attempts and recoveries, punt gross and net added, all in range on three seed sets; return rates follow from the real kickoff mix)*
- [x] **Performance pass:** profile and optimize; a full season in a few seconds *(5b: 1.5 s in the browser including saving, 1.4 s headless; a speed guard runs in the tests)*
- [x] **UI:** drive chart, win-probability chart, scoring summary, "watch live" text ticker with speed control *(5b: live ticker with pause, 1x, 4x and skip; "Play and watch" plays one of this week's games early with an identical result)*
- [x] **🚀 Release v0.2** *(tagged v0.2 in Phase 18; the hosted demo waits for Pages)*

### Done when
- [ ] Scorecard green, including the situational targets *(5b: 62, 62, 60 of 63 on three seed sets, every special-teams line in range; misses: success rate a few tenths low on two, EPA high on seed set 42, one interception and one 4th-down line just outside on seed set 2000)*
- [x] Late-game behavior looks right in play-by-play: kneel-downs, timeouts, two-minute drives, onside kicks when trailing *(onside kicks only from teams trailing late, about 0.09 a team game vs. real 0.10; test in CI. Watching live caught a 4th-down kneel with time left, now fixed)*
- [x] Cold, windy outdoor games score less and miss more kicks than dome games *(same teams and seeds, 400 games: dome 23.2 points and 86.3% FGs, 22°F with 18 mph wind 21.1 points and 79.7%; test in CI)*
- [x] A full season sims in under 5 seconds *(1.5 s in the browser)*

<details>
<summary>Kickoff prompt</summary>

"Phase 5: add special teams under the current rules, a win-probability model, 4th-down and 2-point decision models, full clock management, stadiums and weather, home-field advantage, and in-game adjustments. Extend calibration to situational stats and hit the performance target. Add drive and win-probability charts and a live ticker. Plan first."

</details>

---

## Phase 6 — Real-league import I: people, ratings & names

**Goal:** Start a league from the real NFL as it stood at the end of the 2025 season, with every person renamed.

### Steps
- [x] **Licensing guardrails first:** `pipeline/private/` (gitignored) holds Madden ratings and anything with restrictive terms; `docs/data-sources.md` lists every source, its license, and credits *(6a: plus a local test that no committed file contains a real 2025 player's or coach's name)*
- [x] Decide whether the generated real-league file is committed publicly or built locally only (Decisions log) *(built locally only)*
- [x] **Pipeline framework:** download → cache → transform → build, each step a script; reruns are reproducible; outputs versioned *(6a: `npm run pipeline -- league`; a rebuild is byte-identical, checked by a test)*
- [x] **nflverse import:** end-of-2025 rosters (including practice squads and injured players), bios (age, size, college, draft info, experience), snap counts, injuries *(6b: injury history 2023-25 from game-status reports and injured-reserve weeks)*
- [x] **Player ID crosswalk** across sources, with an unmatched-players report; fixes go in a documented overrides file (data, not hand edits to outputs) *(6a: Madden matched by last name and birth date, then nickname-aware full name; 1,830 of 1,880 Madden players matched)*
- [x] **Ratings build:** Madden end-of-2025 ratings (private input) → mapped into our own rating model → adjusted with real performance data (play-by-play, Next Gen Stats, snap counts) *(Madden 26 Week 1, since no end-of-season file turned up; 6b moves regulars toward their 2025 production and teams' regulars with real 2025 point differential)*
- [x] **Hidden traits** generated from age, draft pedigree, and injury history
- [x] **Sanity-check sheet:** top 10 at every position reviewed by hand *(built with every league build (private); reviewed by Claude and approved by the owner after Phase 6b)*
- [x] **Career stats** imported so careers continue from their real numbers *(regular seasons since 1999)*
- [ ] **Naming session:** league name, championship name, 32 team names, mascots, colors, simple generated logos/monograms
- [x] **Fictional names** for every real person, one consistent mapping kept only inside the pipeline; automated check that no real name survives into any output *(names come from a hash of each person's id, so no lookup table is stored at all; colleges map to fictional schools)*
- [x] **Coaching staffs** as of the end of the 2025 regular season (basic attributes; full traits in Phase 10) *(head coaches and coordinators from end-of-2025 team staff pages, interim coaches where teams had them; one job without a real holder is generated)*
- [x] Stadiums and cities *(roof, surface and elevation per team from Phase 5b; real cities)*
- [x] **League build:** outputs a starting league file (people, ratings, teams; contracts arrive in Phase 7) *(6a: the real 2025 season runs through our standings, tiebreakers and draft order and matches reality; all 272 real 2026 opponents match, though 88 games have home and away swapped)*
- [x] **UI:** New League offers "Real league (2026)" or "Fictional league"

### Done when
- [x] The real league loads, and each team's roster is recognizable in shape (you can spot each team's real star by position, age, and stats, even renamed) *(owner approved the sanity sheet after Phase 6b)*
- [x] Unmatched-player report is at or near zero *(5 roster rows lack an id or birth date; 4 regular starters signed after the Madden update get ratings from public data)*
- [x] The real-name check finds zero real names in any build output *(every build, plus a local test against all of nflverse's players)*
- [x] Rebuilding from scratch produces an identical league file *(local test)*
- [x] A sim'd season with the real rosters still passes the calibration scorecard *(62 of 63 on three seed sets, as good as generated leagues; the miss is the long-standing success-rate gap; core stats checked by a local test)*

<details>
<summary>Kickoff prompt</summary>

"Phase 6: build the real-league data pipeline. Set up the licensing guardrails (private folder, data-sources doc) first. Import end-of-2025 rosters and bios from nflverse, build an ID crosswalk with an unmatched report, map Madden ratings (private input) into our rating model and adjust with real performance data, generate hidden traits, import career stats, generate fictional names with an automated real-name check, and build the starting league file. Plan first; flag any source licensing questions."

</details>

---

## Phase 7 — Contracts & the salary cap

**Goal:** The real cap, the real contract structures, and the real loopholes, with every team starting at its real cap situation.

### Steps
- [x] **Rules config:** cap by year with a growth model, proration limit, minimum salaries by credited seasons, rookie wage scale, veteran-minimum benefit, cap rollover, minimum cash spending, offseason top-51 rule, likely vs. not-likely-to-be-earned incentive accounting and year-end adjustments. Every value verified against the CBA *(7a: read from the CBA text and NFL announcements, each with its source; the rookie scale is a provisional curve until 7b)*
- [x] **Contract model**, year by year: base salary, signing-bonus proration, roster / option / workout / per-game roster bonuses, incentives, guarantees (full, injury-only, vesting dates), void years
- [x] **Cap hit and dead money calculators:** release pre- and post-June 1, the June 1 designation, trades (remaining proration accelerates onto the trading team)
- [x] **Operations:** sign, extend, restructure (convert salary to bonus), release, trade, pay cut, option exercise/decline, void-year acceleration
- [ ] **Tags & tenders:** franchise tag (exclusive / non-exclusive), transition tag, restricted free agent tenders with offer sheets and matching, exclusive-rights tenders *(7a: non-exclusive franchise and transition tag amounts and RFA tender amounts; offer sheets, matching and the exclusive tag come with Phase 12's free agency)*
- [x] **Rookie contracts:** wage scale by draft slot; fifth-year option for first-rounders *(7b: the scale is fitted to all 257 real 2026 rookie deals, every slot within $40K; Pro Bowl option tiers wait for awards in Phase 15)*
- [x] **Cash vs. cap ledger:** every dollar tracked; invariant tests (cash paid over a contract's life equals its total cap charges) *(cash per team per year logged for the minimum spending rule; 60 random contracts checked)*
- [x] **Worked-example tests** for every rule (restructure, void-year acceleration, post-June 1 cut, tag math…)
- [x] **Import real contracts** (nflverse / OverTheCap data); document assumptions where year-by-year detail is missing; import existing dead money *(7b: from each team's public cap page as archived Feb 2–25, 2026, plus nflverse for years after 2029; 1,650 contracts, dead money and void years included; kept private like the Madden file)*
- [x] **Validation report:** each team's 2026 cap space vs. its published real figure, within a tolerance *(7b: 1,629 of 1,650 contracts reproduce their published 2026 cap hit to the dollar, 97% of all 2026–29 contract-years; team totals in the private build report)*
- [x] **UI:** contract page (year-by-year table), team cap sheet (top 51, dead money, cap space for the next four years), "what if" panel showing savings and dead money *before* you cut, trade, or restructure *(7b: on the player page and the team's Salary cap tab; the league office can release or restructure for any team until GM Mode; trades are previews until Phase 8)*

### Done when
- [x] Team cap sheets match reality within tolerance for nearly every team (exceptions explained) *(25 of 32 within $3M of the published Feb 10 figures, 10 within $0.1M; the other 7 are explained: their archived pages are from a different day, and/or they have futures signings our end-of-season rosters don't include)*
- [x] Every worked-example test passes
- [x] You can create cap room with a restructure and see next year's bill grow *(checked in the browser: +$21.5M now, +$7.2M a year in 2027–29; also a test)*
- [x] Cutting a player shows the correct pre- vs. post-June 1 dead money *(the "what if" panel; a test checks preview and result to the dollar)*

<details>
<summary>Kickoff prompt</summary>

"Phase 7: build the contracts and salary cap engine with every rule in the rules config, verified against the CBA. Model contracts year by year, compute cap hits and dead money for every operation, add tags/tenders and rookie contracts, keep a cash vs. cap ledger with invariant tests, and write a worked-example test for every rule. Then import real contracts and produce a validation report against published team cap space. Money is integers. Plan first."

</details>

---

## Phase 8 — Roster rules, transactions & the full calendar

**Goal:** The complete league year runs with every roster rule enforced, and rosters stay legal through every transaction.

### Steps
- [x] **Full calendar:** new league year, re-signing and tag windows, combine, legal tampering, free agency, draft, undrafted signings, minicamps, training camp, preseason, cutdown, regular season, trade deadline, playoffs; all deadlines live (tag deadline, fifth-year option deadline, June 1…) *(8a: every 2026 date checked against the NFL's calendars; contracts now expire at the March League Year; minicamps are dates only until players' moods arrive in Phase 12)*
- [x] **Roster limits** (offseason, regular season, game-day actives) from rules config, with a legality validator after every transaction *(8a: 90 / 53 / 48, or 47 with fewer than eight linemen; the check runs after every move in tests and the runner)*
- [x] **Practice squad:** size, eligibility, veteran exceptions, game-day elevations and their limits, signing players off other teams' practice squads *(8a: 16 + 1 international, six veterans, CBA weekly pay on the cap, two elevations a game and three a season, four protected a week; the three-week pay guarantee for a player signed away isn't modeled yet)*
- [x] **Reserve lists:** injured reserve with minimum stay and return designations, preseason injury lists *(8a: four-game minimum, eight returns plus two in the playoffs, two named at cuts; PUP for players hurt in camp; NFI waits for non-football injuries in Phase 9)*
- [x] **Waivers:** claim priority, waiver periods, vested-veteran rules *(8a: last season's draft order through Week 3, then standings; vested veterans skip waivers until the deadline; claims resolve at once instead of over 24 hours)*
- [x] **Trades:** players and picks (future picks several years out), cap checks, trade deadline *(8b: refused outside March–deadline, over the cap or roster limit, or for practice-squad players; the preview equals the result; AI trading is Phase 13)*
- [x] **Preseason games** (optional per league) and **cutdown day**, with the waiver-claim rush after it *(8a: starters rest; a showcase grade per player counts at cuts, and standouts with room to grow get a small capped boost)*
- [x] **Simple AI roster upkeep** (fill holes, cut the lowest, sign rookies) so AI teams stay legal until Phase 13 *(8a: placeholder draft and undrafted rush, weekly IR / returns / 53 / squad, futures deals, placeholder retirement until Phase 9)*
- [x] **UI:** transactions log, roster management (cut, IR, practice squad, elevations), basic trade builder with cap impact, calendar view of upcoming deadlines *(8b: plus a training camp report; checked in the browser)*

### Done when
- [x] 10 headless seasons with every roster legal at every check *(8a: a test plays ten full League Years with the check after every move; the runner does it for any number)*
- [x] Cutdown day happens, waiver claims go through in the right order, rookies get signed *(8a: tests, and seen in the browser: 53 + practice squads after cuts)*
- [x] You can make a trade and see both teams' cap impact before confirming *(checked in the browser: illegal trades are refused with the reason; a test checks preview = result)*

<details>
<summary>Kickoff prompt</summary>

"Phase 8: build the full league-year calendar with live deadlines, roster limits with a legality validator, practice squad, reserve lists, waivers, trades, preseason and cutdown, and simple AI roster upkeep, all driven by the rules config. Add the transactions, roster management, trade builder, and calendar screens. Plan first."

</details>

---

## Phase 9 — Player lifecycle: development, aging, injuries & retirement

**Goal:** Careers rise and fall believably, and the league's talent stays stable over decades.

### Steps
- [x] **Aging curves by position**, fit from real data (nflverse snaps and production by age) *(9a: share of snaps 2013-25, quarterbacks by EPA per play; peaks RB/TE 25, most 26, EDGE 27, QB 28; `calibration/lifecycle.json`)*
- [x] **Offseason development:** potential, work ethic, age, playing time, and coaching (hook for Phase 10) *(9a: growth toward potential timed by the real curve, decline along it, physical traits first after 30; every notable change has a reason)*
- [x] **Training camp:** development plus position battles that set the depth chart *(9a: close battles only, as decided: the preseason grade is worth up to 1.25 points, so a 3-point gap always holds; the depth chart tags camp winners. About 9-10 jobs a season are won in camp)*
- [x] **In-season updates:** small weekly rating changes from performance, playing time, and health *(9a: playing time and age; 9b: playing through a knock costs a step for the game, and a severe leg injury costs speed for good. Performance itself doesn't move ratings yet)*
- [x] **Injury model:** types and body parts, severity, recovery-time distributions from real injury data, reinjury risk, long-term decline, injury reports (out / doubtful / questionable), medical staff hook *(9b: `calibration/injuries.json` from 2016-25 reports; practice and camp injuries fill the real total (31 costing games per team-season); same-part reinjury x2.1; weekly report Out/Doubtful/Questionable with 68% of Questionable playing (real 67%); lasting damage is a judgment value; medical hook neutral until Phase 10)*
- [x] **Retirement decisions:** age, decline, contract, titles won, injuries *(9a: log-odds model against each position's real retirement ages; idle free agents retire; each retirement records its reasons. Career-ending injuries come with 9b's injury model)*
- [x] Career arcs and career stat tracking across seasons *(9a: a rating history per player per season, alongside the career stats from Phase 4b/6; the chart is 9b)*
- [x] **Long-run calibration:** league age distribution, average career length by position, injured-reserve placements per team per season, all near real values *(age mix within a few tenths of real over 30 seasons; careers within half a season for 9 of 14 groups, long for EDGE, S, OL, K, P; IR 3.0 at Week 1 + 7.5 in season vs. real 3.2 + 6.2)*
- [x] **UI:** player rating-history charts, injury report, post-camp development report *(9b: career-arc chart and injury history on the player page, `/injuries`, `/development`; checked in the browser)*

### Done when
- [x] A 30-season sim keeps the league's age and talent distributions stable (no rating inflation or collapse) *(9a: `npm run sim -- --lifecycle 30`: starters 76.4 → 76.7, mean age 26.4-26.7, same on the real league; 90+ players settle at 40-55; a 10-season test guards it in CI)*
- [ ] Running backs decline earlier than quarterbacks; career lengths by position look real *(9a: running backs peak at 25 and decline first (test); careers close for most groups, but EDGE, OL and especially kickers and punters last too long until Phase 13's roster AI)*
- [x] Stars have believable career arcs: rise, peak, decline, retire *(long careers peak in the player's prime (test); the career-arc chart shows each player's rise and fall; a 24-year-old's 14-point jump in one March led to capping a year's growth)*

<details>
<summary>Kickoff prompt</summary>

"Phase 9: build player development, position aging curves fit from real data, training camp position battles, in-season rating updates, a full injury model calibrated to real injury data, and retirement. Add long-run calibration checks over 30 seasons and the player history / injury screens. Plan first."

</details>

---

## Phase 10 — Coaches & staff

**Goal:** Coaches become the strategy layer: who you hire decides how your team plays.

### Steps
- [x] **Coach model:** offensive and defensive philosophies, game-management traits (4th-down aggressiveness, 2-point tendency, clock management, timeout use, run/pass balance, in-game adaptability, halftime adjustments), leadership traits (development, discipline, locker room, staff building), career history *(10a/10b: styles in real units, skills incl. development, discipline and health, careers with records and the head coach above; locker-room effects wait for Phase 12's chemistry)*
- [x] **Real coaches' traits derived from their teams' play-by-play** (pass rate over expected, 4th-down decisions vs. the model, tempo, 2-point rate, blitz and coverage tendencies where data allows) *(10a: `calibration/coaching.json` from 2016-25 team-seasons; 94 of 96 real head coaches and coordinators get their tendencies, shrunk by sample noise)*
- [x] **AI play callers:** the offensive and defensive coordinators' traits now drive the engine's play calling; the head coach owns game management *(10a: pass rate, tempo, deep shots, personnel, blitz, man coverage, stacked boxes, 4th-down and 2-point aggressiveness, discipline, and a small zero-sum play-calling edge)*
- [x] **Scheme fit:** each scheme defines what it wants at each position; fit changes on-field effectiveness and development *(10a: up to ±3 overall on game day and the depth chart, ±5% development; neutral for a typical player)*
- [x] **Position coaches** affect development; strength and medical staff affect injuries *(10a: development ±10% by position group and ±3% from the head coach; injury risk and recovery time ±10%; neutral on average)*
- [x] **Scouts** (accuracy, regional and positional expertise; used in Phase 11) *(10b: two per team with a scouting skill and a position-group specialty; regions wait for Phase 11's college data)*
- [x] **Staff market:** generated coaches, coach development and reputations *(10b: new faces join thin searches; skills grow until ~50 and slip after 64; reputations from results; retirements)*
- [x] **Coaching carousel:** firings, interview requests, interview rules from config, assistants poached as coordinators and head coaches *(10b: Black Monday and in-season firings with reasons; interviews and signing timing from `rules.staff` (2023-25 policy as reported); hires as each playoff round ends)*
- [x] **Coaching trees** recorded (who worked under whom) *(10b: each career line records the head coach above; the coach profile shows worked-under and his tree)*
- [x] **UI:** staff page, coach profile with philosophy chart, hiring screen (candidates, interviews), scheme-fit badges on the roster *(checked in the browser; the carousel page doubles as the hiring screen, with league-office hiring until GM Mode)*

### Done when
- [x] Two identical rosters with different coaching staffs play visibly differently (pass rate, 4th-down attempts, blitz rate) *(10a: test in CI; team spreads match real ones within about 15%)*
- [x] Changing coordinators moves players' scheme-fit ratings, and some players get better or worse *(10a: test in CI; fit tags on the roster in the browser)*
- [x] Each offseason's number of head-coach changes lands in a realistic range *(10b: 7.21 a year over 20 seasons vs. real 7.2, single seasons 4-11; in-season 1.58 vs. 1.65; a band check in the 10-season test)*
- [x] Calibration scorecard still green with coaches calling plays *(10a: 61 of 63 on generated and real leagues, two seeds each; the misses are the long-standing success-rate gap and net punting a hair over its edge)*

<details>
<summary>Kickoff prompt</summary>

"Phase 10: build the coach model, derive real coaches' tendencies from nflverse play-by-play, make coordinators' traits drive the engine's play calling, add scheme fit, staff effects on development and injuries, scouts, the staff market, the coaching carousel, and coaching trees. Add staff and hiring screens. Re-run calibration. Plan first."

</details>

---

## Phase 11 — Scouting & the draft

**Goal:** You never see true ratings. Your scouts' accuracy decides how clearly you see prospects, and drafts produce real busts and gems.

### Steps
- [x] **Perception for real:** scouted ratings = truth + noise; noise shrinks with scout quality, scouting budget and time spent, and the player's experience (veterans are clear, prospects aren't); confidence ranges shown in the UI *(11a: hash-based, no dice on screens; mostly a league-wide shared error plus each team's own; "Viewing as" switch, league office by default)*
- [x] **Real 2026 draft class import:** prospects (renamed) with combine measurables and profiles *(11a: 345 real prospects ranked by the real draft, physicals from real drills, hidden spread redrawn per game; private)*
- [x] **Draft class generator** for 2027 on: class size, position mix, measurables, potentials; calibrated so value by draft slot matches real hit rates by round *(11a: picks 1-150 within about 3-6 points of real start rates; picks 151-224 about 6 high)*
- [x] **Combine and pro days** as calendar events that reveal measurables *(11a: ~337 invitees on the combine date, pro days spread March to April; drills match the real distributions by position)*
- [x] **Scouting assignments:** send scouts by region and position; reports arrive over the season *(11a: weekly study September to April; AI assigns by need, the league office can set any team's and its budget)*
- [x] **Big boards:** yours (editable) and each AI team's (needs + philosophy; deepened in Phase 13) *(11b: scouts' grades plus needs read by the team's own staff and a philosophy fixed per team; boards set by hand are followed on draft day)*
- [x] **Draft day:** pick clock, AI picks, trading up and down with pick values, draft log *(11b: a draft-day stage, pick by pick; real 2026 clock times; 33-35 trades a draft at a median 1.41-1.42 times career value vs. real 31.7 and 1.42; every pick and trade logged with its reason)*
- [x] **Compensatory picks** approximating the real formula (free agents lost vs. signed, by contract size and playing time), awarded before the draft *(11b: CBA Appendix V in the rules file, a worked example in CI; honors wait for Phase 15's All-Pros; about half are supplemental until Phase 12's free agency moves more players)*
- [x] Rookie contracts signed on the wage scale; **undrafted free-agent** signing rush *(rookie scale from Phase 7b; 11b: the rush follows each team's board)*
- [x] **Retro draft grades:** truth revealed over time; bust and steal tracking *(11b: seasons started vs. real picks at the slot, steal/hit/fair/miss/bust, team grades per class)*
- [x] **UI:** draft room, big board, prospect pages (scouting report, combine results, confidence), mock drafts *(11a-11b, checked in the browser: draft room with offers and live play, big board editing, mock drafts, draft history)*

### Done when
- [x] In a 20-season sim, early first-rounders are far better on average than late-rounders, with real busts and late-round gems *(11a: `--draft 20`, picks 1-10 start 3+ seasons 85% vs. 15% for picks 201-224; about 6% of first-rounders never start; undrafted players hold about a fifth of starting seasons)*
- [ ] Hit rates by round fall in real ranges *(partly: with compensatory picks, rounds 1-3 within about 4 points of real and picks 1-100 within about 7; rounds 4-7 start 1-11 points more often, mostly while supplemental picks stand in for formula ones until Phase 12)*
- [x] A better scout visibly tightens the confidence ranges *(11a: test in CI; switch "Viewing as" on the Draft and prospect pages to see it)*
- [x] Draft-day trades happen at sensible prices *(11b: median 1.41-1.42 times career value, middle half 1.34-1.48, vs. real 1.42 and 1.30-1.56; a CI test keeps every trade in the band)*

<details>
<summary>Kickoff prompt</summary>

"Phase 11: make the perception layer real (scouted ratings with noise driven by scouts, budget, and experience), import the real 2026 draft class, build a calibrated draft class generator, combine and pro days, scouting assignments, big boards, draft day with trades, compensatory picks, rookie and undrafted signings, and retro draft grades. Add the draft room and prospect screens. Plan first."

</details>

---

## Phase 12 — Free agency, negotiation & chemistry

**Goal:** Players are people: they want different things, their agents negotiate, and the market sets prices the way the real one does.

### Steps
- [x] **Market value model** anchored to comparable contracts (position, tier, age), starting from the real contract market and updating as signings happen *(12a: real pay by position and rank from nflverse/OTC contracts, derived curves only; the league's own deals move it within 15% of the real curve)*
- [x] **Player priorities and personality** shape demands: money, guarantees, length, winning, role, coach, location *(12a: ego, money priority and loyalty move the ask; winning, role, location and scheme fit move what he needs from each team)*
- [x] **Agents** with styles: hardball, fair, relationship-driven, money-only *(12a: 64 fictional agents; style sets the ask, the walk-away point, the pace of counters and patience)*
- [x] **Negotiation:** offers (years, average salary, guarantees, structure), counteroffers, patience, walk-aways, with reasons shown *(12a: checked in the browser)*
- [x] **Re-signing window and in-season extensions** *(12a: about 85 well-paid re-signings a year vs. real 105; 28-32 extensions a year vs. real 26 big ones)*
- [x] **Holdouts, hold-ins, and trade requests** *(12b: unhappy, underpaid stars at camp (CBA fines for holdouts), in-season trade requests; teams extend, trade for picks or wait, with reasons; 3.8-5.0 holdouts and hold-ins and 1.3-3.5 trade requests a year vs. a judged real 3-8 and 1-5)*
- [x] **Legal tampering and free agency:** multi-team bidding over several days; player decision logic weighing all priorities *(12a: day by day for a week, weekly to the draft, late rounds to camp; about 123 well-paid free agents change teams a year vs. real 140)*
- [x] **Restricted free agency** offer sheets and matching (rules from Phase 7) *(12a: tenders, tags (exclusive, non-exclusive, transition), offer sheets with five days to match and the CBA's compensation picks; rules checked against Articles 8-10)*
- [x] **Morale and locker-room chemistry:** winning, playing time, leaders, coach fit, contract disputes; effects kept small and calibrated *(12b: mood 0-100 with reasons, weekly; also pay and loyalty; chemistry weights leaders and counts unhappy big egos; effects at most ~1 rating point on game day, ±6% development, ±6% on the ask to his own team; scorecard 61-62 of 63 with and without, 30-season run stable)*
- [x] Late free agency and the veteran-minimum market *(12a: a late round every three weeks after the draft, then minimum deals)*
- [x] **UI:** negotiation screen, free-agent market board with interest levels, player mood indicators, locker-room page *(12a: `/negotiate`, `/free-agency`; 12b: mood card on the player page, Mood column on rosters, the team's Locker room tab, holdouts and trade requests on the league page; checked in the browser)*

### Done when
- [x] Top free agents sign for amounts near real market ranges for their position and tier *(12a: 62-67% of each position's top free agents (tiers 1 and 2-3) inside the real 10th-90th percentile range over six League Years, two seeds; a CI check keeps it above 45%)*
- [x] Lowball offers get rejected with an understandable reason *(12a: test in CI, and in the browser: "Offered 51% of his asking price...; his agent (relationship-driven) ended talks")*
- [x] Overpaying always works, and the cap sheet shows the cost *(12a: test in CI across players and teams; the negotiation screen previews the room before and after)*
- [x] A star in a contract dispute can hold out or request a trade *(12b: test with a constructed underpaid star (candidate, holdout and trade request each answered with a reason, fines per CBA); counts in `--market`; seen on the league page in the browser)*

<details>
<summary>Kickoff prompt</summary>

"Phase 12: build the market value model from comparable contracts, player priorities, agents, a negotiation system with reasons, re-signing and extensions, holdouts and trade requests, multi-day free agency bidding, RFA offer sheets, and morale/chemistry. Add the negotiation, market, and locker-room screens. Plan first."

</details>

---

## Phase 13 — AI general managers & owners (Simulation Mode complete)

**Goal:** 32 distinct AI front offices run the league for a century, and the trade AI can't be fleeced.

### Steps
- [x] **GM philosophies** as parameter sets: analytics-driven, win-now, draft-and-develop, cap-aggressive, trade-happy, conservative *(13a: six knobs, labeled by the nearest archetype; real 2025 GMs measured from their teams' trades, draft-day moves and dead money, private)*
- [x] **Team evaluation:** needs by position, contention window (contend / retool / rebuild), multi-year cap outlook *(13a: the GM's own read now and in two years, record, quarterback, three-year cap room, with reasons; re-read at the League Year, camp and the deadline)*
- [x] **Offseason AI:** re-sign / tag / cut decisions, free agency strategy, draft boards, extensions, restructures (cap-aggressive teams use void years and pay later) *(13a/13b: limits and budgets by GM and stance, draft boards from the GM, void-year restructures, early extensions; cap-aggressive GMs restructure 3-4x as often and land in cap hell 7-10% of seasons vs. 1-4% for conservative ones)*
- [x] **Trade AI:** player value (age, production, contract surplus value, position), pick value, needs; proposes and evaluates trades with reasons *(13a: about 79-81 trades a year vs. real 82, by stretch of the year and price mix within a few of real; answers and counters with reasons; offers to person-run teams)*
- [x] **Anti-exploit test suite:** a bot tries known fleecing patterns (two-for-one junk deals, injured players, contract dumps, pick-swap tricks, repeated small trades) and must fail *(13a: `exploits.test.ts`, hundreds of legal attempts against every team; none clearly lopsided by a neutral judge)*
- [x] **In-season AI:** waiver claims, injury replacements, trade-deadline buying and selling *(13b: injured starters create needs; contenders buy and rebuilders sell, busiest the deadline week; in-season trades 12-13 a year vs. real 13.4)*
- [x] **Owners:** patience, budget, meddling, expectations; they hire and fire GMs and coaches with recorded reasons *(13b: 4.2-4.8 GM changes a year vs. real 4.5; head-coach changes 7.8 and 1.4 vs. 7.2 and 1.65)*
- [x] **Balance check:** no philosophy dominates absurdly; cap-aggressive teams sometimes land in cap hell *(13b: `--frontoffices`; win share by type 0.45-0.57 across seeds; cap hell 7-10% for cap-aggressive and win-now)*
- [x] **Simulation Mode UI:** hands-off start, sim N seasons, league overview, power rankings, GM and owner pages *(13b: `/simulation` and `/executive/:id`; checked in the browser over 8 seasons; every team is AI-run by default)*
- [x] **100-season stability run** in the headless runner *(13b: seed 7, every roster legal after every move; it found a cap bug and a name-pool hang, both fixed; history cards made it 3.5x faster)*
- [x] **🚀 Release v0.3** (Simulation Mode)

### Done when
- [x] 100 seasons run with no crashes, every team cap- and roster-legal throughout *(38 minutes headless, 0 rule breaks, 0 schedule problems)*
- [x] Dynasties and rebuilds both happen; different GM types build visibly different teams *(partly: runs of 7-11 playoff seasons and 12-15 losing seasons happen, and types differ clearly in cap hell, spending, trades and restructures; but seasons carry over less than real (r 0.20 vs. 0.33) and five-year playoff runs come about two-thirds as often)*
- [x] The anti-exploit suite finds no clearly lopsided trade that the AI accepts
- [x] AI owners fire and hire people for reasons you can read *(front-office moves on `/simulation` and each GM's page)*

<details>
<summary>Kickoff prompt</summary>

"Phase 13: build AI GMs with distinct philosophies, team evaluation, full offseason and in-season AI, a trade AI with value models and reasons, an anti-exploit test suite, AI owners who hire and fire, and the Simulation Mode screens. Run a 100-season stability check. Plan first."

</details>

---

## Phase 14 — GM Mode career layer

**Goal:** Take over one team and live the job: deadlines, an owner watching, and the risk of getting fired.

### Steps
- [x] **Start a career:** pick a team, meet the owner, see expectations *(14a: New League asks GM or Simulation Mode; the team list shows record, stance, owner and cap room; the owner meeting gives his traits, expectations and budget)*
- [x] **Inbox / decision queue:** every pending decision (tag deadline, offers, interview requests for your staff, trade proposals) with deadlines; the sim pauses when you must decide *(14a/14b: re-signing and tags before the League Year, your pick on the clock, final cuts, extension windows, holdouts and trade requests, coaching vacancies, trade offers with their pieces, interview notices; your staff decide anything you sim past)*
- [x] **Delegation and autopilot:** per area (depth chart, re-signings, draft, waivers), and "sim to the next decision" *(14a: 13 areas, big calls yours by default; one check, `staffDecides`, in every AI routine; a fully delegated team plays like an AI team)*
- [x] **Owner relationship:** patience, budget, approval of your moves, job security meter; getting fired; job offers from other teams; continuing the career elsewhere *(14b: the AI GMs' own firing odds plus the owner's reactions; budget and a meddler's veto; Black Monday and rare in-season firings; offers, waiting, retiring)*
- [x] **Your GM career page:** record, titles, trades, draft history *(14b: `/career`, with job security and the owner's words)*
- [x] Decide on more than one human team (Decisions log); if yes, multiple human deciders *(one for now; multiplayer recorded as a stretch goal)*
- [x] Save slots, autosave, league export *(14b: "Save a copy", a backup the first time each season is saved with restore as a copy; autosave after every action and export as before)*
- [x] **Onboarding:** first-season guided tips, glossary of cap and roster terms in plain English *(14b: eight tips at the year's big moments; 28 glossary terms with numbers from the rules file)*
- [x] **🚀 Release v0.4** (GM Mode) *(tagged v0.4 in Phase 18; the hosted demo waits for Pages)*

### Done when
- [x] You can play three full seasons as one team without needing a spreadsheet *(scripted: `career.test.ts` plays three seasons through the screens' functions with the legality audit on; by hand: a season and the next re-signing window in the browser)*
- [x] Missing expectations gets you fired, and you can take another job *(`job.test.ts`; the offers and career screens checked in the browser, but not right after a real firing)*
- [x] Delegated areas are handled sensibly by your staff *(a fully delegated team plays two seasons legally and is never asked anything; staff decisions at deadlines leave a log line)*

<details>
<summary>Kickoff prompt</summary>

"Phase 14: build the GM Mode career layer: team selection, the inbox/decision queue with deadlines, delegation and autopilot, the owner relationship and job security with firing and new job offers, a GM career page, save slots, and onboarding with a plain-English glossary. Plan first."

</details>

---

## Phase 15 — League history & storytelling

**Goal:** The league has a past and makes its own: awards, records, legends, and a newsfeed that tells the story.

### Steps
- [x] Decide history scope (Decisions log) *(from the first championship game, the 1966 season; standing records at every level)*
- [ ] **Import real history** (renamed via the same mapping): champions, standings, award winners, Hall of Famers, all-time and single-season record books, franchise records *(15a, partly: 59 seasons 1966-2024 with standings and champions, award winners and All-Pro teams since 1966, 292 Hall of Famers, 158 retired numbers, league record books (25 of 30 lists: the other five pages have no archived copy), franchise record books for all 32 teams (15c: career and season lists three deep from each club's own leader pages, topped up with the seasons since the archived copy; single-game marks for only 8 clubs, the ones with a readable public records page); the last three Pro Bowls)*
- [x] **Awards:** MVP, Offensive / Defensive Player of the Year, Offensive / Defensive Rookie of the Year, Coach of the Year, Comeback Player, All-Pro, Pro Bowl; voting that mimics media voters *(15a: production z-scores, team record and the voters' habits by position, fitted to the real winners' mix; two 20-season runs land within about 15 points of it by position)*
- [x] **Record book** (game, season, career; team and league) with "record broken" events *(15a: checked after every game and week; a broken record keeps its old holder and makes news)*
- [x] **Hall of Fame voting** with real eligibility timing *(15a: five seasons' wait, 13 finalists plus a coach and a GM, 80% approval, 3-7 a class, all from the Hall's own pages)*
- [x] Retired numbers, franchise history pages, dynasty and drought detection *(15a/15b)*
- [x] **Coaching tree viewer** (family-tree style, reusing the phylogeny viewer idea) *(15b: drawn on each coach's page)*
- [x] **Newsfeed:** weekly storylines from real sim events (trades and reactions, signings, injuries, award races, hot seats, streaks) *(15b)*
- [x] Season recap pages *(15b: /season/:year)*

### Done when
- [x] After 20 seasons, the history pages read like a real league almanac *(`--history 20` on generated and real leagues; the almanac, recaps, records, team histories and newsfeed checked in the browser)*
- [x] Breaking a real-era record (renamed) shows up in the newsfeed *(`tests/realLeague.test.ts`: a quarterback passes the real single-season mark; the book keeps the old holder)*
- [x] Hall of Fame classes look right: the best careers get in *(all twenty strongest careers in after 16 classes; classes 3-7; about 56% first ballot against about a third in the real Hall)*

<details>
<summary>Kickoff prompt</summary>

"Phase 15: import real league history through the pipeline (renamed), build awards voting, the record book with record-broken events, Hall of Fame voting, franchise histories, the coaching tree viewer, and a newsfeed generated from sim events. Plan first."

</details>

---

## Phase 16 — Day One: the real 2026 start

**Goal:** The real-league start is exactly right: the day after the 2025 championship game, with everything as it actually stood.

### Steps
- [x] Start date is the day after the 2025 championship (Feb 9, 2026); Seattle champion, New England runner-up, playoff results stand *(the real file's 2025 season matches the real results, 29-13 in the final; tested against nflverse)*
- [x] **Coaching staffs as of the end of the 2025 regular season**, so the real carousel's decisions happen in the sim instead *(each new game plays its own carousel on its seed: about 9.5 head coaches and 6.5 general managers change per start, against 7.2 and 4.5 in a typical real year; recorded in the devlog)*
- [x] **Real 2026 free-agent class** (expiring contracts), **real 2026 draft order** including traded and compensatory picks, real 2026 opponents, the real 2026 cap *(draft order, 2027 trades, schedule and cap checked per team; the free-agent class is checked in one direction only: every real deal into 2026 exists in ours; players with minimum or practice-squad deals aren't in the real contracts file, so there is no independent real list to compare the rest with)*
- [x] **Automated Day One validation report:** per team, roster size, cap space vs. real, picks owned vs. real, pending free agents vs. real *(`npm run pipeline -- league` writes `day-one.json` and a report section; contracts replace the pending-free-agent count for the reason above)*
- [x] "Where things stand" intro screen for a new real-league save *(`/start`)*
- [x] **Rebuild guide:** how to rerun the pipeline for a 2027 start *(`docs/rebuild-guide.md`; written from the code, not yet followed for a real 2027 build)*

### Done when
- [x] The validation report passes for all 32 teams (or lists explained exceptions) *(25 pass outright; 7 miss only on cap space, each with its reason: the cap page was archived on another day than the published figure)*
- [x] The first screen of a new real-league save matches what a fan would expect on Feb 9, 2026 (renamed) *(checked in the browser on the private league: Seattle over New England, the real top of the draft with traded picks marked, the cap room extremes, the carousel's changes; no screenshot committed)*

<details>
<summary>Kickoff prompt</summary>

"Phase 16: make the real-league start exact. Set the start date and staffs, the real 2026 free-agent class, draft order with traded and compensatory picks, opponents, and cap. Build an automated per-team validation report against the real figures, an intro screen, and a pipeline rebuild guide. Plan first."

</details>

---

## Phase 17 — Experiments & analytics

**Goal:** Turn the league into a tool for answering questions, with statistics behind each claim.

### Steps
- [x] **Experiment files:** JSON describing start, settings, seeds, number of seasons, and metrics *(`experiments/*.json`, checked on load; the result carries a copy)*
- [x] **Parallel runner:** many seeds across all CPU cores *(`npm run sim -- --experiment <file> --workers 6`; worker processes, resumable, the same result for any worker count)*
- [x] **Analytics pages** in the web app: compare groups with charts and confidence intervals *(`/experiments`: dot-and-whisker, line with band, bars, a table under each chart; chart text is small on a phone, for Phase 18's phone pass)*
- [x] Headline experiments:
  - [x] **Alternate histories:** the 2026 season 1,000 times from the real start; title odds per team *(private: the page exists only on the machine with the real league)*
  - [x] Cap-aggressive vs. conservative GMs: more titles, or sooner rise and harder collapse? *(60 x 20 seasons: an early edge, a slightly worse twenty years, no harder collapse)*
  - [x] Draft-and-develop vs. free-agency spending over 20 years *(60 x 20 seasons: the draft won, about 44% more titles)*
  - [x] A great head coach vs. a great quarterback, in wins *(150 runs: the quarterback is worth about three times the staff)*
  - [x] Aggressive 4th-down coaches vs. conservative ones *(200 x 2 seasons: about a fifth of a win a season at four standard deviations apart)*
  - [x] How random is a single-elimination playoff? How often does the best team win? *(40 leagues x 200 replays: 30%, against 9% for a coin flip)*

### Done when
- [x] Each headline experiment has a clear chart and a written conclusion *(`docs/findings/` and the Experiments pages; the alternate-histories conclusion is private. The answers are the simulation's, and each finding says what is set by the model)*

<details>
<summary>Kickoff prompt</summary>

"Phase 17: build experiment files, a parallel headless runner, and analytics pages with confidence intervals. Then run the headline experiments from the roadmap and write up each with a chart and conclusion. Plan first."

</details>

---

## Phase 18 — Ship it

**Goal:** A polished, public, portfolio-grade v1.0.

### Steps
- [x] **Data licensing review resolved** and recorded: exactly what's published, what's built locally, and credits *(MIT; `NOTICE.md`, `docs/data-sources.md`, the About page; builds can't ship the private file; not legal advice)*
- [x] **Trademark sweep:** automated check for NFL names, team names, the championship game's trademarked name, logos across code, data, and UI *(`tests/sweep.test.ts` runs in CI on hashed names; no logos exist in the project; "Pro Bowl" became "All-Star Game"; two nicknames and the conference names were replaced)*
- [x] **Performance & save size:** budget for a 50-season save; keep box-score summaries, prune old play-by-play; fast load times *(50 seasons: 106 MB to 34 MB raw, 4.7 MB gzipped; budget 40 MB, the plan's 30 MB was missed; league year about 40% faster with identical results; first download 866 KB to about 300 KB; `docs/performance.md`)*
- [x] Accessibility pass; usable layouts for the main screens on a phone *(axe-core: no violations over 28 routes, light and dark; 34 routes at 375 px without sideways scrolling; keyboard check partial: skip link, dialogs, tabs; no screen-reader pass, not a certified audit)*
- [x] **README:** screenshots / GIFs, architecture diagram, how to play, how to rebuild the data *(stills only, no GIFs)*
- [x] Portfolio page and the findings write-up from Phase 17
- [x] Tidy the devlog into a series *(index and previous/next links)*
- [x] **🚀 Release v1.0** *(merged to main and tagged v0.1 to v0.5 and v1.0.0 with release notes on GitHub; the repo is still private under its old name and Pages is off, so the "go public" steps of v0.1 (hosted demo) are still to do)*

---

## ★ Stretch goals

- [ ] Simple 2D "watch the play" viewer for individual snaps
- [ ] Hot-seat multiplayer (several human GMs in one league) *(the owner's long-range vision, noted in Phase 14: a multiplayer league way down the road. Not a current goal. GM Mode keys decisions, delegation and the inbox by team; a league holds one person's career today, so a list of careers is the main change)*
- [ ] Rules editor: change the cap, kickoff rules, overtime, playoff size (rules-as-data makes this cheap)
- [ ] Prime-time slots, international games, flexible scheduling
- [ ] Custom name packs / league files shared by players
- [ ] Polished fully-fictional league as its own start option with generated history

---

## Ongoing tracks

### Calibration
- The **scorecard** (sim vs. real NFL, from nflverse) runs at the end of every phase that touches games, players, or coaches. It must stay green.
- Targets live in a committed file; refresh them when a new real season ends.

### Testing guardrails (keep growing these)
- Determinism: same league + seed + decisions → same history
- Cap invariants: cash paid equals cap charged over every contract's life; every team cap-compliant
- Roster legality after every transaction
- Schedule validator; tiebreaker worked examples
- Worked-example tests for every cap and roster rule
- Save/load round-trip
- Golden seeds: a few seeds with recorded key stats; big unexpected changes get flagged
- No-real-names check on every pipeline build

### Performance targets
- A full 272-game season in under 5 seconds in the browser (in the worker); the UI never freezes
- 100 seasons headless in minutes
- Save files for long leagues stay small enough to load quickly (budget set in Phase 18)

### UI consistency
- One component library and one table pattern from day one; every list is a sortable, filterable TanStack Table
- Every screen explains cap and roster terms with plain-English tooltips

### Devlog
- One entry per phase minimum: what was built, what surprised us, what broke, one screenshot.
