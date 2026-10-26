# Devlog 18a: Names, licenses and the sweep

_Phase 18a, October 2026_

The project now has a name, a license, credits, and a test that fails if a real name or trademark ever gets into the repository. None of this changes how the game plays; it makes the project safe to publish.

![The "Where things stand" screen, from a generated league.](img/0016-where-things-stand.jpg)

## What changed

- **A name:** _Gridiron Dynasty: GM Simulator_ (short: _Gridiron Dynasty_). A web search found no game with that exact title; the nearest were two other football-management titles. That is not a trademark search, and the notes say so. Internal package names (`@fgm/*`), the database name and the league file extension stay as they were, so saves keep loading.
- **MIT license** (`LICENSE`), with a notice file (`NOTICE.md`) and the app's new **About** page (`/about`) that credit the data and list every software dependency and its license. One file, `calibration/charting.json`, comes from share-alike data and keeps its own CC-BY-SA notice.
- **`docs/data-sources.md` finished.** Every source, what it feeds, and what is published. It now includes the sources that had no row (archived reference pages, Wikipedia, the trade and schedule data, injuries, players) and a plain statement of what is built only on the author's computer: the real-league file and its private inputs. Only derived numbers are published, never raw pages, ratings or contract data.
- **A build can't ship the private file.** `npm run build` removes `dist/private/` (the real-league file the dev server reads from `public/private/`), unless you set `KEEP_PRIVATE=1` for a build you run yourself. CI fails if `dist/private` exists.
- **"Pro Bowl" is now "All-Star Game"** in everything a player sees (awards, honors, Hall of Fame reasons, the glossary). Internal field names stayed, so saves load.
- **Names that stood in for real ones were replaced:** the two conferences are now the Heartland and Frontier Conferences, and two club nicknames that matched real clubs elsewhere (one an existing soccer club) became the Frontiersmen and the Voyageurs.
- **Stale copy fixed.** Screens still said trades "arrive in Phase 8", that moves were the league office's "until GM Mode", or that a ratings file "arrives in Phase 6". They now describe the game as it is.

## The sweep

`tests/sweep.test.ts` runs in CI, which has none of the private files, so it can't compare against real names directly. Instead, `npm run pipeline -- sweep-list` (run once, locally) writes `tests/fixtures/banned.json`: a short fingerprint (the first 12 hex characters of a SHA-256) of each normalized real club nickname, 2025 player and coach name, and real record-holder or legend name. The test hashes every word sequence in every tracked text file, markdown included, and fails if any matches. The list holds no names, so committing it is safe.

It also fails on the league's trademarked championship name anywhere, and, in the code the app ships, on the trademarked all-star game name, on the league's initials in anything a player can see, and on any mention of the ratings file's publisher.

What it found on its first run, all fixed: the championship name in the overview, roadmap and `CLAUDE.md`; real historical names in a devlog entry, a code comment and a test example; and one old screenshot that showed a real career line under a fictional name.

## Screenshots

The six screenshots from the real-league phases (career stats, the contract page, the cap sheet, the what-if panel, a trade answer and "Where things stand") were retaken from a generated league. The other older screenshots show fictional names only; I haven't re-verified each one for real contract figures.

## What surprised us

- **A name test needs care with punctuation.** Possessives ("Smith's") and initials ("D.J.") defeated the first version of the tokenizer, so the test misses neither now; a unit test covers both.
- **A real build can ship private files by accident.** Vite copies everything in `public/`, and the real-league file was there for the dev server. Nothing had been published, but a local build would have carried it. Now it can't.

## How we checked

- `npm test`, including the sweep (five tests: the hash list loads; no real nickname or name in any tracked file; no championship name; the shipped code is clean; the app's source is clean even in comments).
- A production build, then a check that `dist/private` doesn't exist.

## What's next

- **18b:** save size and speed.

---

[← 17b: What the experiments found](0017b-findings.md) · [Index](README.md) · [18b: Save size and speed →](0018b-performance.md)
