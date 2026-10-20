/**
 * Placeholder game results until the play-by-play engine arrives (Phase 3).
 *
 * Each team's touchdowns and field goals are drawn around a typical NFL
 * scoring rate, tilted by the difference in starter strength and by home
 * field. Crude, but scores look like football and better teams win more.
 */
import type { GameResult } from "../league/schema";
import { exp } from "../math";
import type { Rng } from "../rng";

/** Tuning (CLAUDE.md, rule 4). Real NFL teams average roughly 2.4 TDs and 1.7 FGs a game. */
export const PLACEHOLDER = {
  averagePoints: 22,
  /** Expected points per point of starter-strength difference. */
  pointsPerStrength: 0.9,
  /** Home-field edge in expected points (split between the two teams). */
  homeEdge: 2,
  touchdownShare: 0.76,
  fieldGoalShare: 0.235,
  extraPointRate: 0.95,
  safetyChance: 0.02,
  /** Chance a regular-season game tied after regulation stays tied after overtime. */
  overtimeTieChance: 0.08,
  minimumExpectedPoints: 6,
};

/** A Poisson draw (Knuth's method; fine for the small means used here). */
function poisson(rng: Rng, mean: number): number {
  const limit = exp(-mean);
  let k = 0;
  let product = rng.next();
  while (product > limit) {
    k++;
    product *= rng.next();
  }
  return k;
}

function teamScore(rng: Rng, expected: number): { points: number; touchdowns: number } {
  const p = PLACEHOLDER;
  const touchdowns = poisson(rng, (expected * p.touchdownShare) / (6 + p.extraPointRate));
  const fieldGoals = poisson(rng, (expected * p.fieldGoalShare) / 3);
  let points = fieldGoals * 3 + (rng.chance(p.safetyChance) ? 2 : 0);
  for (let i = 0; i < touchdowns; i++) points += rng.chance(p.extraPointRate) ? 7 : 6;
  return { points, touchdowns };
}

/**
 * Plays a game. `homeStrength`/`awayStrength` are average starter overalls.
 * Playoff games (`allowTie` false) always produce a winner.
 */
export function playPlaceholderGame(
  rng: Rng,
  homeStrength: number,
  awayStrength: number,
  neutral: boolean,
  allowTie: boolean,
): GameResult {
  const p = PLACEHOLDER;
  const edge = (homeStrength - awayStrength) * p.pointsPerStrength + (neutral ? 0 : p.homeEdge);
  const home = teamScore(rng, Math.max(p.minimumExpectedPoints, p.averagePoints + edge / 2));
  const away = teamScore(rng, Math.max(p.minimumExpectedPoints, p.averagePoints - edge / 2));
  let overtime = false;
  if (home.points === away.points && !(allowTie && rng.chance(p.overtimeTieChance))) {
    // Overtime: the stronger side is a little more likely to score first.
    overtime = true;
    const homeWins = rng.chance(Math.min(0.8, Math.max(0.2, 0.5 + edge / 40)));
    const winner = homeWins ? home : away;
    if (rng.chance(0.5)) {
      winner.points += 6;
      winner.touchdowns += 1;
    } else winner.points += 3;
  } else if (home.points === away.points) overtime = true;
  return {
    homeScore: home.points,
    awayScore: away.points,
    homeTouchdowns: home.touchdowns,
    awayTouchdowns: away.touchdowns,
    overtime,
  };
}
