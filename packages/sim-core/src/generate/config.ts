/**
 * Tuning numbers for generated leagues (CLAUDE.md, rule 4).
 * Phase 6 checks these shapes against the real league.
 */
import type { Position } from "@fgm/foundation";

/** A 90-man offseason roster. */
export const ROSTER_MIX: Record<Position, number> = {
  QB: 4,
  RB: 5,
  FB: 1,
  WR: 10,
  TE: 5,
  OT: 8,
  OG: 8,
  C: 4,
  EDGE: 9,
  DT: 8,
  LB: 8,
  CB: 10,
  S: 7,
  K: 1,
  P: 1,
  LS: 1,
};

/** How many players at each position count as starters (base defense plus a nickel corner). */
export const STARTERS: Record<Position, number> = {
  QB: 1,
  RB: 1,
  FB: 1,
  WR: 3,
  TE: 1,
  OT: 2,
  OG: 2,
  C: 1,
  EDGE: 2,
  DT: 2,
  LB: 2,
  CB: 3,
  S: 2,
  K: 1,
  P: 1,
  LS: 1,
};

export type Tier = "starter" | "backup" | "depth" | "camp";

/** Typical overall (mean, spread) for each depth tier. */
export const TIER_OVERALL: Record<Tier, [number, number]> = {
  starter: [76, 7],
  backup: [66, 6],
  depth: [59, 6],
  camp: [52, 6],
};

/** Spread of team-to-team strength added to starters and backups. */
export const TEAM_STRENGTH_SPREAD = 3;

/** Typical age (mean) for each depth tier; spread applies to all. */
export const TIER_AGE: Record<Tier, number> = { starter: 27, backup: 26, depth: 24.5, camp: 23 };
export const AGE_SPREAD = 2.8;
export const MIN_AGE = 21;
/** Positions whose players typically last longer (or shorter) than average. */
export const POSITION_AGE_SHIFT: Partial<Record<Position, number>> = {
  QB: 1.5,
  K: 2.5,
  P: 2.5,
  LS: 2.5,
  RB: -1,
};
export const MAX_AGE: Partial<Record<Position, number>> = { QB: 40, K: 41, P: 41, LS: 38, RB: 32 };
export const DEFAULT_MAX_AGE = 35;
/** Age when players usually enter the league (mean, spread). */
export const ENTRY_AGE: [number, number] = [22, 0.7];

/** Random wobble on each attribute around the player's level. */
export const ATTRIBUTE_NOISE = 5;
/** How strongly a player's level moves attributes that don't count for their position. */
export const UNRELATED_PHYSICAL_SCALE = 0.35;
export const UNRELATED_SKILL_SCALE = 0.15;

/** Young players' room to grow: points of potential per year under the peak age. */
export const PEAK_AGE = 27;
export const GROWTH_PER_YEAR = 1.8;
/**
 * Real players (Phase 6b): growth room scaled by draft round, since early
 * picks were taken for their ceiling. Later rounds and undrafted players
 * have less expected growth (some still break out: the range is wide).
 */
export const DRAFT_PEDIGREE_GROWTH: Record<number, number> = { 1: 1.35, 2: 1.15, 3: 1.05 };
export const DRAFT_PEDIGREE_GROWTH_LATER = 0.9;
export const UNDRAFTED_GROWTH = 0.75;

/** Hidden traits and personality scores: mean and spread. */
export const TRAIT_MEAN = 55;
export const TRAIT_SPREAD = 15;

/** Jersey number ranges by position (first choice; any free number if these run out). */
export const JERSEY_RANGES: Record<Position, [number, number][]> = {
  QB: [[1, 19]],
  RB: [
    [20, 49],
    [0, 19],
  ],
  FB: [[30, 49]],
  WR: [
    [0, 19],
    [80, 89],
  ],
  TE: [
    [80, 89],
    [40, 49],
  ],
  OT: [
    [60, 79],
    [50, 59],
  ],
  OG: [
    [60, 79],
    [50, 59],
  ],
  C: [[50, 79]],
  EDGE: [
    [90, 99],
    [40, 59],
  ],
  DT: [
    [90, 99],
    [50, 79],
  ],
  LB: [
    [40, 59],
    [0, 9],
  ],
  CB: [
    [20, 39],
    [0, 19],
  ],
  S: [
    [20, 49],
    [0, 19],
  ],
  K: [[1, 19]],
  P: [[1, 19]],
  LS: [
    [40, 59],
    [90, 99],
  ],
};

/** Contract stubs end this many seasons after the first season (inclusive range). */
export const CONTRACT_YEARS_LEFT: [number, number] = [0, 3];

/** Coaching staff per team. */
export const STAFF: {
  role: "HC" | "OC" | "DC" | "STC" | "SCOUT";
  count: number;
  age: [number, number];
}[] = [
  { role: "HC", count: 1, age: [40, 66] },
  { role: "OC", count: 1, age: [34, 62] },
  { role: "DC", count: 1, age: [34, 62] },
  { role: "STC", count: 1, age: [32, 60] },
  { role: "SCOUT", count: 2, age: [27, 62] },
];

/** Age ranges by job, for coaches whose real age isn't known. */
export const COACH_AGE_FALLBACK = Object.fromEntries(STAFF.map((s) => [s.role, s.age])) as Record<
  (typeof STAFF)[number]["role"],
  [number, number]
>;
export const COACH_RATING: [number, number] = [58, 12];
/** Bonus to the rating that matters most for a role. */
export const COACH_ROLE_BONUS = 12;
