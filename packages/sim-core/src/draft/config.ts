/**
 * Draft day tuning (Phase 11b; CLAUDE.md rule 4). Rules (pick clock,
 * compensatory picks) are in rules/2026.json; these are the AI's judgment,
 * tuned so drafts look like real ones: about 32 draft-day trades a draft, the
 * team moving up paying about 1.42 times the picks' career value
 * (calibration/draft.json `trades`).
 */
export const DRAFT_DAY = {
  /**
   * A future pick is worth what the middle pick of a round this much later is worth now (real
   * teams discount next year's picks by about a round). Judgment.
   */
  futureRoundsLater: 1,
  /**
   * Trading up: a team with a pick within `lookahead` picks moves up for the top of its board if
   * he's likely gone first (his consensus rank is no later than the picks in between plus
   * `goneMargin`) and it gains at least `surplus` board points more by moving up than the team on
   * the clock loses by moving down (every board falls as picks go by; a trade needs one team to
   * love a player the other can live without). It pays the cheapest set of its picks worth at
   * least `price` times the pick's career value, give or take `priceSpread` (drawn per trade from
   * a hash), and no more than `maxOverpay` times that.
   */
  tradeUp: {
    surplus: 3.75,
    goneMargin: 2,
    price: 1.37,
    priceSpread: 0.12,
    maxOverpay: 1.15,
    lookahead: 40,
    maxExtraPicks: 3,
    /** The surplus bar scales with the square root of the pick's worth (vs. the mid-first-round pick), down to this. */
    minScale: 0.35,
    /** Offers shown in the draft room start at this share of the AI's bar. */
    offerShare: 0.5,
  },
  /** At most this many trades in one draft (real high: about 45). */
  maxTradesPerDraft: 45,
  /**
   * How a team rates a need (0-1): starters below `target` overall (`scale` points per full need),
   * old starters, thin depth; kickers, punters and snappers count `specialistWeight` as much.
   */
  need: {
    target: 74,
    scale: 10,
    oldAge: 31,
    oldAgeSpecialist: 36,
    oldAgeNeed: 0.3,
    thinDepth: 0.2,
    specialistWeight: 0.5,
  },
  /**
   * Each team's draft philosophy until Phase 13's general managers: how much it weighs need
   * (board points for a full need, from `needPoints[0]` to `needPoints[1]`) and its taste for
   * risk (points per point of extra room to grow, from -`risk` to +`risk`). Fixed per team by a
   * hash of the league seed. `typicalGrowth`: a typical prospect's room to grow (risk is measured
   * from it).
   */
  philosophy: { needPoints: [1.5, 6] as [number, number], risk: 0.15, typicalGrowth: 13 },
  /** Mock drafts: kickers, punters and snappers count this much less (teams rarely draft them early). */
  mockSpecialistPenalty: 6,
  /**
   * Retro grades: real picks' career seasons started (by slot) are spread over the first
   * `careerSeasons` seasons. No grade before `minSeasons`; a first- or second-rounder who never
   * started after `bustSeasons` is a bust; a pick after `stealAfterPick` who started at least
   * `stealMargin` seasons more than expected is a steal; within `fairMargin` under is fair.
   * Team grades by average seasons started over expectation: [cut, letter], best first.
   */
  retro: {
    careerSeasons: 8,
    minSeasons: 2,
    bustSeasons: 3,
    stealAfterPick: 64,
    stealMargin: 2,
    fairMargin: 1,
    letters: [
      [0.75, "A"],
      [0.25, "B"],
      [-0.25, "C"],
      [-0.75, "D"],
    ] as [number, string][],
  },
};
