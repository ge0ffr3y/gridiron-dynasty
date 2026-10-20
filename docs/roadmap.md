---
tags:
  - project
  - football-sim
  - roadmap
status: planning
created: 2026-10-19
---

# FootballGM Sim — Roadmap

Back to: [[01 - Overview]]

> [!tip] How to use this roadmap
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
| 16 | Day One: the real 2026 start | Exact post–championship game LX starting state, fully validated | M | ✅ **v0.5** |
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
| Hosting: GitHub Pages or Vercel | Phase 0 | |
| Working title / app name | Phase 0 (placeholder ok) | "FootballGM Sim" as placeholder (rename before going public: "Football GM" is ZenGM's game) |
| League name, championship name, 32 team names, mascots, colors | Phase 6 | |
| Is the generated real-league file published in the public repo, or built locally only? | Phase 6 | |
| Real college names for prospects, or fictional schools? | Phase 11 | |
| Can more than one team be human-controlled? | Phase 14 | |
| How far back imported history goes (since 1920 vs. championship era + all-time record books) | Phase 15 | |
| Fully fictional league as an alternative start? | Phase 1 | *Effectively yes: it's how we build Phases 1–5* |
| Data licensing approach for the public release | Phase 18 (guardrails from Phase 6) | |

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
- [ ] Auto-deploy `apps/web` (GitHub Pages or Vercel) *(waiting on the hosting decision: Pages needs a public repo on the free plan)*
- [x] Create `docs/devlog/` with entry #0, and the Obsidian `03 - Devlog` note

### `CLAUDE.md` rules to include
- `sim-core` and `game-engine` never import browser APIs (no `window`, `document`, DOM, IndexedDB).
- Never use `Math.random()` or `Date.now()` in simulation logic. Use the seeded RNG streams. Use the shared math helpers for exp/log/pow.
- League time is the in-game calendar, never the real clock.
- **Rules as data:** every league rule (cap, roster limits, overtime, kickoffs, playoff format, tiebreakers) lives in the versioned `rules/` config. Every tuning number lives in config. Nothing hard-coded.
- **Money is integers** (whole dollars). Every cap or contract rule gets a unit test with a worked example.
- **Everything has a reason:** every AI decision, contract demand, and play call records why.
- **No real names or trademarks** in committed code or data: no real player/coach names, no NFL team names, logos, or "championship game". Restricted source data stays in `pipeline/private/` (gitignored).
- The league must stay **legal** after every action (roster sizes, cap compliance); validators run in tests.
- Run tests before every commit; never commit with failing tests.
- Explain changes in plain English for a non-programmer. Prefer simple, readable code over clever code.

### Done when
- [ ] The live URL shows the app shell titled "FootballGM Sim" with a light/dark toggle
- [x] The page shows "Sim worker: ready" (the worker round trip works)
- [x] CI is green on GitHub
- [x] The RNG determinism test passes

> [!example]- Kickoff prompt
> "We're starting FootballGM Sim, a pro football GM game and league simulator in TypeScript. Read the attached overview and roadmap. Phase 0: set up the npm-workspaces monorepo from the roadmap (sim-core, game-engine, web, runner, pipeline, rules, docs), the React + Tailwind + shadcn app shell, Vitest, a seeded RNG with named streams and a determinism test, deterministic math helpers with a lint ban on Math.random/Date.now, an integer money type, a Web Worker hello-world, CI, and deployment. Write CLAUDE.md with the roadmap's rules. Propose a plan first, then build step by step, explaining each step in plain English."

---

## Phase 1 — League skeleton & a generated league

**Goal:** A complete fictional league you can browse: 32 teams, ~2,800 players (90-man offseason rosters), coaches, all generated, saved in the browser.

### Steps
- [ ] **Data model:** League, Season, Conference, Division, Team, Player, Coach, Staff, Contract (stub), DraftPick, Transaction
- [ ] **Positions:** every NFL position (QB, RB, FB, WR, TE, OT, OG, C, EDGE, DT, LB, CB, S, K, P, LS, plus return roles) with **position flexibility** (e.g., a guard who can play center)
- [ ] **Rating model v1:** our own physical / technical / mental attributes and scale; position-specific overall formulas
- [ ] **Truth vs. perception layer:** ratings are stored as truth, but every screen reads through a "what your staff believes" layer (perfectly accurate for now, so scouting plugs in later without rewiring)
- [ ] **Hidden traits & personality fields** (potential, work ethic, consistency, injury proneness, durability, coachability, clutch; ego, loyalty, leadership, priorities, temperament), generated now, used in later phases
- [ ] **Player generator:** realistic size / speed / age / experience distributions by position
- [ ] **Coach generator** with placeholder attributes
- [ ] **Fictional name generator** (no duplicates within a league; later checked against a real-name blocklist)
- [ ] Placeholder team identities: 32 real cities in the real conference/division alignment, placeholder names
- [ ] **Rules config v1** (`rules/2026.json`) with schema validation (zod): league structure, roster limits; loaded and validated at startup
- [ ] **Decision-maker interface:** every team decision goes through a "decider" that can be AI or Human. This is how "one engine, two modes" works; stubbed for now
- [ ] Transaction / event log skeleton
- [ ] **Save/load:** leagues stored in IndexedDB (Dexie); export/import a compressed league file; round-trip test
- [ ] **UI:** New League dialog, league home, teams list, team page (roster table with TanStack Table: sort, filter), player page, coach page

### Done when
- [ ] "New League" creates a full fictional league in a few seconds
- [ ] You can browse every roster, sort by position or rating, and open any player or coach
- [ ] Reloading the browser keeps the league; export → import gives the same league
- [ ] Same seed → byte-identical league file (test)

> [!example]- Kickoff prompt
> "Phase 1: build the league skeleton and a generated fictional league as described in the roadmap. Keep all league logic in sim-core. Ratings must be stored as truth and read through a perception layer. Add the rules config v1 with schema validation, the AI/Human decision-maker interface stub, IndexedDB save/load with export/import, and the browse screens. Plan first."

---

## Phase 2 — Seasons, schedules & standings

**Goal:** Sim complete seasons with placeholder scores: real NFL schedule formula, standings, every tiebreaker, and the 14-team playoff.

### Steps
- [ ] **League calendar state machine:** offseason stages (stubs for now), preseason, regular-season weeks 1–18, playoff rounds, championship; an "advance" action moves through it
- [ ] **Schedule formula:** division home-and-away, rotating same-conference division, rotating other-conference division, two same-place games, the 17th game vs. an other-conference same-place finisher; rotation tables in rules config
- [ ] **Week assignment:** 17 games in 18 weeks, one bye per team inside the bye window, no conflicts; home/away balance (constraint solver)
- [ ] **Schedule validator** test that checks every formula rule
- [ ] **Placeholder game result:** team strength + home field + randomness → final score (replaced in Phase 3)
- [ ] **Standings:** W-L-T, win %, division / conference / common-game records, points for/against, streaks, strength of victory and schedule
- [ ] **Full NFL tiebreaker procedures** (two-club and three-plus-club, division, wild card, and draft order), coin toss via RNG; tests built from the NFL's published worked examples
- [ ] **Playoffs:** 7 seeds per conference, top-seed bye, reseeding, neutral-site championship
- [ ] **Draft order** from final standings and playoff exits
- [ ] **Sim controls** (in the worker, with progress): sim one week, to the trade deadline, to end of regular season, through the playoffs, full season
- [ ] **Season rollover:** archive the season, age everyone a year (placeholder), build next season's schedule from new standings
- [ ] **UI:** schedule & results, standings (division / conference / league), playoff picture during the season, playoff bracket, list of past champions
- [ ] **Headless runner v1:** `npm run sim -- --seasons 10 --seed 42`

### Done when
- [ ] Every team plays 17 games in 18 weeks with one bye, and the validator passes for 20 straight generated seasons
- [ ] Every tiebreaker worked-example test passes
- [ ] The standings and bracket look right after a full season
- [ ] 100 seasons (placeholder scores) run headless in under a minute

> [!example]- Kickoff prompt
> "Phase 2: implement the league calendar state machine, the NFL scheduling formula with a validator, standings, the full tiebreaker procedures with tests from the NFL's published examples, the 7-seed playoff, draft order, sim controls in the worker, season rollover, the schedule/standings/bracket screens, and headless runner v1. Game results are a placeholder strength-based score for now. Plan first."

---

## Phase 3 — Game engine I: core football

**Goal:** Replace placeholder scores with real snap-by-snap games that already produce believable basic stats.

### Steps
- [ ] **Game state:** quarter, clock, down, distance, ball spot, possession, score, timeouts, play log
- [ ] **Play types v1:** inside run, outside run, short / medium / deep pass, punt, field goal, extra point, 2-point try, kneel, spike
- [ ] **Play-calling v1:** a tendency table by down, distance, field position, score, and time (later owned by coordinators in Phase 10)
- [ ] **Resolution v1:** team-unit strengths (run blocking, pass protection, pass rush, coverage…) → outcome distributions: yards, completions, sacks, interceptions, fumbles
- [ ] **Clock rules:** running vs. stopped clock, two-minute warning, end of half / game, from rules config
- [ ] **Scoring:** touchdowns, field goals, safeties, extra points, 2-point conversions
- [ ] Basic kickoffs and punts; overtime per rules config
- [ ] **Player credit:** every play credits a passer / rusher / receiver / tackler
- [ ] **Box score and play-by-play text** (e.g., "2nd & 7 at SEA 34 — pass short right to #81 for 12 yards")
- [ ] **Stats:** player game / season / career stats; team stats
- [ ] **Calibration targets v1:** pipeline script downloads nflverse play-by-play (recent seasons), computes league averages (points, plays, yards per play, completion %, sack rate, interception rate, run/pass split, punts, FG %), saves them as a targets file (these are facts; safe to commit)
- [ ] **Calibration harness v1:** the runner sims N seasons and prints a **scorecard**: sim vs. real, with a pass/fail range for each stat
- [ ] Engine tests: determinism, score equals the sum of scoring plays, clock never negative, downs and distance always valid
- [ ] **UI:** game page with box score and scrollable play-by-play; scores link to games

### Done when
- [ ] Reading a play-by-play feels like real football
- [ ] The scorecard's core stats (points per game, yards per play, completion %, sack rate, turnovers) land inside real NFL ranges
- [ ] A full 272-game season sims in under 10 seconds
- [ ] Same seed → identical game, play for play

> [!example]- Kickoff prompt
> "Phase 3: build game-engine v1 as a separate package: game state, core play types, a tendency-table play caller, unit-strength resolution, clock and scoring rules from the rules config, player credit, box scores, play-by-play text, and stats. Add a pipeline script that computes real NFL calibration targets from nflverse play-by-play, and a runner scorecard comparing sim vs. real. Plan first."

---

## Phase 4 — Game engine II: matchups & play concepts

**Goal:** Games are decided by real football concepts and individual player matchups, so better players and smarter calls visibly matter.

### Steps
- [ ] **Offense:** personnel groupings (11, 12, 21, 10…), formations; run schemes (inside zone, outside zone, power, counter, duo, draw), pass concepts (quick game, dropback, play-action, screens, RPOs, deep shots)
- [ ] **Defense:** personnel (base, nickel, dime), fronts, coverage shells (Cover 0/1/2/3/4/6, man vs. zone), blitz packages
- [ ] **Line play:** individual pass-rush vs. pass-protection wins → time to pressure, pressures, sacks; run blocking → lane quality → yards before contact
- [ ] **Receivers vs. defenders:** separation by route and coverage for each target
- [ ] **Quarterback:** progression reads, decision (throw, check-down, throwaway, scramble), accuracy and ball placement
- [ ] **After the throw:** catch probability, contested catches, drops, yards after catch, broken and missed tackles
- [ ] **Turnovers** driven by decisions, accuracy, coverage, ball security, and hit power
- [ ] **Penalties:** pre-snap and during the play, accept/decline logic, realistic rates
- [ ] **In-game injuries** (simple severity for now; full model in Phase 9)
- [ ] **Fatigue & substitution:** snap shares, defensive line rotations, running back committees
- [ ] **Depth chart:** auto-built from ratings, editable by the user; position flexibility covers injuries
- [ ] **Expanded stats:** targets, air yards, pressures, pass breakups, missed tackles, snap counts
- [ ] **Advanced stats:** expected points model built from nflverse data; EPA, success rate, pressure rate, yards after contact
- [ ] **Calibration v2:** position-level distributions (passing / rushing / receiving / sack leaders, passer rating spread, team point-differential spread)
- [ ] **UI:** depth chart editor, league leaders, team and player advanced stats
- [ ] **🚀 Release v0.1:** deploy, README with screenshots, tag

### Done when
- [ ] Swapping an elite QB onto a bad team noticeably raises its scoring (in a test sim)
- [ ] Season leaderboards look like a real NFL season (yardage leaders, sack leaders, interception leaders in real ranges)
- [ ] A blitz-heavy defense produces more sacks *and* gives up more big plays
- [ ] Scorecard green for core and position-level stats

> [!example]- Kickoff prompt
> "Phase 4: deepen the game engine with personnel, formations, run and pass concepts, defensive fronts/coverages/blitzes, and individual matchup resolution (line play, separation, QB decisions, catch/YAC/tackling, turnovers, penalties, fatigue). Add the depth chart, expanded and advanced stats (EPA from an nflverse-based expected points model), and position-level calibration. Keep everything tunable from config. Plan first."

---

## Phase 5 — Game engine III: game management, special teams & the elements

**Goal:** Late-game situations, special teams, and weather all behave like the real thing, and situational stats match the real NFL.

### Steps
- [ ] **Special teams under the current rules** (kickoff format, touchback spots, onside rules, fair catches, all from rules config): distance and hang time, returns, coverage, blocks, muffs, fakes
- [ ] **Kicking:** range and accuracy by distance and weather; punter gross and net
- [ ] **Win probability model** (from nflverse data), used by game management and shown in the UI
- [ ] **Decision models:** 4th down (go / punt / kick), 2-point tries, driven by a coach-aggressiveness parameter around an analytics baseline
- [ ] **Clock management:** hurry-up, two-minute drill, kneel-downs, milking the clock, timeouts on both sides, spikes, challenges and replay review
- [ ] **Environment:** stadium table (dome / outdoor / retractable, surface, altitude), weather generated by city and week (temperature, wind, rain, snow) with effects on passing, kicking, and fumbles
- [ ] **Home-field advantage** (including crowd-noise false starts)
- [ ] **In-game adjustments:** halftime adjustments and coordinators adapting to what's working; momentum kept small and tunable (can be set to zero)
- [ ] **Situational calibration:** pass rate by down and distance, 4th-down go rates by field zone, 2-point rates, kickoff touchback and return rates, FG % by distance, end-of-half scoring
- [ ] **Performance pass:** profile and optimize; a full season in a few seconds
- [ ] **UI:** drive chart, win-probability chart, scoring summary, "watch live" text ticker with speed control
- [ ] **🚀 Release v0.2**

### Done when
- [ ] Scorecard green, including the situational targets
- [ ] Late-game behavior looks right in play-by-play: kneel-downs, timeouts, two-minute drives, onside kicks when trailing
- [ ] Cold, windy outdoor games score less and miss more kicks than dome games
- [ ] A full season sims in under 5 seconds

> [!example]- Kickoff prompt
> "Phase 5: add special teams under the current rules, a win-probability model, 4th-down and 2-point decision models, full clock management, stadiums and weather, home-field advantage, and in-game adjustments. Extend calibration to situational stats and hit the performance target. Add drive and win-probability charts and a live ticker. Plan first."

---

## Phase 6 — Real-league import I: people, ratings & names

**Goal:** Start a league from the real NFL as it stood at the end of the 2025 season, with every person renamed.

### Steps
- [ ] **Licensing guardrails first:** `pipeline/private/` (gitignored) holds Madden ratings and anything with restrictive terms; `docs/data-sources.md` lists every source, its license, and credits
- [ ] Decide whether the generated real-league file is committed publicly or built locally only (Decisions log)
- [ ] **Pipeline framework:** download → cache → transform → build, each step a script; reruns are reproducible; outputs versioned
- [ ] **nflverse import:** end-of-2025 rosters (including practice squads and injured players), bios (age, size, college, draft info, experience), snap counts, injuries
- [ ] **Player ID crosswalk** across sources, with an unmatched-players report; fixes go in a documented overrides file (data, not hand edits to outputs)
- [ ] **Ratings build:** Madden end-of-2025 ratings (private input) → mapped into our own rating model → adjusted with real performance data (play-by-play, Next Gen Stats, snap counts)
- [ ] **Hidden traits** generated from age, draft pedigree, and injury history
- [ ] **Sanity-check sheet:** top 10 at every position reviewed by hand
- [ ] **Career stats** imported so careers continue from their real numbers
- [ ] **Naming session:** league name, championship name, 32 team names, mascots, colors, simple generated logos/monograms
- [ ] **Fictional names** for every real person, one consistent mapping kept only inside the pipeline; automated check that no real name survives into any output
- [ ] **Coaching staffs** as of the end of the 2025 regular season (basic attributes; full traits in Phase 10)
- [ ] Stadiums and cities
- [ ] **League build:** outputs a starting league file (people, ratings, teams; contracts arrive in Phase 7)
- [ ] **UI:** New League offers "Real league (2026)" or "Fictional league"

### Done when
- [ ] The real league loads, and each team's roster is recognizable in shape (you can spot each team's real star by position, age, and stats, even renamed)
- [ ] Unmatched-player report is at or near zero
- [ ] The real-name check finds zero real names in any build output
- [ ] Rebuilding from scratch produces an identical league file
- [ ] A sim'd season with the real rosters still passes the calibration scorecard

