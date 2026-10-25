# Devlog 15c: Every club's record book

_Phase 15c, October 2026_

Phase 15 left franchise record books for only 10 of the 32 clubs: the rest had no public records page we could read, so they started with an empty book. Every club now has one.

## What changed

- **A source that exists for everyone.** Each club has its own leader pages on the reference site: every player's career totals with the club, and every season the club has had, one page per statistic group. The pipeline now fetches nine pages per club (career passing, rushing, receiving, defense and kicking; single-season passing, rushing, receiving and kicking), 288 in all, politely and resumably like the rest of the history step.
- **Three deep.** A club's list now keeps its top three, not one, for the ten career statistics and the eight season statistics the pages carry.
- **Gaps in the archive, filled from what we already have.** The archive's copies of these pages are often a year or three old (the newest usable copy of eight is from 2022 or 2023). Each page's date is recorded, and the seasons played after it are added from the stats files we already use for current players (passing, rushing, receiving and defense) and from the play-by-play files for field goals. A career total gets the later seasons added to it, and a player new since the copy is started from scratch. In all, 268 of the 576 lists needed that.
- **Single games still come from the clubs' public records pages**, so only 8 clubs have them. The leader pages have no single-game lists, and there's no honest way to make one for the years before 1999.
- **Season sacks and interceptions** for a club also come only from those public pages where they exist, for the same reason: the leader pages don't have them.

## How it checks out

I compared the new lists with the old, Wikipedia-based ones for the clubs that had both. Of 136 top marks, 110 agree to the number. Of the 26 that differ:

- **14 were mistakes in the old parse.** Miami's nine showed a year (1983) in place of a total; Houston's receiving lists were picking up the wrong players; Minnesota's field goals read "2006" as the value; Green Bay's career sacks read "1982". The new numbers are the right ones.
- **8 were old pages gone stale**: Kansas City's five career totals, Chicago's season field goals, Green Bay's season receptions, Seattle's touchdown passes. The new lists include 2025.
- **1 is a counting convention:** Seattle's career sacks, where the reference site includes the unofficial sacks of 1980-81.
- **3 were field-goal lists** that were wrong until the kicking top-up from the play-by-play files went in; they agree now.

Spot checks against totals I know: [name removed]'s Buffalo rushing yards, [name removed]'s Detroit field goals, [name removed]'s Denver field goals and [name removed]'s Oakland and Las Vegas field goals all read right.

## What changed in the game

- **The record book for any club** (`/records/:team`, or the team page's History tab) now has a real book for all 32, with the top three on each list.
- **Newsfeed:** a 20-season real-league run had 9 record stories in its last two seasons, so about four or five a year.
- **More legends:** record holders who never otherwise appear get history cards (1,514 in all now).
- **Nothing in a generated league changes.**

## What surprised us

- **403s that looked like throttling.** Some archived copies answer "forbidden", and the fetcher treated that as the archive being busy and waited tens of minutes before giving up on each. It now skips a refused copy at once and takes the next one.
- **The stats files have no kicking.** The field goals needed a different file (play-by-play) than everything else.
- **A page's date matters as much as its numbers.** Taking a copy from the middle of a season would double count whatever the later top-up adds; the fetcher now takes only copies made between a season's end and the next one's start.

## Honest notes

- **Traded players:** the stats files credit a whole season to a player's last team, so a record-setting season by someone traded mid-year could go to the wrong club. It would matter only for a record that was set that way.
- **The top-up is only as good as the player match** (by the reference site's id): a player the two sources identify differently could appear twice.
- **Single-game books: 8 of 32 clubs.** The other 24 clubs have no single-game records until the sim sets some.

## What's next

- **Left over from Phase 15:** five league leader pages the archive never saved.
