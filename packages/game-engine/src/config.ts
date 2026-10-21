/**
 * Engine tuning. The shapes of real football (how far runs go, how often
 * throws are completed by depth, punt distances...) come straight from
 * `calibration/targets.json`, measured from real NFL play-by-play. The knobs
 * below are the engine's own choices, tuned until simulated seasons land
 * inside the real ranges (`npm run sim -- --calibrate`).
 */
import charting from "../../../calibration/charting.json";
import matchups from "../../../calibration/matchups.json";
import calibration from "../../../calibration/targets.json";

/** Real-NFL shapes the engine draws from. */
export const REAL = calibration.reference;

/** Real formations, coverages, pass rush, routes, run gaps, and penalties (Phase 4). */
export const MATCHUPS = matchups.reference;

/** Real play-action, screen, drop and sneak rates (FTN charting, CC-BY-SA-4.0). */
export const CHARTING = charting;

/** Real-NFL season averages (what the scorecard compares against). */
export const CALIBRATION_TARGETS = { ...calibration.targets, ...matchups.targets };

/** A typical starter's rating; unit strengths are compared against it. */
export const AVERAGE_RATING = 75;

export const TUNING = {
  /** Seconds that run off between plays while the clock runs. */
  tempo: { normal: 37, hurry: 13, milk: 40, afterOutOfBounds: 28 },
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
    /** Faster quarterbacks gain more when they scramble. */
    scrambleYardsShift: 0.003,
    fieldGoalLogit: 0.03,
    twoPointLogit: 0.02,
    /** Pass rush vs. protection (best and average rusher edge). */
    pressureLogit: 0.03,
    /** Separation of the target, accuracy, hands, decision making, ball skills. */
    opennessLogit: 0.022,
    accuracyLogit: 0.02,
    catchLogit: 0.015,
    decisionLogit: 0.02,
    ballSkillsLogit: 0.015,
  },
  /** Home teams play as if this many rating points better (none at a neutral site). */
  homeFieldEdge: 1.0,
  /**
   * Whole-league corrections, found by calibration: our measured shapes leave
   * out context the engine doesn't model yet (short-yardage and goal-line runs,
   * pressure that doesn't become a sack). Each is a nudge, not a rewrite.
   */
  baseline: {
    runQuantileShift: -0.04,
    yacQuantileShift: 0.045,
    completionLogit: -0.22,
    sackRateScale: 0.76,
    interceptionRateScale: 1.2,
    passRateShift: -0.055,
    /** Defenses tighten up on third down. */
    thirdDownCompletionLogit: -0.35,
    pressureLogit: 0.3,
  },
  /** How ratings blend into the skills that matchups compare (weights add up to 1). */
  skills: {
    runner: { agility: 1 / 3, vision: 1 / 3, speed: 1 / 3 },
    afterCatch: { agility: 0.45, speed: 0.45, strength: 0.1 },
    runBlock: { runBlocking: 0.7, strength: 0.3 },
    shedBlock: { blockShedding: 0.7, strength: 0.3 },
    route: { routeRunning: 0.45, speed: 0.3, release: 0.25 },
    manCoverage: { manCoverage: 0.6, speed: 0.4 },
    zoneCoverage: { zoneCoverage: 0.6, awareness: 0.4 },
  },
  /** A typical kicker's rating (kickers are compared to other kickers, not to all players). */
  averageKicker: 77,
  /** Run game (Phase 4): sneaks, the box, the hole, the ball carrier against the tackler. */
  run: {
    /** QB sneak: per point of line edge at the snap, and the home edge. */
    sneakBlockLogit: 0.084,
    sneakHomeLogit: 0.02,
    /** Fumbles: per point of the carrier's ball security and the tackler's strength. */
    fumbleBallSecurityLogit: 0.03,
    fumbleHitLogit: 0.01,
    /** Who makes the tackle (relative weights): defenders at the hole on short runs, the secondary on long ones. */
    tacklerWeights: {
      longGain: { yards: 10, backs: 3, lb: 1 },
      atTheGap: 3,
      lb: 2,
      dl: 1,
      backs: 0.6,
    },
    sneakSuccess: 0.86,
    carrierShift: 0.004,
    /** Quantile shift by men in the box (real: 5.4 yards a carry against 5 or fewer, 3.3 against 8+). */
    boxShift: { "5-": 0.05, "6": 0.015, "7": -0.015, "8+": -0.06 },
    /** Quantile shift by hole (real: runs outside the ends gain more than runs up the middle). */
    gapShift: {
      "left-end": 0.03,
      "right-end": 0.03,
      "left-tackle": 0,
      "right-tackle": 0,
      "left-guard": -0.01,
      "right-guard": -0.01,
      middle: -0.025,
    },
    brokenTackle: 0.1,
    brokenTackleLogit: 0.03,
    brokenTackleShift: 0.12,
  },
  /** Pass game (Phase 4): rush, coverage, reads, catches. */
  pass: {
    /** How much of the real difference between coverage shells to apply (they also interact with pressure). */
    coverageWeight: 0.8,
    /** A rusher nobody blocks, in rating points of advantage. */
    unblockedEdge: 25,
    playActionPressureLogit: -0.1,
    /** Per rating point: a pressure turns into a sack more often against a slow-reading or immobile QB. */
    sackPassRushLogit: 0.015,
    sackAwarenessLogit: 0.02,
    sackAgilityLogit: 0.01,
    throwAwayWhenPressured: 0.1,
    opennessPerBlitzer: 4,
    opennessNoise: 8,
    /** How strongly the quarterback favors the open man (scaled up by decision making). */
    readSharpness: 0.06,
    pressureWeight: 1,
    playActionCompletionLogit: 0.15,
    playActionDistanceShift: 0.05,
    distancePerBlitzer: 0.11,
    /** Real completion rate on screens (participation routes). */
    screenCompletion: MATCHUPS.routes.SCREEN.completionPct,
    screenYacShift: 0,
    brokenTackle: 0.08,
    /** Real drops are about 3.7% of targets, roughly 1 in 10 incompletions. */
    /** Interceptions: the share made by the man covering the target (else another defender); linebackers' weight. */
    /** Pressure comes mostly from the best rusher's matchup, partly from the whole rush. */
    bestRusherWeight: 0.6,
    /** Backs and fullbacks lose this much route skill on routes past the short area. */
    backDownfieldPenalty: 15,
    /** No throw is intercepted more often than this, however bad the matchup. */
    maxInterceptionChance: 0.25,
    interceptedByCoverer: 0.65,
    linebackerBallSkillsWeight: 0.4,
    /** Per rating point: worse hands drop more; a more open target is broken up less. */
    dropLogit: 0.04,
    breakupLogit: 0.03,
    /** How much of a coverage's effect on throw distance carries over to yards after the catch. */
    yacDistanceShare: 0.5,
    /** Real drops (FTN charting) as a share of real incompletions. */
    dropShareOfIncompletions: CHARTING.dropRate / (1 - CALIBRATION_TARGETS.completionPct.real),
    breakupShareOfIncompletions: 0.3,
  },
  /** Penalties (Phase 4). */
  penalties: {
    /** Real rates count accepted penalties; some fouls get declined, so a few more are thrown. */
    generationScale: 1.25,
    /** Coverage fouls on incomplete passes vs. other passes (averages to the real rate; ~35% of passes fall incomplete). */
    coverageFoulOnIncompletion: 2.2,
    coverageFoulOnOtherPasses: 0.35,
    interferenceByDepth: { short: 0.4, medium: 1.6, deep: 3.9 },
    roughingWhenPressured: 2,
    roughingWhenClean: 0.55,
    groundingOfThrowAways: 0.1,
    /** Snaps per team-game that aren't runs or passes (punts, field goals, tries), and kickoffs, for turning per-game rates into per-snap ones. */
    kickSnapsPerTeamGame: 2.3,
    kickoffsPerTeamGame: 4.9,
    /** Foul-proneness = ceiling - average of awareness and composure, never below the floor. */
    proneness: { ceiling: 120, floor: 5 },
    /** What a touchdown is worth when choosing to accept or decline (seven points, less what the kickoff gives back). */
    touchdownValue: 6.4,
  },
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
    maxDistance: 58,
    rangePerPowerPoint: 0.3,
    /** Beyond this distance a kicker's leg strength matters too, at this weight relative to accuracy. */
    longKick: 45,
    longKickPowerWeight: 0.4,
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
