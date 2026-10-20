/**
 * Positions and the rating model: which attributes exist, how each position's
 * overall is weighted, and typical physical profiles. These are tuning numbers
 * (CLAUDE.md, rule 4); Phase 6 recalibrates them against real combine data.
 */

export const POSITIONS = [
  "QB",
  "RB",
  "FB",
  "WR",
  "TE",
  "OT",
  "OG",
  "C",
  "EDGE",
  "DT",
  "LB",
  "CB",
  "S",
  "K",
  "P",
  "LS",
] as const;
export type Position = (typeof POSITIONS)[number];

export type Side = "offense" | "defense" | "special";

export const POSITION_INFO: Record<Position, { name: string; side: Side }> = {
  QB: { name: "Quarterback", side: "offense" },
  RB: { name: "Running back", side: "offense" },
  FB: { name: "Fullback", side: "offense" },
  WR: { name: "Wide receiver", side: "offense" },
  TE: { name: "Tight end", side: "offense" },
  OT: { name: "Offensive tackle", side: "offense" },
  OG: { name: "Offensive guard", side: "offense" },
  C: { name: "Center", side: "offense" },
  EDGE: { name: "Edge rusher", side: "defense" },
  DT: { name: "Defensive tackle", side: "defense" },
  LB: { name: "Linebacker", side: "defense" },
  CB: { name: "Cornerback", side: "defense" },
  S: { name: "Safety", side: "defense" },
  K: { name: "Kicker", side: "special" },
  P: { name: "Punter", side: "special" },
  LS: { name: "Long snapper", side: "special" },
};

export type AttributeGroup = "physical" | "technical" | "mental";

/** Every rated attribute, 0-100 on our own scale. Order here is display order. */
export const ATTRIBUTES = [
  { key: "speed", label: "Speed", group: "physical" },
  { key: "acceleration", label: "Acceleration", group: "physical" },
  { key: "agility", label: "Agility", group: "physical" },
  { key: "strength", label: "Strength", group: "physical" },
  { key: "jumping", label: "Jumping", group: "physical" },
  { key: "stamina", label: "Stamina", group: "physical" },
  { key: "throwPower", label: "Throw power", group: "technical" },
  { key: "throwAccuracyShort", label: "Short accuracy", group: "technical" },
  { key: "throwAccuracyDeep", label: "Deep accuracy", group: "technical" },
  { key: "vision", label: "Ball-carrier vision", group: "technical" },
  { key: "ballSecurity", label: "Ball security", group: "technical" },
  { key: "catching", label: "Catching", group: "technical" },
  { key: "routeRunning", label: "Route running", group: "technical" },
  { key: "release", label: "Release", group: "technical" },
  { key: "runBlocking", label: "Run blocking", group: "technical" },
  { key: "passBlocking", label: "Pass blocking", group: "technical" },
  { key: "passRush", label: "Pass rush", group: "technical" },
  { key: "blockShedding", label: "Block shedding", group: "technical" },
  { key: "tackling", label: "Tackling", group: "technical" },
  { key: "manCoverage", label: "Man coverage", group: "technical" },
  { key: "zoneCoverage", label: "Zone coverage", group: "technical" },
  { key: "ballSkills", label: "Ball skills", group: "technical" },
  { key: "kickPower", label: "Kick power", group: "technical" },
  { key: "kickAccuracy", label: "Kick accuracy", group: "technical" },
  { key: "snapping", label: "Snapping", group: "technical" },
  { key: "awareness", label: "Awareness", group: "mental" },
  { key: "decisionMaking", label: "Decision making", group: "mental" },
  { key: "composure", label: "Composure", group: "mental" },
] as const satisfies readonly { key: string; label: string; group: AttributeGroup }[];

export type AttributeKey = (typeof ATTRIBUTES)[number]["key"];
export const ATTRIBUTE_KEYS: AttributeKey[] = ATTRIBUTES.map((a) => a.key);
export type Ratings = Record<AttributeKey, number>;

/** How much each attribute counts toward a position's overall. Unlisted = 0. */
export const OVERALL_WEIGHTS: Record<Position, Partial<Record<AttributeKey, number>>> = {
  QB: {
    throwAccuracyShort: 3,
    throwAccuracyDeep: 2,
    throwPower: 2,
    decisionMaking: 3,
    awareness: 2,
    composure: 1.5,
    agility: 0.5,
    speed: 0.5,
  },
  RB: {
    speed: 2,
    acceleration: 2,
    agility: 2,
    vision: 2,
    ballSecurity: 1.5,
    strength: 1,
    catching: 1,
    passBlocking: 0.5,
    awareness: 1,
  },
  FB: {
    runBlocking: 2.5,
    strength: 2,
    passBlocking: 1,
    catching: 0.7,
    ballSecurity: 0.5,
    awareness: 1,
  },
  WR: {
    catching: 2.5,
    routeRunning: 2.5,
    release: 1.5,
    speed: 2,
    acceleration: 1,
    agility: 1,
    jumping: 0.7,
    awareness: 1,
  },
  TE: {
    catching: 2,
    routeRunning: 1.5,
    runBlocking: 2,
    passBlocking: 1,
    strength: 1,
    speed: 1,
    awareness: 1,
  },
  OT: { passBlocking: 3, runBlocking: 2, strength: 2, agility: 1, awareness: 1.5 },
  OG: { runBlocking: 3, passBlocking: 2, strength: 2.5, awareness: 1.5 },
  C: { runBlocking: 2.5, passBlocking: 2, strength: 2, snapping: 1, awareness: 2 },
  EDGE: {
    passRush: 3,
    speed: 1.5,
    acceleration: 1.5,
    strength: 1,
    blockShedding: 1.5,
    tackling: 1,
    awareness: 1,
  },
  DT: { blockShedding: 2.5, strength: 3, passRush: 1.5, tackling: 1.5, awareness: 1 },
  LB: {
    tackling: 2.5,
    awareness: 2,
    speed: 1.5,
    zoneCoverage: 1.5,
    blockShedding: 1.5,
    passRush: 0.5,
    manCoverage: 0.5,
  },
  CB: {
    manCoverage: 3,
    zoneCoverage: 2,
    speed: 2.5,
    acceleration: 1,
    agility: 1.5,
    ballSkills: 1,
    awareness: 1,
    tackling: 0.5,
  },
  S: { zoneCoverage: 2.5, tackling: 2, speed: 1.5, awareness: 2, ballSkills: 1, manCoverage: 1 },
  K: { kickPower: 3, kickAccuracy: 4, composure: 1 },
  P: { kickPower: 4, kickAccuracy: 2.5, composure: 0.5 },
  LS: { snapping: 4, awareness: 1, tackling: 0.5 },
};

