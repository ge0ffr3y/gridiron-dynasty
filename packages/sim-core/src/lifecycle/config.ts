/**
 * Tuning for player development, aging and retirement (Phase 9; CLAUDE.md
 * rule 4). The shapes by age come from real players (calibration/
 * lifecycle.json); these numbers set their size and the individual spread.
 */
export const DEVELOPMENT = {
  /**
   * Decline: rating points per year for one standard deviation of the real measure (share of
   * snaps, or a quarterback's efficiency). Tuned so the league neither inflates nor collapses
   * over 30 seasons. (Growth is sized by potential instead: the real measure can't show a
   * starter getting better once he plays every snap.)
   */
  declinePointsPerSd: 7,
  /** Share of the year's development at the new League Year; the rest comes in training camp. */
  offseasonShare: 0.7,
  /** The most of his remaining room to grow a player closes in one year. */
  maxGrowthShare: 0.6,
  /** Work ethic (0-100): 50 is typical; each point away changes growth by this share. */
  workEthicEffect: 0.008,
  /** Durability (0-100): each point below 50 speeds decline by this share (above slows it). */
  durabilityEffect: 0.006,
  /** Playing time: growth at no snaps vs. a full-time starter (straight line between). */
  playingTimeGrowth: [0.7, 1.2] as [number, number],
  /** A full-time player's snaps per game (offense or defense), for measuring playing time. */
  snapsPerGame: 62,
  /** Young players: this share of a year's luck shows up in potential too (breakouts and busts). */
  potentialFromLuck: 0.5,
  /** Random spread of a year's change (rating points, one standard deviation). */
  noise: 1.4,
  /** After the peak, potential fades toward the current overall by this much a year. */
  potentialFadeAfterPeak: 2,
  /** Ages past the measured range keep declining by this much more each year (sd units). */
  lateDeclineStep: 0.05,
  /** Share of a decline taken from physical attributes, before 30 and from 30 on. */
  physicalShareOfDecline: [0.35, 0.65] as [number, number],
  /** Share of growth that goes to physical attributes (young players fill out a little). */
  physicalShareOfGrowth: 0.2,
  /** Changes this big (points) are recorded as development news. */
  notableChange: 3,
  /** In season, each week: chance a young regular gains a point, and an aging backup loses one. */
  weekly: {
    growthChance: 0.05,
    declineChance: 0.04,
    /** "Real snaps": this share of a full-time player's, so far this season. */
    regularShare: 0.5,
    /** "Not playing": below this share. */
    idleShare: 0.1,
  },
  /** A rookie's first camp: his playing time counts as this share (college reps, not ours). */
  rookiePlayingTime: 0.5,
} as const;

/** Specialists (kickers, punters, long snappers): no snap data, so a gentle shape by hand. */
export const SPECIALIST_CURVE: [number, number][] = [
  [21, 0.15],
  [26, 0.05],
  [28, 0],
  [33, 0],
  [36, -0.15],
  [40, -0.3],
];

/** Camp settles close position battles (Phase 9): a preseason grade is worth up to this many points. */
export const POSITION_BATTLE = {
  /**
   * A grade of 100 (or 0) moves a player this far up (or down) when choosing starters, so the
   * most camp can swing is 2.5 points: a 3-point gap always holds.
   */
  maxPoints: 1.25,
} as const;

/**
 * Retirement (Phase 9). Each offseason every player weighs it: mostly age against his
 * position's real retirement ages, then how far he's fallen, whether he just won it all,
 * whether his deal is up, and whether he's hurt. Tuned so careers match calibration/
 * lifecycle.json. Chances are on the log-odds scale (0 = even odds).
 */
export const RETIREMENT = {
  /** The age where a player's chance is even: his position's late retirement age (90th percentile) plus this. */
  evenOddsPastLateAge: 1,
  /** Years of age per step on the log-odds scale (bigger = more spread out). */
  yearsPerStep: 1.6,
  /** The fewest log-odds: a healthy young starter almost never walks away. */
  floor: -6,
  /** Fallen from his best overall by more than this many points... */
  declineFreePoints: 4,
  /** ...adds this much per further point. */
  perPointOfDecline: 0.12,
  /** Won the championship, at or past his position's typical retirement age: some go out on top. */
  champion: 0.8,
  /** His contract is up this offseason. */
  contractUp: 0.6,
  /** A fringe player at 29 or older (overall below this) thinks about life after football. */
  fringeOverall: 62,
  fringeAge: 29,
  fringe: 1,
  /** Still hurt going into the new season (a long injury carried over), at 28 or older. */
  injuredGames: 1,
  injuredAge: 28,
  injured: 1,
  /** A severe injury (9+ games) in the season just ended, at this age or older. */
  severeInjuryAge: 30,
  severeInjury: 0.8,
  /** A free agent nobody played all season retires (sooner from this age). */
  idleSeasons: 2,
  idleAgeOneSeason: 27,
  /** Nobody plays past these ages. */
  maxAge: { QB: 45, K: 47, P: 47, LS: 45 } as Partial<Record<string, number>>,
  defaultMaxAge: 41,
} as const;
