/**
 * Scheme fit (Phase 10): each scheme prizes certain skills at each position
 * (an Air Raid wants receivers who run routes and get open fast; a Power Run
 * line wants strength and run blocking). A player's fit compares those skills
 * with the rest of his game: -1 (a poor fit) to +1 (made for it). Fit moves
 * how well he plays (a little), how the depth chart ranks him, and how fast he
 * develops. Changing coordinators changes fits.
 */
import { baseProfile, OVERALL_WEIGHTS, type AttributeKey, type Position } from "@fgm/foundation";
import type { League, Player } from "../league/schema";
import { DEFENSIVE_SCHEMES, OFFENSIVE_SCHEMES } from "../league/schema";
import { coachIn } from "./style";

export type OffensiveScheme = (typeof OFFENSIVE_SCHEMES)[number];
export type DefensiveScheme = (typeof DEFENSIVE_SCHEMES)[number];
type Scheme = OffensiveScheme | DefensiveScheme;
type Emphasis = Partial<Record<Position, AttributeKey[]>>;

/** What each scheme prizes, by position (skills that count at the position). */
export const SCHEME_EMPHASIS: Record<Scheme, Emphasis> = {
  "West Coast": {
    QB: ["throwAccuracyShort", "decisionMaking"],
    RB: ["catching", "routeRunning"],
    WR: ["routeRunning", "catching"],
    TE: ["routeRunning", "catching"],
    OT: ["passBlocking"],
    OG: ["passBlocking"],
    C: ["passBlocking"],
  },
  "Air Raid": {
    QB: ["throwAccuracyShort", "throwAccuracyDeep", "decisionMaking"],
    WR: ["routeRunning", "release", "speed"],
    TE: ["routeRunning", "catching"],
    OT: ["passBlocking"],
    OG: ["passBlocking"],
    C: ["passBlocking"],
  },
  "Spread/RPO": {
    QB: ["speed", "agility", "decisionMaking"],
    RB: ["agility", "vision"],
    WR: ["agility", "speed"],
    TE: ["catching", "agility"],
    OT: ["agility"],
    OG: ["agility"],
    C: ["agility"],
  },
  "Power Run": {
    QB: ["composure"],
    RB: ["strength", "ballSecurity", "vision"],
    FB: ["runBlocking", "strength"],
    TE: ["runBlocking", "strength"],
    OT: ["runBlocking", "strength"],
    OG: ["runBlocking", "strength"],
    C: ["runBlocking", "strength"],
  },
  "Wide Zone": {
    QB: ["agility"],
    RB: ["vision", "acceleration"],
    TE: ["runBlocking", "agility"],
    OT: ["runBlocking", "agility"],
    OG: ["runBlocking", "agility"],
    C: ["runBlocking", "agility"],
  },
  Vertical: {
    QB: ["throwPower", "throwAccuracyDeep"],
    WR: ["speed", "release", "jumping"],
    TE: ["speed", "catching"],
    OT: ["passBlocking"],
    OG: ["passBlocking"],
    C: ["passBlocking"],
  },
  "4-3": {
    EDGE: ["speed", "passRush"],
    DT: ["passRush", "blockShedding"],
    LB: ["speed", "tackling", "zoneCoverage"],
  },
  "3-4": {
    EDGE: ["strength", "blockShedding"],
    DT: ["strength", "blockShedding"],
    LB: ["strength", "tackling", "blockShedding"],
  },
  "Cover 2": {
    LB: ["zoneCoverage", "speed"],
    CB: ["zoneCoverage", "tackling"],
    S: ["zoneCoverage", "speed"],
  },
  "Cover 3": {
    LB: ["zoneCoverage"],
    CB: ["zoneCoverage", "ballSkills"],
    S: ["speed", "ballSkills"],
  },
  "Man Pressure": {
    EDGE: ["passRush", "speed"],
    LB: ["passRush", "manCoverage"],
    CB: ["manCoverage", "speed", "agility"],
    S: ["manCoverage", "speed"],
  },
  Multiple: {
    LB: ["awareness"],
    CB: ["awareness"],
    S: ["awareness"],
  },
};

