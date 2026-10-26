---
tags:
  - project
  - football-sim
  - simulation
  - sports-management
status: planning
created: 2026-10-19
updated: 2026-10-19
working_title: TBD
---

# FootballGM Sim — Overview

> [!abstract] Elevator pitch
> A pro football league that mirrors the real NFL down to the fine print, **starting from the real league as it stood after the 2025 season**, with every name made fictional. Two ways to experience it:
> - **GM Mode:** take over one franchise for the 2026 offseason. Hire coaches whose personalities and philosophies shape how your team plays, then build the roster through contracts, the cap, free agency, trades, and the draft. Survive long enough to build a dynasty, or get fired.
> - **Simulation Mode:** hand all 32 teams to computer GMs and fast-forward a week, a season, or a century, watching history diverge from reality.
>
> Every game is simulated **snap by snap** by a real play-by-play engine.

Next: [[02 - Roadmap]]
Sibling projects: [[Projects/Evolution Sim Project/01 - Overview|Evolution Sim]] · [[Projects/CivSim/01 - Overview|CivSim]]

---

## Goals

- **Start from reality.** Real rosters, real skill levels, real contracts and cap situations, real draft order, real league history. Only the names are fictional.
- **Genuine football.** A play-by-play engine where formations, play calls, matchups, fatigue, weather, and clock management all matter, producing stats that look like real NFL stats.
- **NFL-accurate front office.** The real cap rules, contract structures, and roster rules, including the loopholes. If NFL teams can exploit it, so can you (and so can the AI).
- **Coaches as the strategy layer.** You don't call plays. You hire the people who do, and their traits decide how your team plays.
- **One engine, two modes.** GM Mode is simply Simulation Mode where one team's decisions come from you instead of the AI.
- **A living league history** that continues from the real one: awards, records, Hall of Fame, coaching trees, dynasties, and a newsfeed.
- **Portfolio-grade rigor.** Calibrated against real NFL statistical averages, with experiments on what team-building strategies actually win.

## Non-goals

- Not an action game. You never control players on the field.
- Not a graphics showcase. Clean tables, good charts, readable play-by-play. A simple 2D play viewer is a late stretch goal.
- No real names or trademarks. Real cities are fine; team names, mascots, the league name, the championship name, logos, and every player and coach name are fictional. Mascots get named during the build.

---

## Starting state: the real league after the 2025 season

The simulation begins **the day after the 2025 championship game** (Feb 8, 2026), where Seattle beat New England 29–13. Seattle is the reigning champion; New England is the runner-up.

What carries over from reality, all renamed:

