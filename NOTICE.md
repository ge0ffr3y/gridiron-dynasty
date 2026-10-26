# Notices and credits

Gridiron Dynasty: GM Simulator is released under the MIT license (`LICENSE`). This file lists what the project builds on. The full source table, with what each source is used for and what is published, is in [`docs/data-sources.md`](docs/data-sources.md).

## Not affiliated

This is an independent fan project. It isn't made, endorsed or sponsored by any professional football league, club, players' association or game publisher. All team nicknames, people, colleges and the league's own names in the game are fictional; real city names are used only as place names. Any resemblance to a real club or person is accidental. Please tell us if you find one.

## Data

- **nflverse** (nflverse.com): play-by-play, participation, injuries, rosters, snap counts, players, draft picks and the combine, CC-BY-4.0. "Data from nflverse (nflverse.com), CC-BY-4.0." The numbers derived from it are in `calibration/`.
- **FTN charting, via nflverse:** CC-BY-SA-4.0. "Charting data by FTN Data via nflverse, CC-BY-SA-4.0." The numbers derived from it are in `calibration/charting.json` alone. **That file is licensed CC-BY-SA-4.0** (<https://creativecommons.org/licenses/by-sa/4.0/>): if you adapt it, share your version under the same license. The rest of the repository is MIT.
- **nfldata** (Lee Sharpe), via nflverse: trade and schedule data behind the trade-market and draft numbers.
- **OverTheCap**, via nflverse (contract data), and **Pro-Football-Reference** (Sports Reference LLC), via the Internet Archive: only counts and curves derived from them are published (`calibration/market.json`, `calibration/awards.json`, parts of `calibration/draft.json` and `calibration/frontoffice.json`). Their terms restrict reuse of the raw data, so the raw data is not in this repository.
- **Wikipedia** (CC-BY-SA-4.0): read for franchise record lists when building the real-league start on a private computer. No text is republished.
- **League rules:** the rules file (`rules/`) records facts from the public rulebook and collective bargaining agreement, each with a source note. No text is copied.

## Software

The web app is built with React, Tailwind CSS, Radix UI, Dexie, TanStack Table, wouter, zod, lucide icons (ISC) and a few small helpers, all under permissive licenses (MIT, ISC, Apache-2.0, 0BSD, Unlicense). The exact list with versions and licenses is in the app's About page and is regenerated with `npm run licenses`.

## Your computer, your data

The game runs in your browser and saves to your browser's storage. Nothing is sent anywhere.
