# Devlog 12a: Free agency and negotiation

_Phase 12a, October 2026_

Contracts are negotiated now. Every player has an agent and things he cares about, and the market sets prices from real contracts. Each spring:

- **The re-signing window:** teams try to keep their players, tag a star whose talks failed, and tender their young free agents.
- **Free agency:** opens with the League Year and runs day by day for a week, then week by week to the draft, with a late market through the summer.
- **Bidding:** teams bid on the players they want, and players pick the offer that suits them best.

You can sit at the table too. On the negotiation screen you can make an offer for any team as the league office, until GM Mode. You'll see the player's market value, his ask and why, his agent, what he cares about, how he sees your team, and what the deal does to your cap.

_(Screenshot to come: the app window was closed during this session, so the browser couldn't draw one.)_

## The real market

From nflverse's contract data (compiled by OverTheCap; the rows stay private, only derived curves are committed), veteran deals signed 2019–2025 (`npm run pipeline -- market` → `calibration/market.json`):

- **Pay by position and rank:** for example, the highest-paid veteran quarterback earns 24.1% of the cap, the 12th 17.8%. The top wide receiver earns 14.4%, the 12th 10.1%.
- **Free agents who changed teams:** the year's best free agent at each position (for example quarterbacks 11.1–20.8% of the cap, receivers 6.7–11.8%, the middle 80% of years), and the next tiers.
- **Movement a year:**
  - 676 veterans sign with a new team (140 for 1%+ of the cap);
  - 373 re-sign (105 for 1%+);
  - 26 sign big extensions (5%+ of the cap).
- **Shape:** years by age, and guarantees by pay.

The rules come from the CBA text, recorded in `rules/2026.json` `freeAgency`:

- **Exclusive rights** (Article 8): under three accrued seasons.
- **Restricted and unrestricted** (Article 9): restricted at three accrued seasons, with four tender levels, five days to match an offer sheet, and the signing period ending five days before the draft; unrestricted from four.
- **Tags** (Article 10): one franchise or transition tag a year. The non-exclusive franchise tag costs two first-round picks if another club signs the player; the transition tag carries a right of first refusal.
- **Rookie deals** (Article 7): can't be redone until after the third season.
- **Camp fines** (Article 42): $60,000 a day from 2026. These come into play in 12b's holdouts.

## What was built

- **Market value:**
  - **Rank:** where a veteran stands at his position in the market's eyes (the league office's read, adjusted for where his age is heading).
  - **Pay:** the real pay at that rank, blended with what the league itself pays there now, so big deals move the market. The blend stays within 15% of the real curve.
  - **Shape:** the years and guarantees deals like his usually carry.
- **Agents:** 64 fictional agents in fictional agencies, each with a style:
  - **hardball:** asks 8% more, walks away below 86% of his ask;
  - **fair:** meets in the middle;
  - **relationship-driven:** asks a little less, patient;
  - **money-only.**
- **Demands:** his market value, moved by his agent's style, his ego and how much he cares about money. A loyal player gives his own team a discount.
- **A team's appeal to him:** winning (where its roster ranks), his role (would he start, by its own read), the city (each player likes some places more), and its scheme. Weighted by what he cares about. A team he likes can pay a little less.
- **Talks:**
  - Meeting his ask in every part always works.
  - Well below it ends talks, with the reason (for example "Offered 51% of his asking price ($13.81M a year, $15.05M guaranteed); his agent (relationship-driven) ended talks.").
  - In between, he counters at his agent's pace until his patience runs out.
  - Answers are the same every time you ask: no dice are rolled.
- **The re-signing window:**
  - **Cap first:** teams get under the new cap.
  - **Re-signing:** they negotiate with the expiring players they want, but many players let their deals run out to test the market (more if they care about money or have a big ego, fewer if they're loyal).
  - **Tags:** a star whose talks failed may get the team's one tag.
  - **Tenders:** restricted and exclusive-rights free agents get the tender their value covers.
- **Free agency:**
  - **Bidding:** each AI team bids on the players it values most above their ask (by its needs, its staff's read and its budget), and raises when outbid.
  - **Choosing:** each player takes the best offer by everything he cares about once it clears what he holds out for; the longer he waits, the less he holds out for.
  - **Offer sheets:** restricted free agents can sign them, rarely; the old team has five days to match or takes the compensation picks.
  - **The late market:** after the draft, a late round every three weeks, then minimum deals.
- **Extensions:** each week of the season, a few teams extend a starter in his deal's last year through the same talks, if they can fit the new bonus on this year's cap.
- **Screens:**
  - **Free agency** (`/free-agency`): the market board with market value, ask and interest (offers, best offer, bidders); this year's signings with reasons; tags and tenders; offer sheets waiting to be matched.
  - **Contract talks** (`/negotiate/:id`, from the player page): his demands, priorities and appeal; an offer form with cap previews; the counter or the reason.
  - **Calendar:** new sim buttons for free agency day by day or a week at a time.
- **The runner:** `npm run sim -- --market N` prints each League Year's market next to the real one.
- **Saves:** format 15. Older saves get agents and the free-agency rules.

## How it compares

`npm run sim -- --market 6` (a year on average, the league's first League Year left out since no deals run out in it):

| Measure                                     | Seed 42 | Seed 7 | Real NFL |
| ------------------------------------------- | ------- | ------ | -------- |
| Free agents to new teams, paid 1%+ of cap   | 124     | 123    | 140      |
| Re-signed, paid 1%+                         | 85      | 85     | 105      |
| Extensions                                  | 32      | 28     | 26 (5%+) |
| Top-tier free agents' pay inside real range | 67%     | 62%    | —        |

- **How fast:** about half of free agents who change teams sign in the first three days, most of the rest within the week. Real free agency front-loads the same way, though nflverse doesn't record signing dates to measure it.
- **The real league** (`--market 5` from the real file): 68 well-paid free agents change teams a year. It starts tighter, with the median team's room 7% of the cap in March 2026, and opens up as teams clear room.
- **Draft hit rates improved:** compensatory picks are now mostly earned by the formula across rounds 3–7, not supplemental ones at the end. Rounds 2–4 land within 1–3 points of real start rates, and rounds 5–7 within 5–8 (from up to 11).
- **Scorecard** (four leagues, two seasons): 62 of 63 league stats in range.
- **The long run** (`--lifecycle 30`) holds: mean age 26.2–26.6 (real 26.35), starters 75.6–76.7, stars rated 90+ about 50–65.

## What surprised us / what broke

- **Every team chased the same few stars.** On the first day 47 offers went to six players, while 130 good free agents got none. Each team now targets the players it values most above their ask, and can have more offers out than it could pay for (most aren't accepted; signing checks real room).
- **Teams kept nearly everyone.** With the loyalty discount and a good fit at home, almost every wanted player re-signed and the market dried up within three years. Letting players test the market brought movement up to near the real numbers.
- **One team signed $350M of players in a day.** Offer sheets weren't counted against room, and unmatched ones landed on the roster. Now each team gets one a year, and pending sheets count against its room.
- **Bidding wars fed on themselves.** Winning bids raised the league's own comparables, which raised the next year's prices. The league's comps can now move a value at most 15% from the real curve.
- **Rounding said no.** An offer typed from the ask in rounded millions came in a few thousand dollars under it and drew a counter. The form now rounds up, and within half a percent of the ask counts as meeting it.

## Not done yet

- **12b:** moods, the locker room, holdouts, hold-ins and trade requests.
- **Real league market:** a bit thin in its first years (about half the real number of well-paid moves).
- **AI general managers** (Phase 13) will make the bidding smarter: cap planning across years, and trading for players instead of signing them.