/** Typical physical attributes for an average starter: speed, acceleration, agility, strength, jumping, stamina. */
export const PHYSICAL_PROFILE: Record<Position, [number, number, number, number, number, number]> =
  {
    QB: [68, 70, 68, 55, 55, 80],
    RB: [89, 90, 88, 62, 75, 80],
    FB: [70, 72, 68, 78, 55, 80],
    WR: [90, 89, 87, 52, 80, 82],
    TE: [78, 78, 74, 70, 70, 80],
    OT: [45, 62, 55, 88, 40, 80],
    OG: [42, 60, 50, 90, 38, 80],
    C: [44, 60, 52, 86, 38, 80],
    EDGE: [80, 83, 76, 78, 68, 80],
    DT: [58, 70, 58, 92, 50, 78],
    LB: [80, 82, 76, 72, 68, 82],
    CB: [92, 90, 88, 48, 82, 84],
    S: [88, 87, 83, 60, 80, 84],
    K: [55, 55, 50, 45, 40, 70],
    P: [55, 55, 50, 50, 45, 70],
    LS: [50, 55, 50, 75, 40, 75],
  };

/** Size: mean and spread of height (inches) and weight (pounds). */
export const SIZE_PROFILE: Record<
  Position,
  { height: [number, number]; weight: [number, number] }
> = {
  QB: { height: [75, 1.6], weight: [220, 10] },
  RB: { height: [70.5, 1.6], weight: [213, 12] },
  FB: { height: [72.5, 1.3], weight: [245, 9] },
  WR: { height: [72.5, 2.2], weight: [200, 13] },
  TE: { height: [76.5, 1.2], weight: [252, 9] },
  OT: { height: [77.5, 1.1], weight: [315, 11] },
  OG: { height: [76, 1.1], weight: [315, 11] },
  C: { height: [75, 1.0], weight: [305, 9] },
  EDGE: { height: [75.5, 1.4], weight: [262, 14] },
  DT: { height: [75, 1.3], weight: [305, 15] },
  LB: { height: [73.5, 1.3], weight: [238, 9] },
  CB: { height: [71.5, 1.4], weight: [193, 8] },
  S: { height: [72, 1.3], weight: [205, 8] },
  K: { height: [72.5, 2.0], weight: [195, 12] },
  P: { height: [74.5, 1.8], weight: [215, 13] },
  LS: { height: [74, 1.3], weight: [240, 9] },
};

/** Value of a non-physical attribute that doesn't count for the position (e.g. a guard's catching). */
export const UNRELATED_TECHNICAL_BASE = 25;
/** Value of an uncounted mental attribute: everyone has some football sense. */
export const UNRELATED_MENTAL_BASE = 60;
/** Value of a counted technical or mental attribute for an average starter. */
export const STARTER_SKILL_BASE = 75;

/** The overall an average starter at any position gets. */
export const STARTER_OVERALL = 75;
export const OVERALL_MIN = 25;
export const OVERALL_MAX = 99;

/** Points taken off an overall at a position the player has never played (familiarity 0). */
export const FAMILIARITY_PENALTY = 25;

/** Positions a player may also have played, and how likely that is. */
export const ALTERNATE_POSITIONS: Partial<
  Record<Position, { position: Position; chance: number }[]>
> = {
  RB: [{ position: "FB", chance: 0.15 }],
  FB: [
    { position: "TE", chance: 0.35 },
    { position: "RB", chance: 0.3 },
  ],
  TE: [{ position: "FB", chance: 0.25 }],
  WR: [{ position: "RB", chance: 0.05 }],
  OT: [{ position: "OG", chance: 0.45 }],
  OG: [
    { position: "C", chance: 0.4 },
    { position: "OT", chance: 0.3 },
  ],
  C: [{ position: "OG", chance: 0.75 }],
  EDGE: [
    { position: "LB", chance: 0.35 },
    { position: "DT", chance: 0.2 },
  ],
  DT: [{ position: "EDGE", chance: 0.25 }],
  LB: [
    { position: "EDGE", chance: 0.2 },
    { position: "S", chance: 0.08 },
  ],
  CB: [{ position: "S", chance: 0.3 }],
  S: [
    { position: "CB", chance: 0.3 },
    { position: "LB", chance: 0.12 },
  ],
  K: [{ position: "P", chance: 0.1 }],
  P: [{ position: "K", chance: 0.15 }],
};

/** 40-yard dash time from the speed rating: 99 runs about 4.37, 47 about 5.28. */
export const FORTY_AT_ZERO_SPEED = 6.1;
export const FORTY_PER_SPEED_POINT = 0.0175;
