# Changelog

Releases follow the roadmap's release points. Each entry says what a person can do that they couldn't before; the devlog has the detail ([index](docs/devlog/README.md)). Versions before 1.0.0 are tagged retroactively on the commit where that point was reached.

## 1.0.0: Ship it (Phase 18)

- **Named and licensed:** Gridiron Dynasty: GM Simulator, MIT license, credits and a software list on the About page, a finished data-sources document.
- **Safe to publish:** a CI test that hashes every real club nickname and real person's name and fails if one appears anywhere in the repository; builds can't include the private real-league file; "Pro Bowl" became "All-Star Game" and placeholder conference names became real fictional ones.
- **Saves:** a 50-season save went from 106 MB to 34 MB (old transaction logs pruned, past scores kept compactly, backups gzipped). Format 22.
- **Speed:** about 40% less time in a league year with byte-identical results; the first page download fell from 866 KB to about 300 KB.
- **Accessibility:** skip link, labelled landmarks, one heading per page, titles that follow the page, real tabs and radio groups, table captions and sort state, full-strength focus rings, reduced motion, announced errors and loading. No axe violations across 28 routes, light and dark.
- **Phones:** no sideways scrolling on 34 routes at 375 px; pinned name column; charts draw at their container's width.
- **Docs:** a new README, a portfolio page, a performance page, a devlog index.

## 0.5: Day One (Phase 16, 2026-10-23)

- A new real league opens on the morning after the 2025 championship, with the real 2026 schedule and picks, and its own coaching carousel on each save's seed.

## 0.4: GM Mode (Phase 14, 2026-10-23)

- Take over one team: a decision inbox with deadlines, delegation of whole areas to your staff, an owner who judges your results and spending, getting fired, job offers, a glossary.

## 0.3: Simulation Mode (Phase 13, 2026-10-23)

- AI general managers with philosophies and owners with patience run all 32 teams, with an exploit-resistant trade market and a balance check across GM types. Sim any number of seasons.

## 0.2: Game management and the elements (Phase 5, 2026-10-20)

- Win probability, fourth-down and two-point decisions, reviews and challenges, the current kickoff rules, punts and field goals, stadiums and weather, a live play-by-play ticker.

## 0.1: The matchup engine (Phase 4, 2026-10-20)

- Formations, coverages, line play, quarterback reads and penalties decide each snap; depth charts, fatigue, in-game injuries, advanced stats and league leaders.

## Before 0.1

Phases 0 to 3: the project skeleton and guardrails, a fictional league, seasons, schedules, standings, playoffs and the draft order, and the first snap-by-snap engine.

## Between the releases

- **0.2 to 0.3:** Phases 6 to 12: the real-league import, contracts and the cap, the League Year and roster rules, development, aging and injuries, coaches and the carousel, scouting and the draft, free agency, moods and holdouts.
- **0.4 to 0.5:** Phase 15, league history: awards, records, the Hall of Fame, the newsfeed and the almanac.
- **0.5 to 1.0:** a record book for every club (15c) and the experiments (Phase 17).
