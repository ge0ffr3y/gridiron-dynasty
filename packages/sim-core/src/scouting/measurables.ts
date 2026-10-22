/**
 * Combine drills (Phase 11). A prospect's drill results come from his true
 * physical ratings, placed on the real distribution of that drill for his
 * position (calibration/draft.json, combine invitees since 2010): a prospect
 * as fast as a typical prospect at his position runs that position's typical
 * 40. Drills only partly reflect the ratings (a good or bad day, technique),
 * and some prospects skip drills at the real rates.
 *
 * The reverse turns the real 2026 class's drills into physical ratings.
 */
import {
  ATTRIBUTES,
  Rng,
  streamSeed,
  type AttributeKey,
  type Position,
  type Ratings,
} from "@fgm/foundation";
import draftData from "../../../../calibration/draft.json";
import { generateRatings } from "../generate/players";
import { DRAFT_CLASS } from "../roster/config";
import { meanOverall } from "./strength";
import type { Measurables } from "../league/schema";
import { normalFrom, uniformFrom } from "./noise";

export const DRILLS = ["forty", "bench", "vertical", "broadJump", "cone", "shuttle"] as const;
export type Drill = (typeof DRILLS)[number];

/** Each drill's name in calibration/draft.json. */
const DATA_KEY: Record<Drill, string> = {
  forty: "forty",
  bench: "bench",
  vertical: "vertical",
  broadJump: "broad_jump",
  cone: "cone",
  shuttle: "shuttle",
};

/**
 * What each drill measures (weights add to 1), and whether a lower number is better (timed
 * drills). Judgment, checked against the drills' real correlations with each other.
 */
export const DRILL_LOADINGS: Record<
  Drill,
  { lowerIsBetter: boolean; on: Partial<Record<AttributeKey, number>> }
> = {
  forty: { lowerIsBetter: true, on: { speed: 0.85, acceleration: 0.15 } },
  bench: { lowerIsBetter: false, on: { strength: 1 } },
  vertical: { lowerIsBetter: false, on: { jumping: 1 } },
  broadJump: { lowerIsBetter: false, on: { jumping: 0.6, speed: 0.4 } },
  cone: { lowerIsBetter: true, on: { agility: 0.8, acceleration: 0.2 } },
  shuttle: { lowerIsBetter: true, on: { agility: 0.6, acceleration: 0.4 } },
};

export const MEASURABLES = {
  /** How closely a drill follows the ratings behind it (the rest is the day and technique). */
  ratingCorrelation: 0.85,
  /** The reference sample: the top this-many of a class (about the real combine invitees). */
  referenceRanks: 340,
  referenceSamples: 1360,
  referenceSeed: 20260223,
  /** Drill results' rounding: hundredths for timed drills, half inches for jumps, whole reps. */
  decimals: { forty: 2, bench: 0, vertical: 1, broadJump: 0, cone: 2, shuttle: 2 } as Record<
    Drill,
    number
  >,
  /** A 40 time for a position the real data lacks (never expected: every position has one). */
  fallbackForty: 4.8,
};

type DrillStats = { mean: number; spread: number; tested: number };
// Each position's row also carries its invitee count (a number), never read as a drill.
const REAL = draftData.combine.measurables as unknown as Record<string, Record<string, DrillStats>>;

/** The real distribution of a drill at a position (long snappers use centers' when missing). */
function realDrill(position: Position, drill: Drill): DrillStats | null {
  const row = REAL[position] ?? (position === "LS" ? REAL["C"] : undefined);
  return row?.[DATA_KEY[drill]] ?? null;
}

const PHYSICAL_KEYS = ATTRIBUTES.filter((a) => a.group === "physical").map((a) => a.key);

/**
 * A typical combine invitee's physical rating at a position, and its spread, measured once from
 * a fixed sample of generated prospects (ranked like the real invitees: the top
 * `referenceRanks` of a class). Fixed seed, own stream: it never touches a league's randomness.
 */
const REFERENCE = new Map<string, { mean: number; sd: number }>();

export function prospectReference(
  position: Position,
  key: AttributeKey,
): { mean: number; sd: number } {
  const cached = REFERENCE.get(`${position}:${key}`);
  if (cached) return cached;
  const M = MEASURABLES;
  const rng = new Rng(streamSeed(M.referenceSeed, `reference:${position}`));
  const samples = Array.from({ length: M.referenceSamples }, (_, i) => {
    const rank = 1 + (i % M.referenceRanks);
    return generateRatings(
      rng,
      position,
      rng.gaussian(meanOverall(rank), DRAFT_CLASS.overallSpread),
    );
  });
  for (const k of PHYSICAL_KEYS) {
    const xs = samples.map((r) => r[k]);
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    const variance = xs.reduce((a, x) => a + (x - mean) * (x - mean), 0) / xs.length;
    REFERENCE.set(`${position}:${k}`, { mean, sd: Math.max(1, Math.sqrt(variance)) });
  }
  return REFERENCE.get(`${position}:${key}`)!;
}

