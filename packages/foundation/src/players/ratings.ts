import {
  ATTRIBUTES,
  ATTRIBUTE_KEYS,
  FAMILIARITY_PENALTY,
  FORTY_AT_ZERO_SPEED,
  FORTY_PER_SPEED_POINT,
  OVERALL_MAX,
  OVERALL_MIN,
  OVERALL_WEIGHTS,
  PHYSICAL_PROFILE,
  POSITIONS,
  STARTER_OVERALL,
  STARTER_SKILL_BASE,
  UNRELATED_MENTAL_BASE,
  UNRELATED_TECHNICAL_BASE,
  type AttributeKey,
  type Position,
  type Ratings,
} from "./positions";

const PHYSICAL_KEYS: AttributeKey[] = [
  "speed",
  "acceleration",
  "agility",
  "strength",
  "jumping",
  "stamina",
];

/** The attribute values of an average starter at a position. */
export function baseProfile(position: Position): Ratings {
  const weights = OVERALL_WEIGHTS[position];
  const physical = PHYSICAL_PROFILE[position];
  const ratings = {} as Ratings;
  for (const attribute of ATTRIBUTES) {
    const physicalIndex = PHYSICAL_KEYS.indexOf(attribute.key);
    if (physicalIndex >= 0) ratings[attribute.key] = physical[physicalIndex] as number;
    else if (weights[attribute.key]) ratings[attribute.key] = STARTER_SKILL_BASE;
    else
      ratings[attribute.key] =
        attribute.group === "mental" ? UNRELATED_MENTAL_BASE : UNRELATED_TECHNICAL_BASE;
  }
  return ratings;
}

/**
 * For each position, only the attributes that count (in the order of ATTRIBUTE_KEYS, so every sum
 * is added in the same order as before: adding a zero-weight term changes nothing), and their
 * total weight. Overalls are asked for millions of times, so this skips the zeros.
 */
const WEIGHT_TERMS = Object.fromEntries(
  POSITIONS.map((position) => {
    const keys = ATTRIBUTE_KEYS.filter((k) => (OVERALL_WEIGHTS[position][k] ?? 0) !== 0);
    const weights = keys.map((k) => OVERALL_WEIGHTS[position][k] as number);
    let total = 0;
    for (const k of ATTRIBUTE_KEYS) total += OVERALL_WEIGHTS[position][k] ?? 0;
    return [position, { keys, weights, total }];
  }),
) as Record<Position, { keys: AttributeKey[]; weights: number[]; total: number }>;

/** Weighted average of the attributes that count for a position (0-100). */
export function rawScore(ratings: Ratings, position: Position): number {
  const { keys, weights, total } = WEIGHT_TERMS[position];
  let sum = 0;
  for (let i = 0; i < keys.length; i++) sum += weights[i]! * ratings[keys[i]!];
  return sum / total;
}

/**
 * Shift per position so an average starter shows STARTER_OVERALL everywhere.
 * (An average guard is slower than an average corner; overalls stay comparable.)
 */
const OVERALL_OFFSET = Object.fromEntries(
  POSITIONS.map((p) => [p, STARTER_OVERALL - rawScore(baseProfile(p), p)]),
) as Record<Position, number>;

function toOverall(value: number): number {
  return Math.min(OVERALL_MAX, Math.max(OVERALL_MIN, Math.round(value)));
}

/** Overall rating at a position, assuming the player knows it fully. */
export function overallAt(ratings: Ratings, position: Position): number {
  return toOverall(rawScore(ratings, position) + OVERALL_OFFSET[position]);
}

/** Overall at a position, reduced when the player is unfamiliar with it (familiarity 0-1). */
export function overallWithFamiliarity(
  ratings: Ratings,
  position: Position,
  familiarity: number,
): number {
  return toOverall(
    rawScore(ratings, position) +
      OVERALL_OFFSET[position] -
      (1 - familiarity) * FAMILIARITY_PENALTY,
  );
}

/** 40-yard dash time in seconds (two decimals) from the speed rating. */
export function fortyTime(speed: number): number {
  return Math.round((FORTY_AT_ZERO_SPEED - FORTY_PER_SPEED_POINT * speed) * 100) / 100;
}
