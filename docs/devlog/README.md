# Devlog

One entry per phase (some phases have two or three), written when the phase was done: what was built, what surprised us, what broke, how it was checked. The plan these follow is the [roadmap](../roadmap.md); the project on one page is the [portfolio page](../portfolio.md).

| Entry                                                                                | What it added                                                                                         |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| [0: Foundations](0000-foundations.md)                                                | The monorepo, the seeded random streams, exact money and math, the worker bridge and the guardrails.  |
| [1: A league to browse](0001-league-skeleton.md)                                     | A whole fictional league: 32 teams, players with ratings, coaches, draft picks, saved in the browser. |
| [2: The league plays seasons](0002-seasons.md)                                       | The calendar, the schedule formula, standings, tie-breakers, playoffs and the draft order.            |
| [3: Real football](0003-game-engine.md)                                              | The snap-by-snap game engine, calibrated against real play-by-play.                                   |
| [4a: Matchups](0004a-matchup-engine.md)                                              | Formations, matchups and individual players decide plays.                                             |
| [4b: The people around it](0004b-people.md)                                          | Depth charts, fatigue, substitutions and in-game injuries.                                            |
| [5a: Game management](0005a-game-management.md)                                      | Win probability, fourth-down and two-point decisions, reviews and challenges.                         |
| [5b: Special teams and the elements](0005b-special-teams-weather.md)                 | Kickoffs, punts, field goals, stadiums and weather.                                                   |
| [6a: Real rosters](0006a-real-rosters.md)                                            | The real league's rosters as a starting file, every name made fictional.                              |
| [6b: Real ratings](0006b-real-ratings.md)                                            | Ratings from performance, team strength from results, careers back to 1999.                           |
| [7a: The cap and contract engine](0007a-cap-engine.md)                               | The salary cap and the contract engine, with a worked example for every rule.                         |
| [7b: Real contracts and the cap screens](0007b-real-contracts.md)                    | Every team's real contracts and cap situation, and the cap screens.                                   |
| [8a: The League Year and the roster rules](0008a-league-year.md)                     | The League Year: free agency, the draft, camp, cutdown, practice squads and injured reserve.          |
| [8b: Trades and the roster screens](0008b-trades-and-roster-screens.md)              | Trades and the roster-management screens.                                                             |
| [9a: Players grow, age and retire](0009a-development-aging-retirement.md)            | Players grow, decline and retire along the real age curves.                                           |
| [9b: Injuries, the injury report, and seeing careers](0009b-injuries-and-screens.md) | Injuries, the weekly injury report and career-arc charts.                                             |
| [10a: Coaches call the plays](0010a-coaches-call-the-plays.md)                       | Coaches with philosophies call the plays; players fit schemes.                                        |
| [10b: The coaching carousel](0010b-coaching-carousel.md)                             | Coaches have careers: firings, searches, hires and coaching trees.                                    |
| [11a: Scouting and draft classes](0011a-scouting-and-classes.md)                     | Scouting, noisy draft boards and the prospect classes.                                                |
| [11b: Draft day](0011b-draft-day.md)                                                 | The draft as an event: boards, trades, compensatory picks.                                            |
| [12a: Free agency and negotiation](0012a-free-agency.md)                             | Agents, demands, offers, free agency, tags and tenders.                                               |
| [12b: Moods, the locker room and holdouts](0012b-morale.md)                          | Moods, the locker room, holdouts and trade requests.                                                  |
| [13a: Front offices and the trade market](0013a-front-offices.md)                    | General managers with habits, the trade market and the anti-exploit tests.                            |
| [13b: Owners, the balance check and Simulation Mode](0013b-owners-and-simulation.md) | Owners, the balance check across GM types, and Simulation Mode.                                       |
| [14a: GM Mode: your team, your decisions](0014a-gm-mode.md)                          | GM Mode: your team, a decision inbox and delegation.                                                  |
| [14b: The job](0014b-the-job.md)                                                     | The owner judges you; getting fired, job offers and the glossary.                                     |
| [15a: The past, awards, records and the Hall of Fame](0015a-the-past.md)             | Awards, records, the Hall of Fame and the real league's past.                                         |
| [15b: The story told](0015b-the-story.md)                                            | The newsfeed, storylines and the almanac screens.                                                     |
| [15c: Every club's record book](0015c-franchise-books.md)                            | A record book for every club.                                                                         |
| [16: Day One](0016-day-one.md)                                                       | A real league opens on a day that looks real, with its own coaching carousel.                         |
| [17a: Experiments you can rerun](0017a-experiments-tooling.md)                       | The experiment runner and the Experiments pages.                                                      |
| [17b: What the experiments found](0017b-findings.md)                                 | What the six experiments found.                                                                       |
| [18a: Names, licenses and the sweep](0018a-legal-and-names.md)                       | The name, the MIT license, credits, and a CI test that real names can't get in.                       |
| [18b: Save size and speed](0018b-performance.md)                                     | Pruned logs, a 50-season save budget, faster hot paths and lazy-loaded pages.                         |
| [18c: Accessibility, phones and release](0018c-accessibility-phones-and-release.md)  | Accessibility, phone layouts, the README and the release.                                             |
