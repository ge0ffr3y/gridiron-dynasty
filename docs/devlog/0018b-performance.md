# Devlog 18b: Save size and speed

_Phase 18b, October 2026_

A league can now run for fifty seasons without its save file growing out of hand, and the game does the same work faster. Every number below was measured; the full tables are in [`docs/performance.md`](../performance.md).

## What was measured first

A new command, `npm run sim -- --saves 50`, plays 50 seasons headless and, every five, measures the save: raw and gzipped size, time to serialize, fingerprint and parse, the time a league year takes, and which parts of the league are biggest.

The finding was clear. A fresh league is 10 MB and five seasons later it is 21 MB, but the growth never slowed: after 50 seasons the save was **106 MB**, of which the transaction log (every signing, release and trade, with its reason) was 73 MB. Nothing ever pruned it.

## What changed

- **Old logs are pruned.** Transactions are kept for this season and the two before; coaching and front-office moves for ten seasons. Players' histories, awards and the almanac already summarize anything older. Before pruning, each reader of the log was checked so nothing depended on old entries.
- **Past scores are kept, compactly.** Each season's history entry now holds every game's week, teams, score and overtime flag as a short tuple, about 17 KB a season, so the History page shows a season's scores without keeping box scores. Saves are format 22, and old saves open with empty scores for old seasons.
- **Backups are gzipped** (about 7 times smaller). The live save stays plain text: in the browser, compressing every action's save cost more time than the smaller write saved.
- **A 50-season save is now 34 MB raw (4.7 MB gzipped), down from 106 MB.** After the first few seasons it grows by about 0.35 MB a season. The plan's goal was 30 MB; the measured figure is a little over, so the written budget is 40 MB.
- **Faster, with identical results.** Profiling found three hot spots. Perceived ratings and overalls are cached per player and viewer; practice-squad selection scans each squad once; the position-overall formula precomputes its weights. Two league years went from 30.8 s to 17.5 s in the same measurement. The league file after the run is **byte-identical** to the one from before the change (same fingerprint), which is the proof that only speed changed.
- **The page loads in pieces.** Each page loads the first time it is visited; the first download went from 866 KB to about 300 KB (96 KB gzipped).

## How we checked

- A same-seed comparison against `main`: champions, standings and draft order for four seasons match exactly, since pruning only changes what is stored.
- The league fingerprint before and after each speed change.
- Tests: pruning keeps what it should and drops what it should; saves from format 21 upgrade; a new test plays six seasons and fails if the save grows past 23 MB or the transaction log past 4.5 MB (measured 18.1 and 3.2).

## What surprised us

- **The biggest cost was a log nobody read.** The transaction log looked like the cost of a rich league; it was just never cleared.
- **Gzipping every save lost.** A browser benchmark showed that compressing a 20 MB string costs more than writing it.
- **The time was in rereading, not in football.** The hot spots were ratings being perceived and overalls recomputed over and over for the same players.

## What's next

- **18c:** accessibility, phones, and the docs.

---

[← 18a: Names, licenses and the sweep](0018a-legal-and-names.md) · [Index](README.md) · [18c: Accessibility, phones and release →](0018c-accessibility-phones-and-release.md)