> [!example]- Kickoff prompt
> "Phase 6: build the real-league data pipeline. Set up the licensing guardrails (private folder, data-sources doc) first. Import end-of-2025 rosters and bios from nflverse, build an ID crosswalk with an unmatched report, map Madden ratings (private input) into our rating model and adjust with real performance data, generate hidden traits, import career stats, generate fictional names with an automated real-name check, and build the starting league file. Plan first; flag any source licensing questions."

---

## Phase 7 — Contracts & the salary cap

**Goal:** The real cap, the real contract structures, and the real loopholes, with every team starting at its real cap situation.

### Steps
- [ ] **Rules config:** cap by year with a growth model, proration limit, minimum salaries by credited seasons, rookie wage scale, veteran-minimum benefit, cap rollover, minimum cash spending, offseason top-51 rule, likely vs. not-likely-to-be-earned incentive accounting and year-end adjustments. Every value verified against the CBA
- [ ] **Contract model**, year by year: base salary, signing-bonus proration, roster / option / workout / per-game roster bonuses, incentives, guarantees (full, injury-only, vesting dates), void years
- [ ] **Cap hit and dead money calculators:** release pre- and post-June 1, the June 1 designation, trades (remaining proration accelerates onto the trading team)
- [ ] **Operations:** sign, extend, restructure (convert salary to bonus), release, trade, pay cut, option exercise/decline, void-year acceleration
- [ ] **Tags & tenders:** franchise tag (exclusive / non-exclusive), transition tag, restricted free agent tenders with offer sheets and matching, exclusive-rights tenders
- [ ] **Rookie contracts:** wage scale by draft slot; fifth-year option for first-rounders
- [ ] **Cash vs. cap ledger:** every dollar tracked; invariant tests (cash paid over a contract's life equals its total cap charges)
- [ ] **Worked-example tests** for every rule (restructure, void-year acceleration, post-June 1 cut, tag math…)
- [ ] **Import real contracts** (nflverse / OverTheCap data); document assumptions where year-by-year detail is missing; import existing dead money
- [ ] **Validation report:** each team's 2026 cap space vs. its published real figure, within a tolerance
- [ ] **UI:** contract page (year-by-year table), team cap sheet (top 51, dead money, cap space for the next four years), "what if" panel showing savings and dead money *before* you cut, trade, or restructure

### Done when
- [ ] Team cap sheets match reality within tolerance for nearly every team (exceptions explained)
- [ ] Every worked-example test passes
- [ ] You can create cap room with a restructure and see next year's bill grow
- [ ] Cutting a player shows the correct pre- vs. post-June 1 dead money

> [!example]- Kickoff prompt
> "Phase 7: build the contracts and salary cap engine with every rule in the rules config, verified against the CBA. Model contracts year by year, compute cap hits and dead money for every operation, add tags/tenders and rookie contracts, keep a cash vs. cap ledger with invariant tests, and write a worked-example test for every rule. Then import real contracts and produce a validation report against published team cap space. Money is integers. Plan first."

---

## Phase 8 — Roster rules, transactions & the full calendar

**Goal:** The complete league year runs with every roster rule enforced, and rosters stay legal through every transaction.

### Steps
- [ ] **Full calendar:** new league year, re-signing and tag windows, combine, legal tampering, free agency, draft, undrafted signings, minicamps, training camp, preseason, cutdown, regular season, trade deadline, playoffs; all deadlines live (tag deadline, fifth-year option deadline, June 1…)
- [ ] **Roster limits** (offseason, regular season, game-day actives) from rules config, with a legality validator after every transaction
- [ ] **Practice squad:** size, eligibility, veteran exceptions, game-day elevations and their limits, signing players off other teams' practice squads
- [ ] **Reserve lists:** injured reserve with minimum stay and return designations, preseason injury lists
- [ ] **Waivers:** claim priority, waiver periods, vested-veteran rules
- [ ] **Trades:** players and picks (future picks several years out), cap checks, trade deadline
- [ ] **Preseason games** (optional per league) and **cutdown day**, with the waiver-claim rush after it
- [ ] **Simple AI roster upkeep** (fill holes, cut the lowest, sign rookies) so AI teams stay legal until Phase 13
- [ ] **UI:** transactions log, roster management (cut, IR, practice squad, elevations), basic trade builder with cap impact, calendar view of upcoming deadlines

### Done when
- [ ] 10 headless seasons with every roster legal at every check
- [ ] Cutdown day happens, waiver claims go through in the right order, rookies get signed
- [ ] You can make a trade and see both teams' cap impact before confirming

> [!example]- Kickoff prompt
> "Phase 8: build the full league-year calendar with live deadlines, roster limits with a legality validator, practice squad, reserve lists, waivers, trades, preseason and cutdown, and simple AI roster upkeep, all driven by the rules config. Add the transactions, roster management, trade builder, and calendar screens. Plan first."

---

## Phase 9 — Player lifecycle: development, aging, injuries & retirement

**Goal:** Careers rise and fall believably, and the league's talent stays stable over decades.

### Steps
- [ ] **Aging curves by position**, fit from real data (nflverse snaps and production by age)
- [ ] **Offseason development:** potential, work ethic, age, playing time, and coaching (hook for Phase 10)
- [ ] **Training camp:** development plus position battles that set the depth chart
- [ ] **In-season updates:** small weekly rating changes from performance, playing time, and health
- [ ] **Injury model:** types and body parts, severity, recovery-time distributions from real injury data, reinjury risk, long-term decline, injury reports (out / doubtful / questionable), medical staff hook
- [ ] **Retirement decisions:** age, decline, contract, titles won, injuries
- [ ] Career arcs and career stat tracking across seasons
- [ ] **Long-run calibration:** league age distribution, average career length by position, injured-reserve placements per team per season, all near real values
- [ ] **UI:** player rating-history charts, injury report, post-camp development report

### Done when
- [ ] A 30-season sim keeps the league's age and talent distributions stable (no rating inflation or collapse)
- [ ] Running backs decline earlier than quarterbacks; career lengths by position look real
- [ ] Stars have believable career arcs: rise, peak, decline, retire

> [!example]- Kickoff prompt
> "Phase 9: build player development, position aging curves fit from real data, training camp position battles, in-season rating updates, a full injury model calibrated to real injury data, and retirement. Add long-run calibration checks over 30 seasons and the player history / injury screens. Plan first."

---

## Phase 10 — Coaches & staff

**Goal:** Coaches become the strategy layer: who you hire decides how your team plays.

### Steps
- [ ] **Coach model:** offensive and defensive philosophies, game-management traits (4th-down aggressiveness, 2-point tendency, clock management, timeout use, run/pass balance, in-game adaptability, halftime adjustments), leadership traits (development, discipline, locker room, staff building), career history
- [ ] **Real coaches' traits derived from their teams' play-by-play** (pass rate over expected, 4th-down decisions vs. the model, tempo, 2-point rate, blitz and coverage tendencies where data allows)
- [ ] **AI play callers:** the offensive and defensive coordinators' traits now drive the engine's play calling; the head coach owns game management
- [ ] **Scheme fit:** each scheme defines what it wants at each position; fit changes on-field effectiveness and development
- [ ] **Position coaches** affect development; strength and medical staff affect injuries
- [ ] **Scouts** (accuracy, regional and positional expertise; used in Phase 11)
- [ ] **Staff market:** generated coaches, coach development and reputations
- [ ] **Coaching carousel:** firings, interview requests, interview rules from config, assistants poached as coordinators and head coaches
- [ ] **Coaching trees** recorded (who worked under whom)
- [ ] **UI:** staff page, coach profile with philosophy chart, hiring screen (candidates, interviews), scheme-fit badges on the roster

### Done when
- [ ] Two identical rosters with different coaching staffs play visibly differently (pass rate, 4th-down attempts, blitz rate)
- [ ] Changing coordinators moves players' scheme-fit ratings, and some players get better or worse
- [ ] Each offseason's number of head-coach changes lands in a realistic range
- [ ] Calibration scorecard still green with coaches calling plays

> [!example]- Kickoff prompt
> "Phase 10: build the coach model, derive real coaches' tendencies from nflverse play-by-play, make coordinators' traits drive the engine's play calling, add scheme fit, staff effects on development and injuries, scouts, the staff market, the coaching carousel, and coaching trees. Add staff and hiring screens. Re-run calibration. Plan first."

---

## Phase 11 — Scouting & the draft

**Goal:** You never see true ratings. Your scouts' accuracy decides how clearly you see prospects, and drafts produce real busts and gems.

### Steps
- [ ] **Perception for real:** scouted ratings = truth + noise; noise shrinks with scout quality, scouting budget and time spent, and the player's experience (veterans are clear, prospects aren't); confidence ranges shown in the UI
- [ ] **Real 2026 draft class import:** prospects (renamed) with combine measurables and profiles
- [ ] **Draft class generator** for 2027 on: class size, position mix, measurables, potentials; calibrated so value by draft slot matches real hit rates by round
- [ ] **Combine and pro days** as calendar events that reveal measurables
- [ ] **Scouting assignments:** send scouts by region and position; reports arrive over the season
- [ ] **Big boards:** yours (editable) and each AI team's (needs + philosophy; deepened in Phase 13)
- [ ] **Draft day:** pick clock, AI picks, trading up and down with pick values, draft log
- [ ] **Compensatory picks** approximating the real formula (free agents lost vs. signed, by contract size and playing time), awarded before the draft
- [ ] Rookie contracts signed on the wage scale; **undrafted free-agent** signing rush
- [ ] **Retro draft grades:** truth revealed over time; bust and steal tracking
- [ ] **UI:** draft room, big board, prospect pages (scouting report, combine results, confidence), mock drafts

