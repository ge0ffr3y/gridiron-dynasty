/**
 * Engine tuning. The shapes of real football (how far runs go, how often
 * throws are completed by depth, punt distances...) come straight from
 * `calibration/targets.json`, measured from real NFL play-by-play. The knobs
 * below are the engine's own choices, tuned until simulated seasons land
 * inside the real ranges (`npm run sim -- --calibrate`).
 */
import calibration from "../../../calibration/targets.json";

/** Real-NFL shapes the engine draws from. */
export const REAL = calibration.reference;

/** Real-NFL season averages (what the scorecard compares against). */
export const CALIBRATION_TARGETS = calibration.targets;

/** A typical starter's rating; unit strengths are compared against it. */
export const AVERAGE_RATING = 75;

export const TUNING = {
  /** Seconds that run off between plays while the clock runs. */
  tempo: { normal: 40, hurry: 13, milk: 40, afterOutOfBounds: 30 },
  /** Seconds a play takes from snap to whistle. */
  playSeconds: {
    run: 5,
    pass: 6,
    incomplete: 5,
    sack: 5,
    scramble: 6,
    kneel: 1,
    spike: 1,
    punt: 8,
    fieldGoal: 5,
    kickoffReturn: 6,
  },
  /** Chance a play ends out of bounds. */
  outOfBounds: { insideRun: 0.05, outsideRun: 0.3, completion: 0.22, scramble: 0.45 },
  /** Exponential tail (mean extra yards) beyond the last measured quantile. */
  tails: { run: 12, yac: 10, return: 15 },
  /**
   * How strongly a unit-strength edge (in rating points) moves outcomes.
   * Quantile shifts move a draw along the distribution; logit shifts move
   * a probability on the log-odds scale.
   */
  matchup: {
    runQuantileShift: 0.0105,
    yacQuantileShift: 0.007,
    completionLogit: 0.044,
    sackLogit: 0.045,
    interceptionLogit: 0.04,
    scrambleLogit: 0.03,
    fieldGoalLogit: 0.03,
    twoPointLogit: 0.02,
  },
  /** Home teams play as if this many rating points better (none at a neutral site). */
  homeFieldEdge: 1.0,
  /**
   * Whole-league corrections, found by calibration: our measured shapes leave
   * out context the engine doesn't model yet (short-yardage and goal-line runs,
   * pressure that doesn't become a sack). Each is a nudge, not a rewrite.
   */
  baseline: {
    runQuantileShift: -0.012,
    yacQuantileShift: 0.04,
    completionLogit: 0.08,
    sackRateScale: 1.04,
    interceptionRateScale: 0.92,
    passRateShift: -0.035,
    /** Defenses tighten up on third down. */
    thirdDownCompletionLogit: -0.25,
  },
  /** A typical kicker's rating (kickers are compared to other kickers, not to all players). */
  averageKicker: 77,
  /** Who carries the ball on designed runs. */
  rusherShare: { rb1: 0.6, rb2: 0.26, qb: 0.07, wr: 0.03, fb: 0.04 },
  /** Who is targeted on throws (by depth chart slot). */
  targetShare: {
    wr1: 0.24,
    wr2: 0.19,
    wr3: 0.13,
    wr4: 0.03,
    te1: 0.17,
    te2: 0.05,
    rb1: 0.13,
    rb2: 0.06,
  },
  /** Who makes the tackle, by position group. */
  tackleShare: {
    run: { dl: 0.25, lb: 0.45, cb: 0.12, s: 0.18 },
    pass: { dl: 0.04, lb: 0.25, cb: 0.43, s: 0.28 },
  },
  /** Share of throws by depth on 3rd down and long, where offenses throw past the sticks. */
  longYardageDepthShare: { short: 0.45, medium: 0.35, deep: 0.2 },
  /** Run direction (for the play-by-play). */
  insideRunShare: 0.55,
  fieldGoal: {
    /** Kick distance = yards to goal + this (10-yard end zone + 7-yard snap). */
    snapYards: 17,
    /** Longest try a typical kicker will attempt; each point of kick power adds this much. */
    maxDistance: 56,
    rangePerPowerPoint: 0.3,
  },
  twoPoint: {
    /** Share of touchdowns followed by a 2-point try outside the late-game chart. */
    baseRate: 0.045,
    /** Point differences (scoring team, after the touchdown) where teams go for two late. */
    lateChart: [-2, -5, -10, -13, 1, 5, 12],
  },
  /** Pass-rate changes when trailing or leading in the second half (per point of margin). */
  scoreAdjustment: {
    trailingPerPoint: 0.008,
    leadingPerPoint: 0.008,
    maxShift: 0.2,
    fourthQuarterBoost: 1.4,
  },
  twoMinuteDrillPassRate: 0.82,
  /** Chance a fumble is lost; the rest are recovered by the offense. */
  fumbleLostShare: {
    run: REAL.run.fumbleLostRate / REAL.run.fumbleRate,
    catch: REAL.pass.catchFumbleLostRate / REAL.pass.catchFumbleRate,
    sack: 0.5,
  },
};
