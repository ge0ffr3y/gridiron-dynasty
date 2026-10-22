/**
 * Engine tuning. The shapes of real football (how far runs go, how often
 * throws are completed by depth, punt distances...) come straight from
 * `calibration/targets.json`, measured from real NFL play-by-play. The knobs
 * below are the engine's own choices, tuned until simulated seasons land
 * inside the real ranges (`npm run sim -- --calibrate`).
 */
import charting from "../../../calibration/charting.json";
import matchups from "../../../calibration/matchups.json";
import people from "../../../calibration/people.json";
import situations from "../../../calibration/situations.json";
import elements from "../../../calibration/elements.json";
import calibration from "../../../calibration/targets.json";

/** Real-NFL shapes the engine draws from. */
export const REAL = calibration.reference;

/** Real formations, coverages, pass rush, routes, run gaps, and penalties (Phase 4). */
export const MATCHUPS = matchups.reference;

/** Real play-action, screen, drop and sneak rates (FTN charting, CC-BY-SA-4.0). */
export const CHARTING = charting;

/** Real snap shares by depth, in-game injury rates, and season leaderboards (Phase 4b). */
export const PEOPLE = people;

/** Real win probability, conversion rates, punt results and situational targets (Phase 5a). */
export const SITUATIONS = situations;

/** Real special teams, stadiums, climate and weather effects (Phase 5b). */
export const ELEMENTS = elements;

/** Real-NFL season averages (what the scorecard compares against). */
export const CALIBRATION_TARGETS = {
  ...calibration.targets,
  ...matchups.targets,
  ...situations.targets,
};

/** A typical starter's rating; unit strengths are compared against it. */
export const AVERAGE_RATING = 75;