### Done when
- [ ] In a 20-season sim, early first-rounders are far better on average than late-rounders, with real busts and late-round gems
- [ ] Hit rates by round fall in real ranges
- [ ] A better scout visibly tightens the confidence ranges
- [ ] Draft-day trades happen at sensible prices

> [!example]- Kickoff prompt
> "Phase 11: make the perception layer real (scouted ratings with noise driven by scouts, budget, and experience), import the real 2026 draft class, build a calibrated draft class generator, combine and pro days, scouting assignments, big boards, draft day with trades, compensatory picks, rookie and undrafted signings, and retro draft grades. Add the draft room and prospect screens. Plan first."

---

## Phase 12 — Free agency, negotiation & chemistry

**Goal:** Players are people: they want different things, their agents negotiate, and the market sets prices the way the real one does.

### Steps
- [ ] **Market value model** anchored to comparable contracts (position, tier, age), starting from the real contract market and updating as signings happen
- [ ] **Player priorities and personality** shape demands: money, guarantees, length, winning, role, coach, location
- [ ] **Agents** with styles: hardball, fair, relationship-driven, money-only
- [ ] **Negotiation:** offers (years, average salary, guarantees, structure), counteroffers, patience, walk-aways, with reasons shown
- [ ] **Re-signing window and in-season extensions**
- [ ] **Holdouts, hold-ins, and trade requests**
- [ ] **Legal tampering and free agency:** multi-team bidding over several days; player decision logic weighing all priorities
- [ ] **Restricted free agency** offer sheets and matching (rules from Phase 7)
- [ ] **Morale and locker-room chemistry:** winning, playing time, leaders, coach fit, contract disputes; effects kept small and calibrated
- [ ] Late free agency and the veteran-minimum market
- [ ] **UI:** negotiation screen, free-agent market board with interest levels, player mood indicators, locker-room page

