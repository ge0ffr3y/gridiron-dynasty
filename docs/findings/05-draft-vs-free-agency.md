# Draft and develop vs free-agency spending

**Question:** Over twenty years, does building through the draft beat buying in free agency?

![Differences between free-agency spending and draft-and-develop over twenty seasons, and the season-by-season win share of each group.](img/draft-vs-free-agency.jpg)

## How it was run

- **File:** `experiments/draft-vs-free-agency.json` (page: `/experiments/draft-vs-free-agency`).
- **60 generated leagues** (seeds 2000 to 2059), twenty seasons each. In each, 16 teams (chosen by the seed) get a **draft-and-develop** manager (future discount -1, cap aggression -0.5, loyalty +0.5, risk -0.2) and 16 a **free-agency spender** (future discount +1, cap aggression +1) with a generous owner (budget +1). Skill is 55 for everyone, and the profiles are held when a manager is replaced.
- Compared inside each league and averaged over the 60 with 95% intervals.

## What it found

| Free agency minus draft                   | Difference (95% interval)                                       |
| ----------------------------------------- | --------------------------------------------------------------- |
| Win share, years 1-5                      | +0.9 pts (0.0 to 1.7); seasons 1 and 2 alone: **+4.0 and +7.3** |
| Win share, years 6-10                     | **-2.5 pts** (-3.2 to -1.8)                                     |
| Win share, years 11-20                    | **-2.1 pts** (-2.7 to -1.5)                                     |
| Win share, all twenty years               | **-1.5 pts** (-2.0 to -1.0)                                     |
| Made the playoffs                         | **-2.2 pts** (-3.4 to -1.0)                                     |
| Titles (share of team-seasons)            | **-1.1 pts** (-1.6 to -0.6): 2.6% against 3.7%                  |
| Best three-season stretch                 | -1.9 pts (-2.6 to -1.2)                                         |
| Worst three-season stretch                | -1.2 pts (-1.8 to -0.6)                                         |
| Dead money (share of cap)                 | +2.9 pts: 8.0% against 5.1%                                     |
| Free-agent spending (share of cap a year) | +8.1 pts                                                        |

**Conclusion.** Building through the draft won out over twenty years: about 1.5 points more win share and about 44% more titles. Free-agency teams started faster (clearly better in seasons 1 and 2) but were behind from season 4 on and never recovered. They were worse at both ends, with a lower best stretch and a lower worst one, and carried much more dead money.

## Caveats

- The free-agency group differs from the draft group in several ways at once (how it discounts the future, cap aggression, and a generous owner), so this compares two strategies, not one knob.
- The groups play each other, so one group's gain is the other's loss, and a lone team among teams that all do the same might fare differently.
- A point of win share is about a sixth of a win a season.

## Run it again

```
npm run sim -- --experiment experiments/draft-vs-free-agency.json --workers 6
```

About 3.5 hours on six cores; interrupted runs resume where they stopped.