export const TUNING = {
  /**
   * Fatigue: each snap on the field drains a player's energy (more for a
   * low-stamina player); every snap on the sideline restores some. A player
   * whose energy drops below `tired` comes out for the next man on the depth
   * chart and goes back in once he's back up to `ready`. The drains are tuned
   * so playing time splits like real snap counts (calibration/people.json).
   */
  fatigue: {
    drain: {
      QB: 0,
      RB: 0.062,
      FB: 0.02,
      WR: 0.045,
      TE: 0.05,
      OL: 0.001,
      EDGE: 0.044,
      DT: 0.059,
      LB: 0.003,
      CB: 0.03,
      S: 0.03,
    },
    recoveryPerSnap: 0.03,
    tired: 0.55,
    ready: 0.9,
    /** Per stamina point above or below a typical player at his position: drain shrinks or grows by this share. */
    staminaEffect: 0.015,
  },
  /** In-game injuries: real per-snap rates by position (calibration/people.json), scaled by these. */
  injuries: {
    scrimmageScale: 1,
    /** Chance someone is hurt on a kickoff or punt. */
    perKick: 0.026,
    /** Snaps an injured player who returns to the same game sits out (shortest, longest). */
    returnAfterSnaps: [4, 30],
  },
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
  tails: { run: 4, yac: 3.5, return: 15 },
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
   * Coaching (Phase 10): a play caller's skill (-1 to 1) moves his unit's results a little, on
   * every snap, against the other side's play caller. Judgment-sized: the best staffs gain about
   * a point a game on the worst. Zero-sum across the league, so league totals don't move.
   */
  coaching: {
    completionLogitPerSkill: 0.05,
    runQuantilePerSkill: 0.01,
  },

  /**
   * Whole-league corrections, found by calibration: our measured shapes leave
   * out context the engine doesn't model yet (short-yardage and goal-line runs,
   * pressure that doesn't become a sack). Each is a nudge, not a rewrite.
   */
  baseline: {
    runQuantileShift: -0.006,
    yacQuantileShift: 0.06,
    // Phase 8: 0.05 -> 0.09. Teams now dress 48 from a 53-man roster instead of all 90, so the
    // receivers and linemen who rotate in are thinner; completion and yards per attempt fell
    // about 0.006 and 0.15 below the real rates, and this restores them (5 scorecard runs).
    // Phase 9b: 0.09 -> 0.11. Injuries now happen at the real rate (31 a team-season cost games,
    // not 8), so backups play more, as in the real league; yards per attempt fell to 6.8 and
    // completion to 0.637. This restores them without pushing scoring past its range (0.14 did).
    completionLogit: 0.11,
    // Phase 9b: 0.76 -> 0.72. Backup linemen and quarterbacks play more (real injury rates);
    // the real league's sack rate rose to 0.076, over its 0.074 edge (generated leagues 0.073).
    sackRateScale: 0.72,
    interceptionRateScale: 1.14,
    /**
     * Nudges to the real neutral-situation pass rates, per situation, so that
     * with the score and clock adjustments on top they match real rates in all
     * situations (calibration/situations.json).
     */
    passRateShift: {
      "1st down": -0.01,
      "2nd & short": -0.02,
      "2nd & medium": -0.01,
      "2nd & long": 0.005,
      "3rd & short": -0.065,
      "3rd & medium": 0.005,
      "3rd & long": 0.01,
    } as Record<string, number>,
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
  averageKicker: 76,
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
    /**
     * Quantile shift by men in the box (real: 5.4 yards a carry against 5 or fewer, 3.3 against 8+).
     * Half strength since Phase 5a: the run tables by distance to go already include the
     * crowded fronts of short yardage, so only the rest of the box effect is added here.
     */
    boxShift: { "5-": 0.025, "6": 0.008, "7": -0.008, "8+": -0.03 },
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
    readSharpness: 0.03,
    pressureWeight: 1,
    playActionCompletionLogit: 0.15,
    playActionDistanceShift: 0.05,
    distancePerBlitzer: 0.11,
    /** Real completion rate on screens (participation routes). */
    /** Share of quick throws against a stacked box (7+) that come off a run-pass option. */
    rpoOfQuickThrowsVsStackedBox: 0.4,
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
    /** Real rates count accepted penalties; some live-ball fouls get declined, so a few more are thrown. */
    generationScale: 1.35,
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
    wr1: 0.1,
    wr2: 0.1,
    wr3: 0.1,
    wr4: 0.05,
    te1: 0.13,
    te2: 0.06,
    rb1: 0.14,
    rb2: 0.07,
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
  /**
   * 4th-down and 2-point decisions (Phase 5a). The analytics baseline is the
   * option with the best win probability. A coach goes for it with chance
   * logistic(slope x win-probability gain + lean + style), where the lean is
   * real coaches' caution and the style moves it (aggressiveness 0-1, 0.5 typical).
   */
  decisions: {
    goSlope: 150,
    /** Real coaches give up a punt far less readily than a field goal. */
    // Phase 10: -2.45 / -1.6 -> -2.6 / -1.75, and the 2-point lean -2.25 -> -2.3. Coaches now
    // differ in aggressiveness as real ones do, and since the go chance is a curve, a spread of
    // coaches goes for it a little more on average than one typical coach did.
    goLeanVsPunt: -2.6,
    goLeanVsFieldGoal: -1.75,
    /** ...and they trust long field goals less: per yard of kick beyond `trustedKick`, the lean shrinks by this. */
    longKickDoubt: 0.08,
    trustedKick: 35,
    twoPointSlope: 60,
    twoPointLean: -2.3,
    /**
     * How far a team's aggressiveness (0 to 1) moves the lean, from most cautious to boldest.
     * Phase 10: 2 -> 4, so a coach as far from average as real coaches are (calibration/
     * coaching.json) goes for it as much more often as they do. 0.5 (typical) is unchanged.
     */
    aggressivenessRange: 4,
    /** Yards past the line on a typical conversion. */
    conversionExtraYards: 2,
    /** Clock a 4th-down play or punt takes, for the win-probability look-ahead. */
    secondsPerPlay: 6,
    secondsPerPunt: 10,
    /** Punts aren't considered this close to the goal (yards to goal). */
    noPuntInside: 36,
  },
  /** Pass-rate changes when trailing or leading in the second half (per point of margin). */
  scoreAdjustment: {
    trailingPerPoint: 0.008,
    leadingPerPoint: 0.008,
    maxShift: 0.2,
    fourthQuarterBoost: 1.4,
  },
  twoMinuteDrillPassRate: 0.82,
  /** Clock management (Phase 5a). */
  clock: {
    /** Before halftime, deep in their own end: run out the clock under this many seconds, kneel under this many. */
    runOutHalfYardsToGoal: 65,
    runOutHalfSeconds: 90,
    kneelHalfSeconds: 25,
    /** In a two-minute drill the defense plays deep: throws come up shorter. */
    preventDistanceShift: -0.15,
    /** Chance per snap (each team) of a timeout to regroup or beat the play clock, before the last two minutes. */
    regroupPerSnap: { firstHalf: 0.016, secondHalf: 0.02 },
    /** Teams keep at least this many timeouts for the end of the half. */
    regroupKeepAtLeast: 2,
  },
  /**
   * In-game adjustments (Phase 5a). At halftime an offense leans toward what
   * worked in the first half (pass rate moves by `passRatePerEpa` per point of
   * EPA-per-play difference between its passes and runs, capped), scaled by
   * its coach's adaptability (0.5 typical). Defenses tighten against what hurt
   * them the same way (a quantile shift on that kind of play). Kept small.
   */
  adjustments: {
    passRatePerEpa: 0.15,
    maxPassRateShift: 0.05,
    defenseShiftPerEpa: 0.03,
    maxDefenseShift: 0.01,
    /** Plays of each kind needed in the first half before anyone adjusts. */
    minPlays: 8,
  },
  /**
   * Momentum: after a big swing play (|EPA| of at least `swing`), the team it
   * favored plays a little better for a few snaps. Zero by default: no real
   * effect could be measured to calibrate it.
   */
  momentum: { strength: 0, swing: 3, plays: 4 },
  /**
   * Special teams (Phase 5b). Kickoffs start from the real 2025 outcome mix;
   * the kicker's leg, the wind and altitude move it (log-odds per point / mph). Fakes: chance a short-yardage punt or field goal is a fake.
   */
  /** Weather counts as cold at or below this temperature, and altitude from this elevation (as in the data). */
  weather: { coldF: 40, altitudeMeters: 1000 },
  specialTeams: {
    touchbackPerPowerPoint: 0.04,
    /** League kickers out-kick the real average a little; this centers the touchback rate. */
    touchbackLogit: -0.1,
    touchbackPerMphOfWind: 0.03,
    touchbackAtAltitude: 0.6,
    shortKickPerMphOfWind: 0.05,
    /** Onside kicks: trailing by at most this much, inside these many seconds of the 4th quarter. */
    onsideMaxDeficit: 16,
    oneScore: 8,
    onsideOneScoreSeconds: 120,
    onsideTwoScoreSeconds: 240,
    /** An onside kick goes about this far before someone falls on it. */
    onsideKickYards: 10,
    /** Fakes only on 4th and this short or shorter, at this chance. */
    fakeMaxToGo: 4,
    puntFakeChance: 0.04,
    fieldGoalFakeChance: 0.01,
    /**
     * Pinning punts: when a full punt would land inside `aimInside` (or in the end zone), the punter
     * aims short, landing it between `closest` and `aimInside` yards from the goal `success` of the time.
     */
    pin: { aimInside: 15, closest: 3, success: 0.32, fairCatchShare: 0.5 },
    /** The real distance table includes pinned punts; full punts go a little farther than it says. */
    fullPuntShift: 0.05,
    /** Return speed and coverage: quantile shift per point of returner speed and of coverage speed + tackling. */
    returnerShift: 0.003,
    coverageShift: 0.002,
    returnerSpeedTypical: 85,
    /** Coverage units are backups: a typical one rates about this (speed + tackling, averaged). */
    coverageTypical: 68,
  },
  /** Replay review (Phase 5a): how often each kind of play is a close call, and how often a hurt team challenges one. */
  review: {
    closeCall: {
      touchdown: 0.05,
      interception: 0.06,
      fumble: 0.1,
      /** A tackle where the ball came loose right at the end (ruled down by contact). */
      downByContact: 0.004,
      catch: 0.02,
      incompletion: 0.015,
      spot: 0.15,
    },
    challengeWillingness: 0.35,
    /** Coaches get this many challenges, and one more if the first ones all succeed. */
    challenges: 2,
  },
  /** Chance a fumble is lost; the rest are recovered by the offense. */
  fumbleLostShare: {
    run: REAL.run.fumbleLostRate / REAL.run.fumbleRate,
    catch: REAL.pass.catchFumbleLostRate / REAL.pass.catchFumbleRate,
    sack: 0.5,
  },
};