### Done when
- [ ] Top free agents sign for amounts near real market ranges for their position and tier
- [ ] Lowball offers get rejected with an understandable reason
- [ ] Overpaying always works, and the cap sheet shows the cost
- [ ] A star in a contract dispute can hold out or request a trade

> [!example]- Kickoff prompt
> "Phase 12: build the market value model from comparable contracts, player priorities, agents, a negotiation system with reasons, re-signing and extensions, holdouts and trade requests, multi-day free agency bidding, RFA offer sheets, and morale/chemistry. Add the negotiation, market, and locker-room screens. Plan first."

---

## Phase 13 — AI general managers & owners (Simulation Mode complete)

**Goal:** 32 distinct AI front offices run the league for a century, and the trade AI can't be fleeced.

### Steps
- [ ] **GM philosophies** as parameter sets: analytics-driven, win-now, draft-and-develop, cap-aggressive, trade-happy, conservative
- [ ] **Team evaluation:** needs by position, contention window (contend / retool / rebuild), multi-year cap outlook
- [ ] **Offseason AI:** re-sign / tag / cut decisions, free agency strategy, draft boards, extensions, restructures (cap-aggressive teams use void years and pay later)
- [ ] **Trade AI:** player value (age, production, contract surplus value, position), pick value, needs; proposes and evaluates trades with reasons
- [ ] **Anti-exploit test suite:** a bot tries known fleecing patterns (two-for-one junk deals, injured players, contract dumps, pick-swap tricks, repeated small trades) and must fail
- [ ] **In-season AI:** waiver claims, injury replacements, trade-deadline buying and selling
- [ ] **Owners:** patience, budget, meddling, expectations; they hire and fire GMs and coaches with recorded reasons
- [ ] **Balance check:** no philosophy dominates absurdly; cap-aggressive teams sometimes land in cap hell
- [ ] **Simulation Mode UI:** hands-off start, sim N seasons, league overview, power rankings, GM and owner pages
- [ ] **100-season stability run** in the headless runner
- [ ] **🚀 Release v0.3** (Simulation Mode)

