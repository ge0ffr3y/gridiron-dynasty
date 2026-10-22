/**
 * Coaching staffs (Phase 10; CLAUDE.md rule 4). The real spreads of team
 * tendencies are in calibration/coaching.json; these knobs size the effects
 * coaches have, each zero-sum around a typical coach so league totals hold.
 */
import type { Position } from "@fgm/foundation";
import type { CoachRole } from "../league/schema";

/** Each team's staff: how many of each job, and the ages they're hired at. */
export const STAFF_ROLES: { role: CoachRole; count: number; age: [number, number] }[] = [
  { role: "HC", count: 1, age: [40, 66] },
  { role: "OC", count: 1, age: [34, 62] },
  { role: "DC", count: 1, age: [34, 62] },
  { role: "STC", count: 1, age: [32, 60] },
  { role: "SKILL", count: 1, age: [30, 62] },
  { role: "OLC", count: 1, age: [32, 64] },
  { role: "FRONT", count: 1, age: [32, 64] },
  { role: "DBC", count: 1, age: [30, 62] },
  { role: "STR", count: 1, age: [30, 62] },
  { role: "MED", count: 1, age: [32, 64] },
  { role: "SCOUT", count: 2, age: [27, 62] },
];

/** Age ranges by job, for coaches whose real age isn't known. */
export const COACH_AGE_FALLBACK = Object.fromEntries(
  STAFF_ROLES.map((s) => [s.role, s.age]),
) as Record<CoachRole, [number, number]>;

export const ROLE_NAMES: Record<CoachRole, string> = {
  HC: "Head coach",
  OC: "Offensive coordinator",
  DC: "Defensive coordinator",
  STC: "Special teams coordinator",
  SKILL: "Quarterbacks and skill positions coach",
  OLC: "Offensive line coach",
  FRONT: "Defensive front coach",
  DBC: "Defensive backs coach",
  STR: "Strength and conditioning coach",
  MED: "Head athletic trainer",
  SCOUT: "Scout",
};

/** The skill that matters most for each job (generated coaches are better at it). */
export const ROLE_FOCUS: Record<
  CoachRole,
  "offense" | "defense" | "development" | "leadership" | "gameManagement" | "scouting" | "health"
> = {
  HC: "leadership",
  OC: "offense",
  DC: "defense",
  STC: "development",
  SKILL: "development",
  OLC: "development",
  FRONT: "development",
  DBC: "development",
  STR: "health",
  MED: "health",
  SCOUT: "scouting",
};

/** Which position coach develops each position (special teams develops the specialists). */
export const POSITION_COACH: Record<Position, CoachRole> = {
  QB: "SKILL",
  RB: "SKILL",
  FB: "SKILL",
  WR: "SKILL",
  TE: "SKILL",
  OT: "OLC",
  OG: "OLC",
  C: "OLC",
  EDGE: "FRONT",
  DT: "FRONT",
  LB: "FRONT",
  CB: "DBC",
  S: "DBC",
  K: "STC",
  P: "STC",
  LS: "STC",
};

/** Generated coaches' skills: mean and spread, and the bonus at the job's main skill. */
export const COACH_SKILL = { mean: 58, spread: 12, focusBonus: 12 };
/** A typical coach at his job's main skill (where every effect is neutral). */
export const TYPICAL_FOCUS = COACH_SKILL.mean + COACH_SKILL.focusBonus;
/** Skill points per step of "skill" (-1 to 1) the engine gets: a coach this far above typical is +1. */
export const SKILL_POINTS_PER_STEP = 24;

/**
 * What coaches do beyond calling plays. Each is a multiplier of 1 for a typical coach; a coach
 * SKILL_POINTS_PER_STEP above typical moves it by the range (judgment-sized, not measured).
 */
export const STAFF_EFFECTS = {
  /** Development: the position coach's, then the head coach's (everyone's). */
  positionCoachDevelopment: 0.1,
  headCoachDevelopment: 0.03,
  /** Strength coach: injury risk (lower is better). */
  strengthInjuryRisk: 0.1,
  /** Head trainer: recovery time (lower is better). */
  trainerRecovery: 0.1,
  /** Head coach's leadership: pre-snap penalties (lower is better). */
  disciplinePenalties: 0.1,
};

/**
 * Style mapping onto the engine (tuned so the sim's spread of team tendencies matches the real
 * spread in calibration/coaching.json): 4th-down and 2-point aggressiveness (0-1, 0.5 typical)
 * per unit of the real measure.
 */
