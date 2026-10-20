# Data sources

Every outside source the project uses, its license, and how it's credited. Restricted inputs (none yet) live in `pipeline/private/`, which is never committed.

| Source                                                                                                         | Used for                                                                                                                    | License   | Credit                                                      |
| -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------- | ----------------------------------------------------------- |
| [nflverse play-by-play](https://github.com/nflverse/nflverse-data) (regular seasons 2022–2025)                 | Calibration targets and the engine's fitted shapes (`calibration/targets.json`, built by `npm run pipeline -- calibration`) | CC-BY-4.0 | "Play-by-play data from nflverse (nflverse.com), CC-BY-4.0" |
| NFL rulebook, tie-breaking procedures, and rule-change announcements (nfl.com, operations.nfl.com, team sites) | League rules in `rules/` (each block cites its source)                                                                      | Facts     | Cited per rule                                              |

Downloaded files go in `pipeline/cache/` (git-ignored) and are re-downloaded when missing.
