/**
 * Retirement (Phase 9): each offseason every player decides whether to keep playing.
 * The chance comes mostly from age against his position's real retirement ages, then
 * from decline, a title, an expiring deal, a fringe role and injury. Free agents nobody
 * played all season retire. Each retirement records its main reason.
 */
import { ageOn, dmath, overallAt, type Rng } from "@fgm/foundation";
import type { League, Player } from "../league/schema";
import { RETIREMENT } from "./config";
import { retirementAges } from "./curves";

export interface RetirementCall {
  chance: number;
  /** The biggest reasons, in plain English (empty when he keeps playing for sure). */
  reasons: string[];
}

function seasonsIdle(p: Player, endedSeason: number): number {
  // A prospect nobody signed, who never played: his whole (short) time in the league was idle.
  if (p.ratingHistory.length === 0 && p.stats.length === 0) return RETIREMENT.idleSeasons;
  let n = 0;
  for (let s = endedSeason; s > endedSeason - 5; s--) {
    if (p.stats.some((st) => st.season === s && (st.line.gp ?? 0) > 0)) break;
    n += 1;
  }
  return n;
}

/** The chance a player retires this offseason, with the reasons behind it. */
export function retirementChance(league: League, p: Player, endedSeason: number): RetirementCall {
  const age = ageOn(p.birthDate, league.date);
  const ages = retirementAges(p.position);
  const late = ages[4]!;
  const typical = ages[2]!;
  const hardLimit = RETIREMENT.maxAge[p.position] ?? RETIREMENT.defaultMaxAge;
  if (age >= hardLimit) return { chance: 1, reasons: [`at ${age}, his body says it's time`] };

  // Free agents: unsigned all season and nobody called.
  if (p.teamId === null) {
    const idle = seasonsIdle(p, endedSeason);
    const limit = age >= RETIREMENT.idleAgeOneSeason ? 1 : RETIREMENT.idleSeasons;
    if (idle >= limit)
      return {
        chance: 1,
        reasons: [`no team played him for ${idle === 1 ? "a season" : `${idle} seasons`}`],
      };
  }

  const parts: { value: number; reason: string }[] = [];
  let logOdds = (age - (late + RETIREMENT.evenOddsPastLateAge)) / RETIREMENT.yearsPerStep;
  if (age >= late) parts.push({ value: 1.5, reason: "late in a career at his position" });
  else if (age >= typical) parts.push({ value: 0.5, reason: "past the usual age at his position" });

  const overall = overallAt(p.ratings, p.position);
  const best = Math.max(overall, ...p.ratingHistory.map((h) => h.overall));
  const fallen = best - overall - RETIREMENT.declineFreePoints;
  if (fallen > 0) {
    logOdds += fallen * RETIREMENT.perPointOfDecline;
    parts.push({
      value: fallen * RETIREMENT.perPointOfDecline,
      reason: `${best - overall} points off his best`,
    });
  }
  const last = league.history.find((h) => h.season === endedSeason);
  const champion =
    last !== undefined &&
    p.stats.some((s) => s.season === endedSeason && s.teamId === last.championId);
  if (champion && age >= typical) {
    logOdds += RETIREMENT.champion;
    parts.push({ value: RETIREMENT.champion, reason: "going out a champion" });
  }
  const deal = p.contract?.years.filter((y) => !y.void) ?? [];
  if (p.teamId !== null && (deal.at(-1)?.season ?? 0) < league.season) {
    logOdds += RETIREMENT.contractUp;
    parts.push({ value: RETIREMENT.contractUp, reason: "his contract was up" });
  }
  if (overall < RETIREMENT.fringeOverall && age >= RETIREMENT.fringeAge) {
    logOdds += RETIREMENT.fringe;
    parts.push({ value: RETIREMENT.fringe, reason: "a fringe role at this stage" });
  }
  if ((p.injury?.gamesRemaining ?? 0) >= RETIREMENT.injuredGames && age >= RETIREMENT.injuredAge) {
    logOdds += RETIREMENT.injured;
    parts.push({ value: RETIREMENT.injured, reason: "another long recovery ahead" });
  }
  const severe = p.injuryHistory.some((h) => h.season === endedSeason && h.games >= 9);
  if (severe && age >= RETIREMENT.severeInjuryAge) {
    logOdds += RETIREMENT.severeInjury;
    parts.push({ value: RETIREMENT.severeInjury, reason: "a severe injury last season" });
  }
  const chance = dmath.logistic(Math.max(RETIREMENT.floor, logOdds));
  return {
    chance,
    reasons: parts
      .sort((a, b) => b.value - a.value)
      .slice(0, 2)
      .map((x) => x.reason),
  };
}

/** Rolls the dice for one player: the reason he retires, or null if he keeps playing. */
export function decideRetirement(
  league: League,
  p: Player,
  endedSeason: number,
  rng: Rng,
): string | null {
  const call = retirementChance(league, p, endedSeason);
  if (call.chance <= 0 || !rng.chance(call.chance)) return null;
  const why = call.reasons.length ? call.reasons.join(", ") : "ready for life after football";
  return `Retired at ${ageOn(p.birthDate, league.date)}: ${why}.`;
}