### Done when
- [ ] 100 seasons run with no crashes, every team cap- and roster-legal throughout
- [ ] Dynasties and rebuilds both happen; different GM types build visibly different teams
- [ ] The anti-exploit suite finds no clearly lopsided trade that the AI accepts
- [ ] AI owners fire and hire people for reasons you can read

> [!example]- Kickoff prompt
> "Phase 13: build AI GMs with distinct philosophies, team evaluation, full offseason and in-season AI, a trade AI with value models and reasons, an anti-exploit test suite, AI owners who hire and fire, and the Simulation Mode screens. Run a 100-season stability check. Plan first."

---

## Phase 14 — GM Mode career layer

**Goal:** Take over one team and live the job: deadlines, an owner watching, and the risk of getting fired.

### Steps
- [ ] **Start a career:** pick a team, meet the owner, see expectations
- [ ] **Inbox / decision queue:** every pending decision (tag deadline, offers, interview requests for your staff, trade proposals) with deadlines; the sim pauses when you must decide
- [ ] **Delegation and autopilot:** per area (depth chart, re-signings, draft, waivers), and "sim to the next decision"
- [ ] **Owner relationship:** patience, budget, approval of your moves, job security meter; getting fired; job offers from other teams; continuing the career elsewhere
- [ ] **Your GM career page:** record, titles, trades, draft history
- [ ] Decide on more than one human team (Decisions log); if yes, multiple human deciders
- [ ] Save slots, autosave, league export
- [ ] **Onboarding:** first-season guided tips, glossary of cap and roster terms in plain English
- [ ] **🚀 Release v0.4** (GM Mode)