/** Rating points of difference that make a full fit (+1) or misfit (-1). */
export const FIT_SCALE = 10;
/** On the field and on the depth chart, a full fit or misfit is worth this many overall points. */
export const FIT_OVERALL_POINTS = 3;
/** Development: a full fit grows this much faster (a misfit this much slower). */
export const FIT_DEVELOPMENT = 0.05;

const OFFENSIVE_POSITIONS = new Set<Position>(["QB", "RB", "FB", "WR", "TE", "OT", "OG", "C"]);
const DEFENSIVE_POSITIONS = new Set<Position>(["EDGE", "DT", "LB", "CB", "S"]);

/** The scheme a team plays on a player's side of the ball: its coordinator's, else its head coach's. */
export function teamScheme(league: League, teamId: string, position: Position): Scheme | null {
  const hc = coachIn(league, teamId, "HC");
  if (OFFENSIVE_POSITIONS.has(position))
    return coachIn(league, teamId, "OC")?.offensiveScheme ?? hc?.offensiveScheme ?? null;
  if (DEFENSIVE_POSITIONS.has(position))
    return coachIn(league, teamId, "DC")?.defensiveScheme ?? hc?.defensiveScheme ?? null;
  return null;
}

/**
 * How well these ratings fit a scheme at a position, -1 to 1: how much more his prized skills
 * stand out from the rest of his game than an average starter's do.
 */
export function fitScore(
  ratings: Player["ratings"],
  position: Position,
  scheme: Scheme | null,
): number {
  if (!scheme) return 0;
  const prized = SCHEME_EMPHASIS[scheme][position];
  if (!prized || prized.length === 0) return 0;
  // Measured against an average starter at his position, so a typical player is neutral.
  const gap =
    prizedGap(ratings, position, prized) - prizedGap(baseProfile(position), position, prized);
  return Math.max(-1, Math.min(1, gap / FIT_SCALE));
}

/** The prized skills' average minus the average of everything that counts at the position. */
function prizedGap(ratings: Player["ratings"], position: Position, prized: AttributeKey[]): number {
  const keys = Object.keys(OVERALL_WEIGHTS[position]) as AttributeKey[];
  if (keys.length === 0) return 0;
  const all = keys.reduce((a, k) => a + ratings[k], 0) / keys.length;
  return prized.reduce((a, k) => a + ratings[k], 0) / prized.length - all;
}

/** A player's fit with his own team's scheme (0 for free agents and specialists). */
export function playerFit(league: League, p: Player): number {
  if (p.teamId === null) return 0;
  return fitScore(p.ratings, p.position, teamScheme(league, p.teamId, p.position));
}

/** Fit at a position for a team's players, for its depth chart and lineups. */
export function fitFor(league: League, teamId: string): (p: Player, position: Position) => number {
  return (p, position) => fitScore(p.ratings, position, teamScheme(league, teamId, position));
}

/** His ratings as he plays in his team's scheme: every skill that counts moves with his fit. */
export function ratingsInScheme(
  ratings: Player["ratings"],
  position: Position,
  fit: number,
): Player["ratings"] {
  if (fit === 0) return ratings;
  const shift = fit * FIT_OVERALL_POINTS;
  const out = { ...ratings };
  for (const k of Object.keys(OVERALL_WEIGHTS[position]) as AttributeKey[])
    out[k] = Math.max(1, Math.min(99, out[k] + shift));
  return out;
}

/** A label for screens. */
export function fitLabel(
  fit: number,
): "Great fit" | "Good fit" | "Neutral" | "Poor fit" | "Bad fit" {
  if (fit >= 0.5) return "Great fit";
  if (fit >= 0.2) return "Good fit";
  if (fit > -0.2) return "Neutral";
  if (fit > -0.5) return "Poor fit";
  return "Bad fit";
}
