/**
 * Real players' ratings on our scale.
 *
 * Madden-rated players: each attribute is moved onto our scale position by
 * position, so real starters have the same average and spread as starters in
 * our generated leagues (which the engine is calibrated on), while keeping
 * Madden's order and gaps between players.
 *
 * Players Madden doesn't have (signed after its release, long snappers):
 * ratings are generated around a target overall from their 2025 role and
 * draft position, with combine speed where known.
 */
import {
  ATTRIBUTE_KEYS,
  FORTY_AT_ZERO_SPEED,
  FORTY_PER_SPEED_POINT,
  overallAt,
  POSITIONS,
  createLeague,
  type AttributeKey,
  type Position,
  type Ratings,
} from "@fgm/sim-core";
import { TUNING } from "@fgm/game-engine";
import type { MaddenPlayer } from "./madden";
import { rawAttributes } from "./madden";
import type { RealPerson } from "./roster";

/** Starters per team at each position (as in the generator's depth tiers). */
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

/** Reference leagues whose starters set the target scale. */
const REFERENCE_SEEDS = [1, 2, 3, 4];

/** Target overall for a player without Madden ratings, by his 2025 role. */
export const FALLBACK = {
  /** [minimum snap share on his main side, target overall], best first. */
  byRole: [
    [0.6, 72],
    [0.3, 66],
    [0.05, 60],
    [0, 55],
  ] as [number, number][],
  /**
   * Kickers, punters and snappers: anyone who did the job in 2025, even for
   * part of the season after signing late, is an average starter (a team
   * keeps one); someone who never did is a camp leg.
   */
  specialists: [
    [0.01, 75],
    [0, 60],
  ] as [number, number][],
  /** Extra overall for recent high draft picks (seasons in the league <= recentYears). */
  draftBonus: { 1: 6, 2: 4, 3: 2 } as Record<number, number>,
  recentYears: 3,
};

type Stats = Record<AttributeKey, { mean: number; sd: number }>;

function describe(groups: Ratings[] | Record<AttributeKey, number>[]): Stats {
  const out = {} as Stats;
  for (const key of ATTRIBUTE_KEYS) {
    const values = groups.map((g) => g[key]);
    const mean = values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
    const variance =
      values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / Math.max(1, values.length - 1);
    out[key] = { mean, sd: Math.sqrt(variance) };
  }
  return out;
}

/** The top `n` per team at a position, by a score. */
function starters<T>(
  items: T[],
  team: (t: T) => string | null,
  score: (t: T) => number,
  n: number,
): T[] {
  const byTeam = new Map<string, T[]>();
  for (const it of items) {
    const t = team(it);
    if (t === null) continue;
    byTeam.set(t, [...(byTeam.get(t) ?? []), it]);
  }
  const out: T[] = [];
  for (const list of byTeam.values())
    out.push(...list.sort((a, b) => score(b) - score(a)).slice(0, n));
  return out;
}

/** Starter attribute averages and spreads in generated leagues, per position. */
function referenceScale(): Record<Position, Stats> {
  const leagues = REFERENCE_SEEDS.map((seed) => createLeague({ seed, name: "Reference" }));
  const out = {} as Record<Position, Stats>;
  for (const position of POSITIONS) {
    const all = leagues.flatMap((l, i) =>
      l.players
        .filter((p) => p.position === position)
        .map((p) => ({ p, team: `${i}:${p.teamId}` })),
    );
    const top = starters(
      all,
      (x) => x.team,
      (x) => overallAt(x.p.ratings, position),
      STARTERS[position],
    ).map((x) => x.p);
    out[position] = describe(top.map((p) => p.ratings));
  }
  return out;
}

export interface RatingResult {
  ratings: Map<string, Ratings | { targetOverall: number }>;
  /** Generated leagues' starter averages and spreads, per position (the target scale). */
  reference: Record<Position, Stats>;
  /** Players with Madden ratings vs. generated ones, for the report. */
  fromMadden: number;
  generated: number;
}

