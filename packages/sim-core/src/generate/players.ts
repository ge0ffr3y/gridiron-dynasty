/**
 * Generated players: size, age, ratings, hidden traits, and personality,
 * shaped by position and by where the player sits on the depth chart.
 */
import { addDays, type LeagueDate } from "../dates";
import type { DraftPick, Player } from "../league/schema";
import {
  ALTERNATE_POSITIONS,
  ATTRIBUTES,
  OVERALL_WEIGHTS,
  SIZE_PROFILE,
  STARTER_OVERALL,
  type Position,
  type Ratings,
} from "../players/positions";
import { baseProfile, overallAt } from "../players/ratings";
import type { Rng } from "../rng";
import {
  AGE_SPREAD,
  ATTRIBUTE_NOISE,
  CONTRACT_YEARS_LEFT,
  DEFAULT_MAX_AGE,
  ENTRY_AGE,
  GROWTH_PER_YEAR,
  JERSEY_RANGES,
  MAX_AGE,
  MIN_AGE,
  PEAK_AGE,
  POSITION_AGE_SHIFT,
  STARTERS,
  TIER_AGE,
  TIER_OVERALL,
  TRAIT_MEAN,
  TRAIT_SPREAD,
  UNRELATED_PHYSICAL_SCALE,
  UNRELATED_SKILL_SCALE,
  type Tier,
} from "./config";
import type { NamePicker } from "./people";
import { bounded, randomShares, score } from "./util";

/** Which depth tier the n-th player (0-based) at a position falls in. */
export function tierFor(position: Position, slot: number, count: number): Tier {
  const starters = STARTERS[position];
  if (slot < starters) return "starter";
  if (slot < starters * 2) return "backup";
  const rest = count - starters * 2;
  return slot < starters * 2 + Math.ceil(rest / 2) ? "depth" : "camp";
}

function generateRatings(rng: Rng, position: Position, targetOverall: number): Ratings {
  const base = baseProfile(position);
  const delta = targetOverall - STARTER_OVERALL;
  const ratings = {} as Ratings;
  for (const attribute of ATTRIBUTES) {
    const counts = (OVERALL_WEIGHTS[position][attribute.key] ?? 0) > 0;
    const scale = counts
      ? 1
      : attribute.group === "physical"
        ? UNRELATED_PHYSICAL_SCALE
        : UNRELATED_SKILL_SCALE;
    ratings[attribute.key] = bounded(
      base[attribute.key] + delta * scale + rng.gaussian(0, ATTRIBUTE_NOISE),
      1,
      99,
    );
  }
  return ratings;
}

function pickJersey(rng: Rng, position: Position, taken: Set<number>): number {
  for (const [low, high] of JERSEY_RANGES[position]) {
    const free: number[] = [];
    for (let n = low; n <= high; n++) if (!taken.has(n)) free.push(n);
    if (free.length > 0) return rng.pick(free);
  }
  const anyFree: number[] = [];
  for (let n = 0; n <= 99; n++) if (!taken.has(n)) anyFree.push(n);
  return rng.pick(anyFree);
}

export interface PlayerContext {
  rng: Rng;
  names: NamePicker;
  date: LeagueDate;
  season: number;
  teamIds: string[];
  draftRounds: number;
  colleges: readonly string[];
}

