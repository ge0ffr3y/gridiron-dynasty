# Performance and save size

Everything here was measured on one laptop (a Mac laptop, other work running at the same time), so read the times as "about", not as a promise. The numbers come from the runner:

```
npm run sim -- --saves 50 --seed 18 --every 5 --out saves.json
```

It plays 50 seasons headless from a fresh league and, every five seasons, measures what a save costs.

## The budget

| Measure                         | Budget for a 50-season league | Measured (after Phase 18) |
| ------------------------------- | ----------------------------- | ------------------------- |
| Save size, raw text             | 40 MB or less                 | 34.4 MB                   |
| Save size, gzipped              | 6 MB or less                  | 4.7 MB                    |
| Open a save (parse)             | under 1.5 s                   | 0.35 s                    |
| Write a save (serialize + hash) | under 0.7 s                   | 0.35 s                    |
| One season, simulated           | under 5 s                     | 4.5 s (idle-ish machine)  |

The plan started with a 30 MB goal. The measured 50-season save is 34.4 MB, so the budget was set honestly at 40 MB. The part that matters is the shape: the save grows quickly for the first few seasons and then slowly.

## What a save grows by

Before Phase 18 the transaction log was never pruned, so it grew by about 1.5 MB every season and dominated the file. After 50 seasons a save was 106 MB raw.

| After season | Raw MB before | Raw MB after |
| -----------: | ------------: | -----------: |
|            1 |          10.3 |         10.3 |
|            5 |          21.1 |         17.2 |
|           10 |          32.2 |         20.8 |
|           20 |          50.8 |         24.2 |
|           30 |          69.5 |         27.6 |
|           40 |          88.1 |         31.2 |
|           50 |         106.4 |         34.4 |

What changed:

- Transactions are kept for this season and the two before; coaching and front-office moves for ten seasons. Older moves are already summarized by player histories, awards and the almanac.
- Each past season keeps its scores in a compact form (week, teams, score, overtime), about 17 KB a season, so the History page can still show every game's result.
- Players who retired or went unsigned four seasons ago become short history cards (this already existed in Phase 13).
- Backups (one the first time each season is saved, last three per league) are stored gzipped, about 7 times smaller. The live save stays plain text: in the browser, compressing every save cost more time than the smaller write saved.

Where the 34 MB goes at season 50: players 11.9 MB, former players 10.8 MB, transactions 3.1 MB, coaches 2.6 MB, awards 1.5 MB.

## Speed

Phase 18 found three hot spots by profiling and made them cheaper without changing a single result (the league file of a two-year run is byte-identical before and after, checked by its fingerprint):

- Perceived ratings and overalls are cached per player and viewer, and only the overall is computed where only the overall is shown.
- The roster upkeep that picks practice-squad players scans each squad once instead of once per candidate.
- The position-overall formula precomputes its weights.

Two league years (offseason, season and playoffs) went from 30.8 s to 17.5 s in the same measurement.

The web app also loads each page when first visited. The first download went from 866 KB to about 300 KB (95 KB gzipped) for the main bundle.

## Guards in the tests

`tests/performance.test.ts` runs after the other tests:

- a full season must sim in under 15 s (the real figure is about 4.5 s; the guard allows for slow CI machines);
- six seasons must leave a save under 23 MB with the transaction log under 4.5 MB (measured: 18.1 MB and 3.2 MB), so a log that stops being pruned is caught.