/** Spreads closer than this (on Madden's scale) are treated as this, so near-constant attributes don't blow up. */
const MIN_SPREAD = 3;

export function buildRatings(
  people: RealPerson[],
  madden: Map<string, MaddenPlayer>,
): RatingResult {
  const reference = referenceScale();
  const raw = new Map<string, Record<AttributeKey, number>>();
  for (const p of people) {
    const m = madden.get(p.gsis);
    if (m && p.position !== "LS") raw.set(p.gsis, rawAttributes(m));
  }

  // Real starters' spread on Madden's scale, per position.
  const real = {} as Record<Position, Stats>;
  for (const position of POSITIONS) {
    const rated = people.filter((p) => p.position === position && raw.has(p.gsis));
    const top = starters(
      rated,
      (p) => p.teamId,
      (p) => madden.get(p.gsis)!.overall,
      STARTERS[position],
    );
    real[position] = describe(top.map((p) => raw.get(p.gsis)!));
  }

  const ratings = new Map<string, Ratings | { targetOverall: number }>();
  let fromMadden = 0;
  let generated = 0;
  for (const p of people) {
    const r = raw.get(p.gsis);
    if (r && real[p.position].speed.sd > 0) {
      const ours = {} as Ratings;
      for (const key of ATTRIBUTE_KEYS) {
        const from = real[p.position][key];
        const to = reference[p.position][key];
        const z = (r[key] - from.mean) / Math.max(MIN_SPREAD, from.sd);
        ours[key] = Math.round(Math.min(99, Math.max(1, to.mean + z * to.sd)));
      }
      ratings.set(p.gsis, ours);
      fromMadden += 1;
    } else {
      const specialist = p.position === "K" || p.position === "P" || p.position === "LS";
      const side = specialist
        ? p.snapShare.special
        : Math.max(p.snapShare.offense, p.snapShare.defense);
      let target = (specialist ? FALLBACK.specialists : FALLBACK.byRole).find(
        ([share]) => side >= share,
      )![1];
      if (p.draft && p.yearsBefore + 1 <= FALLBACK.recentYears)
        target += FALLBACK.draftBonus[p.draft.round] ?? 0;
      ratings.set(p.gsis, { targetOverall: target });
      generated += 1;
    }
  }
  return { ratings, reference, fromMadden, generated };
}

/**
 * Kickers and punters: the engine's kicking (touchbacks, field-goal range and
 * accuracy, punt distance) is tuned around an average kicker of
 * `TUNING.averageKicker`, which is what generated leagues' starters average.
 * Madden's kicking numbers come in coarse steps and land real starters a few
 * points lower, so line up the starters' leg and accuracy averages with it
 * (everyone at the position moves alike, keeping Madden's order).
 */
export function alignSpecialists(
  people: RealPerson[],
  result: RatingResult,
): Record<string, number> {
  const moves: Record<string, number> = {};
  for (const position of ["K", "P"] as const) {
    const rated = people.filter((p) => p.position === position && p.teamId !== null);
    const ratingsOf = (p: RealPerson) => result.ratings.get(p.gsis)!;
    const full = rated.filter((p) => !("targetOverall" in ratingsOf(p)));
    const top = starters(
      full,
      (p) => p.teamId,
      (p) => overallAt(ratingsOf(p) as Ratings, position),
      STARTERS[position],
    );
    for (const key of ["kickPower", "kickAccuracy"] as const) {
      const mean =
        top.reduce((a, p) => a + (ratingsOf(p) as Ratings)[key], 0) / Math.max(1, top.length);
      const shift = Math.round(TUNING.averageKicker - mean);
      moves[`${position} ${key}`] = shift;
      for (const p of full) {
        const r = ratingsOf(p) as Ratings;
        r[key] = Math.min(99, Math.max(1, r[key] + shift));
      }
    }
  }
  return moves;
}