/** One player for a team's roster. */
export function generatePlayer(
  ctx: PlayerContext,
  id: number,
  teamId: string,
  position: Position,
  tier: Tier,
  teamStrength: number,
  jerseysTaken: Set<number>,
): Player {
  const { rng } = ctx;
  const [tierMean, tierSpread] = TIER_OVERALL[tier];
  const strength = tier === "starter" || tier === "backup" ? teamStrength : 0;
  const target = rng.gaussian(tierMean + strength, tierSpread);
  const ratings = generateRatings(rng, position, target);
  const overall = overallAt(ratings, position);

  // Age, experience, and birthday.
  const maxAge = MAX_AGE[position] ?? DEFAULT_MAX_AGE;
  const age = bounded(
    rng.gaussian(TIER_AGE[tier] + (POSITION_AGE_SHIFT[position] ?? 0), AGE_SPREAD),
    MIN_AGE,
    maxAge,
  );
  const entryAge = bounded(rng.gaussian(ENTRY_AGE[0], ENTRY_AGE[1]), MIN_AGE, MIN_AGE + 3);
  const experience = Math.max(0, age - entryAge);
  // Born between one year and one day before this date `age` years ago, so they are exactly `age` today.
  const birthDate = addDays(
    `${Number(ctx.date.slice(0, 4)) - age}${ctx.date.slice(4)}`,
    -rng.int(365),
  );

  // Size: taller players run heavier.
  const size = SIZE_PROFILE[position];
  const heightIn = bounded(
    rng.gaussian(size.height[0], size.height[1]),
    size.height[0] - 6,
    size.height[0] + 6,
  );
  const weightLb = bounded(
    rng.gaussian(size.weight[0] + (heightIn - size.height[0]) * 4, size.weight[1]),
    150,
    380,
  );

  // Draft history: better players tend to have gone earlier; some went undrafted.
  const expectedRound = 1 + (82 - overall) / 4 + rng.gaussian(0, 1.2);
  const round = Math.max(1, Math.round(expectedRound));
  const drafted =
    experience > 0 && round <= ctx.draftRounds
      ? {
          season: ctx.season - experience,
          round,
          pick: (round - 1) * ctx.teamIds.length + 1 + rng.int(ctx.teamIds.length),
          teamId: rng.chance(0.6) ? teamId : rng.pick(ctx.teamIds),
        }
      : null;

  // Other positions the player knows.
  const familiarity: Player["familiarity"] = { [position]: 1 };
  for (const alt of ALTERNATE_POSITIONS[position] ?? []) {
    if (rng.chance(alt.chance))
      familiarity[alt.position] = Math.round(rng.range(0.4, 0.95) * 100) / 100;
  }

  // Hidden traits: young players have room to grow.
  const growthRoom = age < PEAK_AGE ? (PEAK_AGE - age) * GROWTH_PER_YEAR * rng.range(0.2, 1.3) : 0;
  const potential = bounded(overall + Math.max(0, growthRoom + rng.gaussian(0, 2)), overall, 99);
  const [money, winning, role, location] = randomShares(rng, 4) as [number, number, number, number];

  const jersey = pickJersey(rng, position, jerseysTaken);
  jerseysTaken.add(jersey);
  const { firstName, lastName } = ctx.names.next();

  return {
    id,
    firstName,
    lastName,
    position,
    teamId,
    jersey,
    birthDate,
    heightIn,
    weightLb,
    experience,
    college: rng.pick(ctx.colleges),
    drafted,
    ratings,
    familiarity,
    hidden: {
      potential,
      workEthic: score(rng, TRAIT_MEAN, TRAIT_SPREAD),
      consistency: score(rng, TRAIT_MEAN, TRAIT_SPREAD),
      injuryProneness: score(rng, TRAIT_MEAN - 10, TRAIT_SPREAD),
      durability: score(rng, TRAIT_MEAN, TRAIT_SPREAD),
      coachability: score(rng, TRAIT_MEAN, TRAIT_SPREAD),
      clutch: score(rng, TRAIT_MEAN - 5, TRAIT_SPREAD),
    },
    personality: {
      ego: score(rng, TRAIT_MEAN - 5, TRAIT_SPREAD),
      loyalty: score(rng, TRAIT_MEAN, TRAIT_SPREAD),
      leadership: score(rng, TRAIT_MEAN - 5, TRAIT_SPREAD),
      temperament: score(rng, TRAIT_MEAN, TRAIT_SPREAD),
      priorities: { money, winning, role, location },
    },
    contract: {
      teamId,
      expiresAfterSeason:
        ctx.season + rng.intBetween(CONTRACT_YEARS_LEFT[0], CONTRACT_YEARS_LEFT[1]),
    },
  };
}

/** Each team's own picks for the current draft and the following ones. */
export function generateDraftPicks(
  season: number,
  seasons: number,
  rounds: number,
  teamIds: string[],
  firstId: number,
): DraftPick[] {
  const picks: DraftPick[] = [];
  let id = firstId;
  for (let s = season; s < season + seasons; s++) {
    for (let round = 1; round <= rounds; round++) {
      for (const teamId of teamIds)
        picks.push({
          id: id++,
          season: s,
          round,
          originalTeamId: teamId,
          ownerTeamId: teamId,
          overall: null,
        });
    }
  }
  return picks;
}
