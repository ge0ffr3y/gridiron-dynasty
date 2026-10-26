# Devlog 17b: What the experiments found

_Phase 17b, October 2026_

Six questions, answered by running the league many times. Each has a written finding in `docs/findings/` and a page in the app. Every number below has a 95% interval in the finding.

![The cap-aggressive experiment's page: differences over twenty seasons, then each group's win share by season.](../findings/img/cap-aggressive-gms.jpg)

## The answers

1. **Alternate histories (private).** The 2026 season replayed 1,000 times from the real start gives a favorite with about an 18% chance of the title, the top five teams holding two-thirds of the chances, and ten teams at 1% or better. Roster strength before the season predicts the average record very well (correlation 0.92), but a single season swings about two wins either way. The numbers use the private rating file, so the page exists only on this machine.
2. **Cap-aggressive vs conservative managers.** Running the cap hard buys a small early edge (+0.8 points of win share in years 1 to 5) and a slightly worse twenty years (-1.1 points in years 11 to 20; 2.8% of titles against 3.4%). No harder collapse: their worst stretch is no worse. What they lose is the top end.
3. **Draft and develop vs free agency.** Building through the draft won: 1.5 points more win share over twenty years and about 44% more titles. Free-agency teams were much better in seasons 1 and 2 (+4 and +7 points), behind from season 4, and worse at both ends of the range.
4. **A great coach vs a great quarterback.** The best quarterback is worth about three times the best staff: nearly two wins a season against about half a win. (This follows from how the engine treats each, and is an answer inside the model.)
5. **Aggressive vs conservative fourth-down coaches.** Going for it is worth about a fifth of a win a season at a gap of four standard deviations between the coaches. Small.
6. **How random is a playoff?** The strongest team wins the title 30% of the time (a coin flip every game would give 9%). It reaches the final 45% of the time, and one bracket replayed 200 times crowns about 11 different champions out of 14. Talent matters, and the playoff is still a lottery.

## What surprised us

- **Free agency's early win.** The free-agency spenders' first two seasons are their best: they spend about 8 points more of the cap a year on free agents, on average. I haven't traced why it pays off so quickly and then fades. The draft teams' advantage only shows after year three. A short-horizon test would have said the opposite.
- **Coaches barely register.** Even the best staff the engine can build is worth a few points of win share. That was a design choice in Phase 10 (coaches work through a small edge); the experiment shows the size of it for the first time.
- **The strongest team makes the playoffs every time and still loses seven in ten.**

## Honest notes

- **These are the simulation's answers.** Several (coaches, quarterbacks, how much managers matter) are set by choices in the model, not measured in the real league, and each finding says so. The ones about general managers depend on how the trade market, the draft and free agency treat each trait.
- **The groups play each other** (a gain for one is a loss for the other) and the profiles are applied to half the league at once; a single team among teams that all do the same may fare differently.
- **Effect sizes are small.** A point of win share is about a sixth of a win a season. The twenty-season runs find the differences because there are 60 of them.
- **Not done:** an experiment with managers' full bundles (the six archetypes against each other), a second look at the quarterback result with a typical-to-good upgrade instead of best-in-league, and a phone pass on the chart text.

## What's next

- **Phase 18:** ship it: the data licensing review, the trademark sweep, save size and performance, phone and accessibility passes, the README, and v1.0.

---

[← 17a: Experiments you can rerun](0017a-experiments-tooling.md) · [Index](README.md) · [18a: Names, licenses and the sweep →](0018a-legal-and-names.md)