function roundTo(x: number, decimals: number): number {
  const f = decimals === 2 ? 100 : decimals === 1 ? 10 : 1;
  return Math.round(x * f) / f;
}

/** How a prospect's physical ratings compare with a typical prospect's at his position (z-scores). */
function physicalZ(ratings: Ratings, position: Position): Partial<Record<AttributeKey, number>> {
  const z: Partial<Record<AttributeKey, number>> = {};
  for (const key of PHYSICAL_KEYS) {
    const ref = prospectReference(position, key);
    z[key] = (ratings[key] - ref.mean) / ref.sd;
  }
  return z;
}

/** A drill's result from z-scores (higher z = better result). */
function drillValue(position: Position, drill: Drill, betterZ: number): number | null {
  const real = realDrill(position, drill);
  if (!real) return null;
  const sign = DRILL_LOADINGS[drill].lowerIsBetter ? -1 : 1;
  return roundTo(real.mean + sign * real.spread * betterZ, MEASURABLES.decimals[drill]);
}

/**
 * A prospect's true drill results: his ratings plus a day's noise, with drills he skips left
 * null (skipping follows the real share tested at his position, invitees and pro days alike).
 * `key` makes the draws stable (no random numbers drawn).
 */
export function drillResults(ratings: Ratings, position: Position, key: string): Measurables {
  const z = physicalZ(ratings, position);
  const r = MEASURABLES.ratingCorrelation;
  const rest = Math.sqrt(1 - r * r);
  const out = {} as Measurables;
  for (const drill of DRILLS) {
    const real = realDrill(position, drill);
    if (!real || uniformFrom(`${key}:${drill}:skip`) >= real.tested) {
      out[drill] = null;
      continue;
    }
    let composite = 0;
    for (const [attr, w] of Object.entries(DRILL_LOADINGS[drill].on))
      composite += w * (z[attr as AttributeKey] ?? 0);
    out[drill] = drillValue(position, drill, r * composite + rest * normalFrom(`${key}:${drill}`));
  }
  return out;
}

/**
 * The reverse, for the real class: physical ratings from real drill results. Each attribute
 * moves from the typical prospect's level by what the drills that measure it say (weighted by
 * how much each drill measures it, shrunk by how closely drills follow ratings). Attributes no
 * drill measured keep `fallback`'s value; stamina is never measured.
 */
export function physicalsFromDrills(
  drills: Measurables,
  position: Position,
  fallback: Ratings,
): Partial<Record<AttributeKey, number>> {
  const sums: Partial<Record<AttributeKey, { z: number; w: number }>> = {};
  for (const drill of DRILLS) {
    const value = drills[drill];
    const real = realDrill(position, drill);
    if (value === null || !real || real.spread <= 0) continue;
    const sign = DRILL_LOADINGS[drill].lowerIsBetter ? -1 : 1;
    const betterZ = (sign * (value - real.mean)) / real.spread;
    for (const [attr, w] of Object.entries(DRILL_LOADINGS[drill].on)) {
      const s = (sums[attr as AttributeKey] ??= { z: 0, w: 0 });
      s.z += w * betterZ;
      s.w += w;
    }
  }
  const out: Partial<Record<AttributeKey, number>> = {};
  for (const key of PHYSICAL_KEYS) {
    const s = sums[key];
    if (!s || s.w === 0) {
      out[key] = fallback[key];
      continue;
    }
    const ref = prospectReference(position, key);
    const z = (MEASURABLES.ratingCorrelation * s.z) / s.w;
    out[key] = Math.max(1, Math.min(99, Math.round(ref.mean + z * ref.sd)));
  }
  return out;
}

/**
 * A player's estimated 40 time from his (perceived) speed and acceleration, on the same scale as
 * the combine: the real drill's mean and spread at his position. Shown when he has no measured 40.
 */
export function estimatedForty(ratings: Ratings, position: Position): number {
  const z = physicalZ(ratings, position);
  const on = DRILL_LOADINGS.forty.on;
  const composite =
    (on.speed ?? 0) * (z.speed ?? 0) + (on.acceleration ?? 0) * (z.acceleration ?? 0);
  return (
    drillValue(position, "forty", MEASURABLES.ratingCorrelation * composite) ??
    MEASURABLES.fallbackForty
  );
}