export const STYLE_MAPPING = {
  /** Aggressiveness per unit of 4th-down go rate over expected. */
  fourthDownAggressivenessPerUnit: 3.2,
  /** Aggressiveness per unit of 2-point tries per touchdown. */
  twoPointAggressivenessPerUnit: 3,
  /** Generated coaches' adaptability: spread around 0.5. */
  adaptabilitySpread: 0.12,
};

/**
 * Coaching careers (Phase 10b). Contract lengths, the starting reputation, and the carousel's
 * odds, tuned so head-coach changes match the real 7.2 a year between seasons and 1.65 during
 * them (calibration/coaching.json headCoachChanges).
 */
export const CAREERS = {
  /** Years a new contract runs, by job (the rest: assistants). */
  contractYears: { HC: [4, 5], OC: [2, 3], DC: [2, 3], other: [1, 3] } as Record<
    "HC" | "OC" | "DC" | "other",
    [number, number]
  >,
  /** Reputation for a new coach: a base, per year of experience, per point of main skill above typical. */
  reputation: { base: 30, perYear: 1, perSkillPoint: 0.8 },
  /** Position groups a scout can specialize in (used from Phase 11). */
  scoutSpecialties: ["QB", "RB/WR/TE", "OL", "DL/EDGE", "LB", "DB", "All"],
};

/**
 * The coaching carousel (Phase 10b). Odds are on the log-odds scale; the bases are tuned so
 * head-coach changes match the real league (calibration/coaching.json headCoachChanges: 7.2 a
 * year between seasons, 1.65 during them). Other sizes are judgment, documented here.
 */
export const CAROUSEL = {
  /** Black Monday: the chance a head coach is fired after the regular season. */
  firing: {
    base: -2.0,
    /** Per unit of win share below what his roster should have won. */
    perWinShareBelow: 7,
    /** Per losing season in a row beyond the first. */
    perLosingSeasonInRow: 0.5,
    /** His first and second seasons with the team. */
    newCoachGrace: [-1.6, -0.8] as [number, number],
    /** Made the playoffs this season. */
    playoffs: -1.5,
    /** His contract runs out this season. */
    contractUp: 0.5,
  },
  /** During the season, checked after each week in this range (rare). */
  inSeason: { fromWeek: 4, toWeek: 15, base: -6.65, perWinShareBelow: 9 },
  /** A coordinator whose unit ranked in the bottom few is sometimes let go (judgment). */
  coordinatorFiring: { base: -2.0, perRankFromBottom: 0.09 },
  /** A new head coach keeps each coordinator this often (otherwise he picks his own). */
  newHeadCoachKeepsCoordinator: 0.35,
  /** An interim head coach keeps the job this often. */
  interimKept: 0.2,
  /** Candidates a team interviews for a head-coach or coordinator job. */
  interviews: 5,
  /** New faces (college and assistant ranks) join a search when it has fewer than `minimumField` candidates. */
  newcomersPerOpening: 2,
  minimumField: 8,
  /** A hire is announced this many days after the candidate's interview (judgment). */
  hireDaysAfterInterview: 4,
  /** A team waits for a candidate still in the playoffs if he's this much better (score points). */
  waitMargin: 4,
  /** Hiring score weights for head coaches and coordinators. */
  headCoachScore: { leadership: 0.35, gameManagement: 0.2, playCalling: 0.25, reputation: 0.2 },
  coordinatorScore: { playCalling: 0.6, development: 0.15, reputation: 0.25 },
  /** Random spread in how each team rates a candidate (score points). */
  taste: 6,
  /** Retirement: even odds at this age, years per step; out of work this many seasons retires. */
  retirement: { evenOddsAge: 71, yearsPerStep: 3, idleSeasons: 2 },
  /** Coaches improve until about 50 and slip after 64 (main skill points a year; judgment). */
  development: { growthUntil: 50, growth: 1, declineFrom: 64, decline: 1.5, noise: 1.5 },
  /** Reputation: per win above expectation (head coaches), playoffs, titles, firing; drifts to 50. */
  reputation: {
    perWinAboveExpected: 2,
    playoffs: 4,
    title: 10,
    fired: -8,
    promoted: 5,
    unitPerRank: 0.4,
    drift: 0.1,
  },
};