### Done when
- [ ] You can play three full seasons as one team without needing a spreadsheet
- [ ] Missing expectations gets you fired, and you can take another job
- [ ] Delegated areas are handled sensibly by your staff

> [!example]- Kickoff prompt
> "Phase 14: build the GM Mode career layer: team selection, the inbox/decision queue with deadlines, delegation and autopilot, the owner relationship and job security with firing and new job offers, a GM career page, save slots, and onboarding with a plain-English glossary. Plan first."

---

## Phase 15 — League history & storytelling

**Goal:** The league has a past and makes its own: awards, records, legends, and a newsfeed that tells the story.

### Steps
- [ ] Decide history scope (Decisions log)
- [ ] **Import real history** (renamed via the same mapping): champions, standings, award winners, Hall of Famers, all-time and single-season record books, franchise records
- [ ] **Awards:** MVP, Offensive / Defensive Player of the Year, Offensive / Defensive Rookie of the Year, Coach of the Year, Comeback Player, All-Pro, Pro Bowl; voting that mimics media voters
- [ ] **Record book** (game, season, career; team and league) with "record broken" events
- [ ] **Hall of Fame voting** with real eligibility timing
- [ ] Retired numbers, franchise history pages, dynasty and drought detection
- [ ] **Coaching tree viewer** (family-tree style, reusing the phylogeny viewer idea)
- [ ] **Newsfeed:** weekly storylines from real sim events (trades and reactions, signings, injuries, award races, hot seats, streaks)
- [ ] Season recap pages

