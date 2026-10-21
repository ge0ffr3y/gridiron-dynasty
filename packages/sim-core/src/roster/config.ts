/**
 * Tuning for the AI's roster upkeep (Phase 8; CLAUDE.md, rule 4). These are
 * placeholders' judgment calls, not league rules (those are in rules.roster).
 */
export const ROSTER_AI = {
  /** A waiver claim needs the player to beat the team's weakest at his position by this much (overall). */
  claimMargin: 3,
  /** Signing another team's practice-squad player needs him to beat the closer options by this much. */
  poachMargin: 3,
  /** Practice-squad picks: a small edge for the team's own cuts (they know the playbook). */
  ownCutBonus: 1,
  /** How many practice-squad players a team keeps on futures deals after the season. */
  futuresKept: 10,
  /** Cutdown value: points of overall a full-strength preseason grade is worth (grade 100 vs 50). */
  preseasonGradeWeight: 6,
  /** Cutdown value: overall points per year past this age (older players cost a roster spot sooner). */
  agePenaltyFrom: 30,
  /** Cutdown value: overall points per $1M of dead money a cut would add (teams keep sunk costs). */
  deadMoneyPerMillion: 0.6,
  /**
   * The fewest a team keeps at each position on the 53 (a typical real 53-man roster: about
   * 47 spoken for, the last few by value). Formations need the bodies: three-receiver sets,
   * two- and three-tight-end packages, a full line rotation.
   */
  fiftyThreeMinimums: {
    QB: 2,
    RB: 3,
    FB: 0,
    WR: 5,
    TE: 3,
    OT: 4,
    OG: 4,
    C: 2,
    EDGE: 4,
    DT: 4,
    LB: 4,
    CB: 5,
    S: 4,
    K: 1,
    P: 1,
    LS: 1,
  },
  /** Practice squad: aim for this many players per position group before taking the best left. */
  practiceSquadMix: {
    QB: 1,
    RB: 1,
    WR: 2,
    TE: 1,
    OT: 1,
    OG: 1,
    C: 1,
    EDGE: 2,
    DT: 2,
    LB: 1,
    CB: 2,
    S: 1,
  },
} as const;

/** Preseason showcase (roster/preseason.ts). */
export const PRESEASON = {
  /** Snaps at which a grade counts half (fewer snaps pull it toward 50). */
  gradeShrinkSnaps: 40,
  /** One standard deviation of production within a position = this many grade points. */
  gradePointsPerSd: 15,
  /** A standout: this grade or better can earn a boost. */
  standoutGrade: 65,
  /** The most a preseason can add to a player's overall. */
  maxBoost: 2,
  /** Work ethic (0-100) at which a standout gets the full boost; lower gets less. */
  fullBoostWorkEthic: 70,
  /** Preseason game ids start here (they're kept apart from the season's games). */
  firstGameId: 100_000,
} as const;

/**
 * The placeholder draft (roster/draft.ts) until Phase 11: a generated class whose quality by
 * rank follows these knots [rank in class, mean overall], with this spread, and room to grow.
 */
export const DRAFT_CLASS = {
  /** Prospects beyond the picks: the undrafted pool teams fill out to 90 from. */
  undraftedPool: 200,
  overallByRank: [
    [1, 72],
    [32, 65],
    [64, 61],
    [100, 58],
    [160, 55],
    [224, 52],
    [424, 46],
  ] as [number, number][],
  overallSpread: 4,
  /** Potential above the current overall: mean (best prospects get the extra) and spread. */
  growthMean: 8,
  growthTopExtra: 6,
  growthSpread: 4,
  ages: [21, 23] as [number, number],
  /** How much a team weighs a prospect's room to grow, and filling a thin position. */
  potentialWeight: 0.25,
  needBonus: 2,
  /** Undrafted deals: minimum salary for this many seasons. */
  undraftedYears: 3,
} as const;

/** Placeholder retirement (roster/upkeep.ts) until Phase 9. */
export const RETIREMENT = {
  /** Free agents who haven't played a regular-season game for this many seasons retire. */
  unsignedSeasons: 2,
  /** ...or for one season, at this age or older. */
  olderFreeAgentAge: 30,
} as const;
