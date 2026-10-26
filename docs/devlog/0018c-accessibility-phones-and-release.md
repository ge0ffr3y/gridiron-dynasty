# Devlog 18c: Accessibility, phones and release

_Phase 18c, October 2026_

The game can now be used with a keyboard and a screen reader, reads properly on a phone, and has a README, a portfolio page, a changelog and a devlog index. This is a good-faith pass, not a certified audit: automated checks find only part of the problems, and I walked through only the main flows by keyboard.

![The league page of a generated league.](../img/league.jpg)

## Accessibility

- **The shell:** a "Skip to main content" link; both navigations are labelled and mark the current page; each page has one `<h1>` (the league's name in the header stopped being a heading); card titles are real headings; the document title and keyboard focus move to the new page on each navigation, since a single-page app otherwise tells a screen reader nothing.
- **Real components instead of look-alikes:** one shared `Tabs` (tab roles, arrow keys, Home and End) now runs the team, standings, draft and history pages; one `RadioGroup` replaced the button groups that pretended to be radios on the new-league and career screens.
- **Tables** have captions, `scope` on headers and `aria-sort` on sortable columns, and scroll sideways only when they have to.
- **Focus, color and motion:** a full-strength focus outline everywhere; the faint input-border and ring colors were raised to meet the 3:1 contrast target; the red text color was darkened; reduced-motion settings stop animation.
- **Live regions:** errors announce themselves (`role="alert"`), loading is a `status`, and a running sim button says it is busy.
- **Dialogs:** they trap focus and close with Escape, and now return focus to the button that opened them (found in the keyboard walkthrough: focus used to drop to the top of the page).
- **Page titles** now name the page you are on. The first version of the title code read the heading of the page you had just left, because a page being replaced stays in the document, hidden, while the next one loads; it now looks only at visible headings.

## Checked

- **axe-core** (an accessibility checker) over 28 routes, light and dark, plus the dynamic pages (a player, a team's tabs, a coach, a negotiation): after fixes, no violations. The findings it did produce were real: regions without labels, a repeated landmark name, red text below the contrast target, and a skipped heading level on the depth chart.
- **By keyboard** (a partial walkthrough): the skip link is the first thing in the tab order; the new-league dialog opens with Enter, keeps focus inside, and closes with Escape; tabs move with the arrow keys. I did not do a full screen-reader pass or a keyboard-only game of a season.

## Phones

A script visited 34 routes at 375 by 812 pixels and checked every page for sideways scrolling and for elements wider than the screen outside a scrolling table: none. What changed to get there: the Players, roster and standings tables keep the name column pinned and hide low-priority columns below tablet width; fixed-column grids in the front-office, mood and philosophy panels reflow; dialogs scroll within 90% of the screen height; buttons are at least 40 pixels tall on a phone; and every chart now draws at the width of its container (a `useChartWidth` hook), so text stays readable instead of shrinking to 6 pixels.

## The docs

- **README rewritten:** what it is, the two modes, screenshots, an architecture diagram, how to play and run it, the findings, what is and isn't published, and an honest "how it was built".
- **A portfolio page** (`docs/portfolio.md`) that puts the project on one page, with its measured numbers.
- **This devlog now has an index** with previous and next links on every entry.
- **A changelog,** and a GitHub Pages workflow that is committed but does nothing until Pages is switched on.
- **The overview and roadmap snapshots** are now generated from the Obsidian notes by `scripts/sync-docs.mjs`, which turns the notes' wikilinks and callouts into plain Markdown that GitHub shows properly.

## What surprised us

- **An accessibility fix can introduce a bug.** The route-title code worked in the first test and was wrong on every second page.
- **Most phone problems were fixed widths,** not font sizes.
- **Several screens still described the game as it was ten phases ago** ("trades arrive in Phase 8"). The accessibility audit read them aloud and made them hard to miss.

## What's next

- **Release.** Merge to `main`, tag the earlier versions on the commits where each roadmap release point was reached (v0.1 to v0.5), and `v1.0.0` with release notes, after the author says go. Renaming the repository, making it public and turning on Pages are separate decisions.

---

[← 18b: Save size and speed](0018b-performance.md) · [Index](README.md)