### Done when
- [ ] After 20 seasons, the history pages read like a real league almanac
- [ ] Breaking a real-era record (renamed) shows up in the newsfeed
- [ ] Hall of Fame classes look right: the best careers get in

> [!example]- Kickoff prompt
> "Phase 15: import real league history through the pipeline (renamed), build awards voting, the record book with record-broken events, Hall of Fame voting, franchise histories, the coaching tree viewer, and a newsfeed generated from sim events. Plan first."

---

## Phase 16 — Day One: the real 2026 start

**Goal:** The real-league start is exactly right: the day after championship game LX, with everything as it actually stood.

### Steps
- [ ] Start date is the day after the 2025 championship (Feb 9, 2026); Seattle champion, New England runner-up, playoff results stand
- [ ] **Coaching staffs as of the end of the 2025 regular season**, so the real carousel's decisions happen in the sim instead
- [ ] **Real 2026 free-agent class** (expiring contracts), **real 2026 draft order** including traded and compensatory picks, real 2026 opponents, the real 2026 cap
- [ ] **Automated Day One validation report:** per team, roster size, cap space vs. real, picks owned vs. real, pending free agents vs. real
- [ ] "Where things stand" intro screen for a new real-league save
- [ ] **Rebuild guide:** how to rerun the pipeline for a 2027 start

