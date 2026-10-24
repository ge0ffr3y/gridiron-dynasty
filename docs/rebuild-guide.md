# Rebuilding the real league for a later start (say, 2027)

The real league is built by `npm run pipeline -- league` from public data and a few private files.
Today's file starts on the day after the 2025 championship (Feb 9, 2026). A 2027 start means doing
the same one year later. Nothing here is automatic: a person has to collect the private inputs, and
the validation report tells you whether the result is right.

## 1. Collect the private inputs (they never get committed)

Everything below goes in `pipeline/private/`, which is git-ignored. Name the files by the new year.

- **Player ratings:** the Madden ratings file for the season just played (`madden/ratings-2026.csv`).
- **Coaching staffs:** every team's head coach, coordinators and position coaches as they stood
  at the end of the regular season, before the firings (`coaches-2026.csv`: `team,role,name`).
  The sim runs the offseason's carousel itself, so don't enter the changes that followed.
- **General managers:** `gms-2026.csv`, one row per team, for the front-office habits step.
- **Cap pages:** each team's public cap page, archived as close as possible to the new start date
  (the pipeline fetches them from the Internet Archive; the first fetch needs
  `cap/cap-space-<date>.html`, the league-wide cap table saved by hand, to know each page's address).
- **Real club names:** `history/team-names.json`, the real clubs' names behind each franchise id
  (see its entries from the last build; names change rarely). Real team names must never reach a
  committed file: a test fails if one does.
- **Overrides:** `overrides.csv`, hand fixes when a player can't be matched across sources.

## 2. Change the year in the code

- `pipeline/src/league/inputs.ts`: `SEASON` (the season just played), and the three file names
  that carry a year (`MADDEN_FILE`, `COACHES_FILE`, the cap snapshot path in `contracts.ts`).
- `pipeline/src/league/contracts.ts`: `FIRST_SEASON` (the season the league starts in).
- `rules/`: add `2027.json` (copy `2026.json`, then check every number against the new CBA year
  and the league's calendar; each block carries a `source` note saying where it came from). The
  salary cap for the new year is in `cap.salaryCapByYear`; the rookie scale needs
  `npm run pipeline -- rookies`.
- `packages/sim-core/src/rules.ts` picks the rules by season, so nothing else changes.

## 3. Refresh the public data

Delete the cached files that carry the old year in `pipeline/cache/nflverse/` (rosters, stats, snap
counts, play-by-play, injuries, the schedule) and run, in order:

```
npm run pipeline -- calibration
npm run pipeline -- matchups
npm run pipeline -- people
npm run pipeline -- lifecycle
npm run pipeline -- injuries
npm run pipeline -- coaching
npm run pipeline -- draft
npm run pipeline -- market
npm run pipeline -- frontoffice
npm run pipeline -- history
npm run pipeline -- league
```

`history` is slow: the archive throttles, so it runs unattended for hours and picks up where it
stopped. Everything else takes minutes.

## 4. Read the Day One report

`npm run pipeline -- league` writes `pipeline/private/out/day-one.json` and a section in
`report.md`. For each of the 32 teams it compares the built league with the real facts:

- **roster size** against the real roster (players released before the cap pages' date start as
  free agents, so a team may be a player or two short);
- **cap space** against the published figure (the cap report's tolerance applies);
- **draft picks** for this year and next against the real order and the trades made before the start;
- **pending free agents** against the real expiring contracts;
- **opponents** against the real schedule: all 17, home or away;
- **head coach** against the staffs file.

It passes when every team is inside its tolerance, or each miss is explained in the report.
`npm test` (`tests/realLeague.test.ts`) checks the same on a machine that has the private files.

## 5. What to eyeball

- The "Where things stand" screen of a new real-league save: champion, top picks, cap room,
  biggest pending free agents and the coaching changes the sim made.
- The almanac: the last season should be the real one, with the right champion and MVP (renamed).
- The coaching changes on `/coaching`: a few head coaches fired, a few hired, the usual number.

## Known gaps in what the guide can't automate

- The Madden ratings file, the coaching staffs and the general managers are collected by hand.
- Franchise record books come from public pages that exist for only some clubs; check
  `pipeline/private/history/raw/wiki_team_missing.json` to see which ones couldn't be found.
