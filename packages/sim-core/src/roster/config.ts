import type { Position } from "@fgm/foundation";
/**
 * Tuning for the AI's roster upkeep (Phase 8; CLAUDE.md, rule 4). These are
 * placeholders' judgment calls, not league rules (those are in rules.roster).
 */
export const ROSTER_AI = {
  /**
   * In the season, a player goes on injured reserve when out at least this many games (the rule
   * allows four; real teams keep shorter injuries on the 53: calibration/injuries.json).
   */
  injuredReserveFromGames: 6,
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
  undraftedPool: 320,
  overallByRank: [
    [1, 72],
    [32, 65],
    [64, 61],
    [100, 57],
    [160, 54],
    [224, 52],
    [300, 51],
    [424, 47],
  ] as [number, number][],
  overallSpread: 6,
  /** Potential above the current overall: mean (best prospects get the extra) and spread. */
  growthMean: 12,
  growthTopExtra: 5,
  growthSpread: 7,
  ages: [21, 23] as [number, number],
  /**
   * Kickers, punters and long snappers arrive close to ready (their position's growth is
   * small), so their prospects rate this much higher than others drafted at the same rank.
   */
  specialistBonus: 6,
  /**
   * Extra room to grow by position (points). Positions that wear out sooner (running backs,
   * receivers, corners) spend less of a career at their peak, so with the same prospects their
   * starters would settle lower than others'. This keeps every position's starters at the
   * rating scale's level over decades (measured with npm run sim -- --lifecycle 30).
   */
  growthByPosition: {
    QB: -1,
    RB: 5,
    FB: 8,
    WR: 5.5,
    TE: 3.5,
    OT: -0.5,
    OG: -0.5,
    C: -0.5,
    EDGE: -3,
    DT: -0.5,
    LB: -0.5,
    CB: 3.5,
  } as Partial<Record<Position, number>>,
  /** How much a team weighs a prospect's room to grow (needs: draft/config.ts). */
  potentialWeight: 0.25,
  /** Undrafted deals: minimum salary for this many seasons. */
  undraftedYears: 3,
} as const;
