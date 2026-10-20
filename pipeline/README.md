# Data pipeline

Builds the real-league starting file from public sources (roadmap Phase 6). Nothing in the league file is ever hand-edited; rerunning the pipeline rebuilds it.

- `src/`: the pipeline steps (download → cache → transform → build)
- `cache/`: downloaded public data (git-ignored, rebuildable)
- `private/`: restricted inputs such as Madden ratings (git-ignored, **never commit**)

Every source, its license, and its credit line will be listed in `docs/data-sources.md`.