### Done when
- [ ] The validation report passes for all 32 teams (or lists explained exceptions)
- [ ] The first screen of a new real-league save matches what a fan would expect on Feb 9, 2026 (renamed)

> [!example]- Kickoff prompt
> "Phase 16: make the real-league start exact. Set the start date and staffs, the real 2026 free-agent class, draft order with traded and compensatory picks, opponents, and cap. Build an automated per-team validation report against the real figures, an intro screen, and a pipeline rebuild guide. Plan first."

---

## Phase 17 — Experiments & analytics

**Goal:** Turn the league into a tool for answering questions, with statistics behind each claim.

### Steps
- [ ] **Experiment files:** JSON describing start, settings, seeds, number of seasons, and metrics
- [ ] **Parallel runner:** many seeds across all CPU cores
- [ ] **Analytics pages** in the web app: compare groups with charts and confidence intervals
- [ ] Headline experiments:
  - [ ] **Alternate histories:** the 2026 season 1,000 times from the real start; title odds per team
  - [ ] Cap-aggressive vs. conservative GMs: more titles, or sooner rise and harder collapse?
  - [ ] Draft-and-develop vs. free-agency spending over 20 years
  - [ ] A great head coach vs. a great quarterback, in wins
  - [ ] Aggressive 4th-down coaches vs. conservative ones
  - [ ] How random is a single-elimination playoff? How often does the best team win?

### Done when
- [ ] Each headline experiment has a clear chart and a written conclusion

> [!example]- Kickoff prompt
> "Phase 17: build experiment files, a parallel headless runner, and analytics pages with confidence intervals. Then run the headline experiments from the roadmap and write up each with a chart and conclusion. Plan first."

---

## Phase 18 — Ship it

**Goal:** A polished, public, portfolio-grade v1.0.

### Steps
- [ ] **Data licensing review resolved** and recorded: exactly what's published, what's built locally, and credits
- [ ] **Trademark sweep:** automated check for NFL names, team names, "championship game", logos across code, data, and UI
- [ ] **Performance & save size:** budget for a 50-season save; keep box-score summaries, prune old play-by-play; fast load times
- [ ] Accessibility pass; usable layouts for the main screens on a phone
- [ ] **README:** screenshots / GIFs, architecture diagram, how to play, how to rebuild the data
- [ ] Portfolio page and the findings write-up from Phase 17
- [ ] Tidy the devlog into a series
- [ ] **🚀 Release v1.0**

---

## ★ Stretch goals

- [ ] Simple 2D "watch the play" viewer for individual snaps
- [ ] Hot-seat multiplayer (several human GMs in one league)
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
