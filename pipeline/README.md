# Data pipeline

Builds the calibration files and the real-league starting file from public sources. Nothing it writes is ever hand-edited; rerunning the pipeline rebuilds it.

- `src/`: the pipeline steps (download → cache → transform → build). `src/league/` is the real-league import (Phase 6).
- `cache/`: downloaded public data (git-ignored, rebuildable)
- `private/`: restricted inputs and anything with real names (git-ignored, **never commit**)

## Building the real league

```bash
npm run pipeline -- league
```

It needs two private files:

- `private/madden/ratings-2025.csv`: the Madden ratings export (one row per player, attribute columns named `stats/<attribute>/value`).
- `private/coaches-2025.csv`: `team,role,name,note` for each head coach and coordinator at the end of the 2025 season.

An optional `private/overrides.csv` (`madden_row,gsis`) forces a Madden row onto a player when the automatic match misses.

Outputs go to `private/out/`: `real-league-2026.json` (no real names) and `report.md` (what couldn't be matched, with real names). The league file is also copied to `apps/web/public/private/` for the New League dialog.

Every source, its license, and its credit line are listed in `docs/data-sources.md`.