- **Every team's roster** as of the end of the 2025 season, including practice squads and injured players
- **Player skill levels** reflecting the real players, the way Madden does (see [[#Data sourcing & the real-league import|data sourcing]])
- **Every contract** as it stood: salaries, bonuses, guarantees, void years, and existing dead money, so every team starts with its real cap situation
- **Pending free agents:** players whose contracts expire after 2025 form the real 2026 free-agent class
- **The 2026 draft order,** including traded picks and compensatory picks
- **The 2026 draft class:** real college prospects (renamed) with their measurables and scouting profiles. Every later draft class is generated.
- **Coaching staffs** as of the end of the 2025 regular season, so the **coaching carousel happens in the sim** and you get to make the hiring decisions. Playoff and championship results still stand.
- **League history:** past champions, franchise records, all-time and single-season record books, award winners, and Hall of Famers, all with fictional names

From that first offseason on, history diverges from reality.

### The fictional names
- Every real person (current players, coaches, historical players and coaches) gets a **generated fictional name**.
- One consistent mapping is used everywhere, so a record holder in the history books is the same fictional person in every screen.
- The mapping from real to fictional names is internal to the data pipeline and never shown in the game.

---

## Core design principles

1. **Rules as data.** League rules (cap, contracts, roster limits, overtime, kickoffs, playoff format, tiebreakers) live in a versioned rules config sourced from the CBA and the rulebook, not scattered through the code. When the real NFL changes a rule, we update the config.
2. **Truth vs. perception.** Every player has *true* ratings the user never sees directly. You see *scouted* estimates, and their accuracy depends on your scouts, coaches, and how much you've watched the player. Established veterans are easy to read; prospects aren't. Draft busts and hidden gems emerge naturally.
3. **Everything has a reason.** Contract demands, AI trades, play calls, and player development all record *why*, so outcomes are explainable, not random.
4. **Exploitable on purpose, but fair.** The AI can exploit the cap too. Its GMs differ in how aggressively they do it, and some will pay the price later.
5. **Determinism.** Same starting data + same seed + same decisions = same league history.
6. **Calibrated realism.** League-wide averages (points, yards per play, completion %, sacks, penalties, 4th-down attempts…) are measured against real NFL ranges and tuned until they match.
7. **Reproducible data pipeline.** The starting league is built by scripts from documented sources, never hand-edited, so it can be rebuilt for a new season.

---

## The two modes

### GM Mode (playable)
- Pick any team and take over for the 2026 offseason
- **Owner relationship:** owners have patience, budgets, and expectations. Fall short for too long and *you* get fired.
- **Coaching staff:** hire/fire head coach, coordinators, position coaches, scouts, medical/training staff
- **Roster:** depth chart, position battles in camp, practice squad, injured reserve, waivers, cuts
- **Contracts:** negotiate with players and their agents; extensions, restructures, tags, releases
- **Free agency:** legal tampering window, bidding against AI teams, player priorities beyond money
- **Draft:** scouting budget, combine, big board, draft-day trades, rookie contracts, undrafted free agents
- **Trades:** players and picks, including the money and dead cap that come with them
- **Sim control:** play week by week, or auto-sim chunks with your team on autopilot or decisions queued

### Simulation Mode (pure sim)
- All 32 teams run by AI GMs with distinct front-office philosophies
- Advance by week, season, or many seasons
- AI owners hire and fire GMs and coaches; coaching carousels happen on their own
- Full league history, records, and analytics accumulate for decades

---

## League structure

- **32 teams** in the same cities and divisions as the NFL; fictional names and mascots
- **2 conferences × 4 divisions** of 4 teams
- **17 games over 18 weeks** (one bye per team), following the NFL scheduling formula:
  - 6 division games (home and away)
  - 4 vs. a rotating division in the same conference
  - 4 vs. a rotating division in the other conference
  - 2 vs. same-place finishers in the remaining same-conference divisions
  - 1 "17th game" vs. a same-place finisher from an other-conference division
- **The 2026 schedule** uses the real 2026 opponent pairings (they're determined by the formula and 2025 standings); later seasons are generated by the formula
- **Playoffs:** 7 teams per conference, top seed gets a bye; wild card, divisional round, conference championships, and the championship game
- **Full tiebreaker procedures** for division titles, wild cards, and draft order
- Prime-time slots, international games, and preseason are optional extras

---

## Players

- **Positions:** every NFL position, with position-specific ratings and position flexibility (e.g., a guard who can play center)
- **Ratings:**
  - Physical: speed, strength, agility, size, endurance
  - Technical: route running, pass blocking, coverage, tackling…
  - Mental: awareness, decision-making, football IQ, composure
- **Hidden traits:** potential, work ethic, consistency, injury proneness, durability, coachability, clutch
- **Personality:** ego, loyalty, leadership, money vs. winning vs. role vs. location priorities, temperament
- **Progression & regression, all career long:**
  - **In-season:** small rating changes week to week based on performance, playing time, and health (like Madden's in-season updates)
  - **Offseason:** larger development jumps or declines driven by age, potential, work ethic, and coaching
  - **Aging curves by position** (running backs decline earlier than quarterbacks, etc.)
- **Injuries:** types, severity, recovery time, reinjury risk, long-term decline
- **Careers:** retirement decisions, career stats (continuing from real career stats), awards, Hall of Fame voting

---

## Coaches & staff

Every coach has traits, qualities, and football philosophies. Real coaches (renamed) get traits derived from how their real teams actually played; new coaches are generated. **Hiring is your strategy.**

- **Offensive philosophies:** e.g., West Coast, Air Raid, Spread/RPO, Power Run, Wide Zone/play-action, Vertical
- **Defensive philosophies:** e.g., 4-3, 3-4, Cover 2/Tampa 2, Cover 3, man-heavy pressure, hybrid/multiple
- **Game-management traits:** 4th-down aggressiveness, 2-point tendencies, clock management, timeout use, run/pass balance, adaptability during a game, halftime adjustments
- **Leadership traits:** player development, discipline, locker-room management, staff building
- **Scheme fit:** players are more (or less) effective depending on how well they fit what the coordinators run. Changing coaches can make good players bad and vice versa.
- **Play calling is AI:** in games, coordinators call plays based on their philosophy, tendencies, and the situation
- **Coaching trees:** assistants gain experience and get poached by other teams as coordinators and head coaches. Interview requests for *your* staff are part of the offseason.
- **Scouts:** accuracy, regional and positional expertise; better scouts mean clearer prospect pictures

---

## The play-by-play engine

The heart of the project. Every snap:

1. **Situation:** down, distance, field position, score, clock, timeouts, weather, fatigue, momentum
2. **Offensive call:** personnel package, formation, play concept (run scheme, pass concept, screen, play-action, RPO), chosen by the coordinator AI
3. **Defensive call:** personnel, front, coverage shell, blitz or not, chosen by the defensive coordinator AI
4. **Resolution through matchups:**
   - Offensive line vs. pass rush/run defense (blocking wins, pressures, sacks, run lanes)
   - Receivers vs. defensive backs (separation by route and coverage)
   - Quarterback progression, decision, accuracy, ball placement
   - Catch, yards after catch, tackling, broken tackles
   - Fumbles, interceptions, penalties (pre-snap and during the play), injuries
5. **Special teams** under current rules: kickoffs, punts, field goals, extra points, 2-point tries, returns, onside kicks, blocks
6. **Clock & game management:** hurry-up, two-minute drill, kneel-downs, timeouts, challenges, current overtime rules
7. **Environment:** home-field advantage, dome vs. outdoor, cold, wind, rain, snow, altitude

**Outputs:** readable play-by-play, box scores, drive charts, team and player stats, and advanced stats (expected points added, success rate, pressure rate, etc.).

**Calibration:** real NFL play-by-play data gives the targets. League averages and situational tendencies (e.g., pass rate on 3rd-and-long, 4th-down go rates) should land in real ranges.

**Performance target:** a full season (272 games) simulates in seconds, so decades of history are practical.

---

## Contracts & the salary cap

> [!important] Goal: as exploitable as the real thing
> Follow the real rules as closely as reasonable, so the creative cap accounting real teams use works here too, with real consequences.

- **Contract components:** base salary, signing bonus (prorated over up to five years), roster bonuses, option bonuses, workout bonuses, incentives (likely vs. not-likely-to-be-earned), per-game roster bonuses
- **Guarantees:** fully guaranteed, injury-only, and guarantees that become locked in on set dates
- **Void years:** dummy years that spread bonus money out and accelerate into dead money when they void
- **Restructures:** converting salary into bonus to create cap space now (and pain later)
- **Extensions**, releases (pre- and post–June 1, including the June 1 designation), and the dead money they create
- **Cap mechanics:** yearly cap that grows with league revenue, cap rollover of unused space, minimum spending requirements, trade cap consequences
- **Tags & tenders:** franchise tag (exclusive / non-exclusive), transition tag, restricted and exclusive-rights free agent tenders
- **Rookie contracts:** rookie wage scale by draft slot, fifth-year option for first-rounders
- **Minimum salaries** by years of experience, veteran minimum cap benefits
- **Compensatory draft picks** based on free agents lost vs. signed

## Roster rules

- Offseason roster limit, regular-season roster limit, game-day active list
- Practice squad, including elevations to the game-day roster
- Injured reserve and return designations; preseason injury lists
- Waivers and claim priority; roster cutdown day
- Trade deadline
- Exact numbers come from the rules config and get verified against the current CBA and rulebook when that system is built.

---

## The league calendar

**Start here (day after the 2025 championship):** coaching carousel (firings, interviews, hires) → scouting combine → re-signing and tag window → legal tampering → **free agency** → **draft** → undrafted free agents → rookie signing → offseason workouts and **training camp** (development, position battles) → preseason → **roster cutdown** → regular season → **trade deadline** → playoffs → championship → repeat.

---

## Negotiation, personalities & chemistry

- **Agents** with their own styles: hardball, fair, relationship-driven, money-only
- **Player priorities:** money, guaranteed money, contract length, winning, role, coach, location
- **Market comparables:** demands are anchored to what similar players recently got, starting from the real contract market
- **Holdouts, trade requests,** and disgruntled stars
- **Morale and locker-room chemistry,** affected by winning, playing time, leaders, coach fit, and contract disputes

## AI general managers

Each AI GM has a front-office philosophy:
- Analytics-driven, win-now, draft-and-develop, cap-aggressive ("the bill comes due later"), trade-happy, conservative
- Their own draft boards, needs, trade valuations, and cap strategies
- Trade AI that values players and picks sensibly, so the user can't fleece it the way older GM games allow
- AI owners judge AI GMs and coaches by the same standards they judge you

---

## League history & storytelling

- **Real history first:** past champions, franchise records, record books, award winners, and Hall of Famers carried over (renamed), so new records are measured against real ones
- Awards: MVP, Offensive/Defensive Player of the Year, Rookie of the Year, Coach of the Year, Comeback Player, All-Pro, Pro Bowl
- Records (game, season, career), Hall of Fame, retired numbers
- Team histories, franchise records, dynasties and droughts
- **Coaching trees** as family trees (reusing the phylogeny viewer idea from the other sims)
- **Newsfeed:** weekly storylines, trade and signing reactions, injury news, award races, hot seats

---

## Data sourcing & the real-league import

A **data pipeline** (scripts in the repo) builds the starting league file from public sources. Nothing is hand-edited; the pipeline can be rerun for a future starting season.

| Data | Likely source |
|---|---|
| Rosters, depth charts, injuries, snap counts | nflverse (open-source NFL data project) |
| Play-by-play since 1999, Next Gen Stats, advanced stats | nflverse |
| Contracts | nflverse (carries OverTheCap contract data); check whether it has the year-by-year detail void years and dead money need |
| Draft picks, combine results, trades | nflverse |
| Player skill baseline | Madden ratings (e.g., the end-of-2025-season roster update) as a reference |
| League history and record books | Compiled from public records |
| Coach tendencies | Derived from real play-by-play (pass rates, 4th-down decisions, tempo) |

### How player ratings get built
1. **Baseline:** Madden-style ratings as the starting reference for each real player
2. **Map into our own rating model:** our attributes and scale are our own, not a copy of Madden's
3. **Adjust with real performance data:** play-by-play, Next Gen Stats, and snap counts nudge ratings toward what players actually did
4. **Generate hidden traits:** potential, work ethic, injury proneness, etc., informed by age, draft pedigree, and injury history
5. **Sanity-check** the top players at each position by hand

> [!warning] Data licensing (to resolve before publishing)
> Madden ratings are EA's proprietary work, and many stats sites restrict scraping in their terms. Facts (scores, stats, contract figures, records) are generally fine to use. The safer approach:
> - Use Madden ratings only as a private **input** to the pipeline, not as a dataset republished in the public repo
> - Publish the pipeline code; decide separately whether the generated league file is committed publicly
> - Prefer sources with clear open licenses (nflverse) wherever possible, and credit them
> - Not legal advice: worth a closer look before the public release

---

## What sets it apart from Football GM

Football GM (by ZenGM) is the obvious reference: a browser-based fictional football league game. We study it as players, not copy it. Our differentiators:

1. **Starts from the real NFL:** real rosters, skill levels, contracts, cap situations, and history, renamed
2. **Deeper play-by-play engine:** formations, concepts, and snap-by-snap matchup resolution, calibrated to real NFL data
3. **Coaches as strategy:** philosophies (derived from real tendencies), scheme fit, AI play callers, and coaching trees
4. **Real cap complexity:** void years, restructures, June 1 designations, tags, incentives, and the cap hell that follows
5. **Scouting uncertainty:** true ratings vs. what your staff thinks
6. **People, not just ratings:** agents, personalities, priorities, holdouts, chemistry
7. **Distinct AI front offices** with their own philosophies and a trade AI that's hard to exploit
8. **Analytics and experiments:** run 100-season leagues to measure which team-building strategies actually win

---

## Tech stack

> [!info] Decision: same core stack as the other sims, plus a real UI framework
> This project is far more UI-heavy (tables, forms, negotiations), so it adds React and a component library on top of the familiar TypeScript foundation.

| Layer | Choice |
|---|---|
| Language | TypeScript |
| Simulation core | Pure TS package: league, rules, game engine, AI. No browser code. Seeded RNG. |
| Data pipeline | Node scripts that download public data and build the starting league file |
| UI | React + Tailwind + shadcn/ui components |
| Big tables | TanStack Table (sorting, filtering, thousands of rows) |
| Charts | Observable Plot / uPlot |
| Saved leagues | IndexedDB in the browser (via Dexie), with export/import of league files |
| Simulation runtime | Web Worker, so the UI never freezes during a season sim |
| Headless runner | Node CLI for calibration runs and 100-season experiments |
| Testing | Vitest: cap math, contract accounting, tiebreakers, schedule formula, determinism, calibration checks |
| Hosting | GitHub Pages or Vercel. No backend, no server costs. |

### Repo layout (planned)
```
football-sim/
├── packages/
│   ├── sim-core/      # league, rules config, contracts, cap, AI GMs
│   └── game-engine/   # play-by-play engine (separately testable + calibratable)
├── apps/
│   ├── web/           # the game: GM Mode + Simulation Mode UI
│   └── runner/        # headless calibration + experiments
├── pipeline/          # real-league import: download, rate, rename, build league file
├── rules/             # versioned rules configs (cap, roster, OT, kickoff…)
├── docs/
├── CLAUDE.md
└── README.md
```

---

## Science / analytics angle (experiment ideas)

- **Alternate histories:** simulate the 2026 season 1,000 times from the real starting point. How often does each team win it all?
- Do cap-aggressive teams (void years, constant restructures) win more championships, or just win sooner and collapse harder?
- Draft-and-develop vs. free-agency spending: which wins over 20 years?
- How much is a great head coach worth in wins, compared to a great quarterback?
- Do analytics-aggressive 4th-down coaches outperform conservative ones?
- How "random" is a single-elimination playoff? How often does the best team win the title?

---

## Known risks

- **Scope.** This is the biggest of the three projects. The play engine and the data pipeline are each projects. Each phase must produce something usable.
- **Data work.** Matching players across sources, filling gaps in contract detail, and compiling history is tedious. Budget real time for it.
- **Data licensing.** See the warning above. Resolve before the public release.
- **Calibration.** A play-by-play engine that produces unrealistic stats (300-yard rushing games every week) breaks immersion. Needs a dedicated calibration harness.
- **AI exploitability.** Classic GM-game failure: users fleecing the AI in trades or free agency. Trade and negotiation AI need serious attention and testing.
- **Rules accuracy.** The cap rules are intricate. Every rule gets unit tests with worked examples.
- **UI load.** Dozens of screens. Use a component library and consistent patterns from day one.
- **Trademarks.** Real cities are fine; avoid NFL names, team names, logos, and the league's trademarked championship name.

## Open questions

- League name, championship name, and team names/mascots (to be decided during the build)
- How far back the imported history goes: full history since 1920, or the championship era plus all-time record books?
- Can more than one team be human-controlled (e.g., for friends)?
- Should the game also offer a fully fictional generated league as an alternative start?
- How long a league should run before performance or save size becomes an issue
- Stretch: a simple 2D "watch the play" viewer for individual snaps
