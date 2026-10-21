/**
 * What a contract costs, year by year (Phase 7). Pure functions: no
 * randomness, no league state.
 *
 * Cap accounting follows Article 13, Section 6 of the CBA: bonuses are spread
 * equally over up to five League Years (any leftover dollars go to the
 * earliest years); salary, roster and workout bonuses and "likely to be
 * earned" incentives count in the year they're earned.
 */
import { splitEvenly, type Dollars } from "@fgm/foundation";
import type { Bonus, Contract, ContractYear } from "../league/schema";
import type { CapRules } from "../rules";
import { minimumSalary } from "./cap";

export function yearOf(c: Contract, season: number): ContractYear | undefined {
  return c.years.find((y) => y.season === season);
}

/** First and last League Years the contract covers (void years included). */
export function span(c: Contract): { first: number; last: number; lastReal: number } {
  const real = c.years.filter((y) => !y.void);
  return {
    first: c.years[0]!.season,
    last: c.years[c.years.length - 1]!.season,
    lastReal: (real[real.length - 1] ?? c.years[0]!).season,
  };
}

/** One bonus's cap charge in a League Year. */
export function bonusShare(b: Bonus, season: number): Dollars {
  const i = b.seasons.indexOf(season);
  return i < 0 ? 0 : splitEvenly(b.amount, b.seasons.length)[i]!;
}

/** All bonus proration charged to a League Year. */
export function proration(c: Contract, season: number): Dollars {
  return c.bonuses.reduce((sum, b) => sum + bonusShare(b, season), 0);
}

/** Bonus proration still to be charged from `season` on (what accelerates if he's cut). */
export function remainingProration(c: Contract, fromSeason: number): Dollars {
  let sum = 0;
  for (const b of c.bonuses)
    for (const s of b.seasons) if (s >= fromSeason) sum += bonusShare(b, s);
  return sum;
}

/** Salary guaranteed for skill, injury and cap from `fromSeason` on, counting injury guarantees that vested by `onDate`. */
export function remainingGuarantees(c: Contract, fromSeason: number, onDate?: string): Dollars {
  let sum = 0;
  for (const y of c.years) {
    if (y.season < fromSeason) continue;
    sum += y.guaranteed;
    if (onDate && y.vestsOn && y.vestsOn <= onDate) sum += y.injuryGuaranteed;
  }
  return sum;
}

/** The salary that counts on the cap: a veteran-benefit deal counts at the lower minimum. */
function countedBase(c: Contract, y: ContractYear, cap: CapRules): Dollars {
  if (!c.veteranSalaryBenefit) return y.base;
  return Math.min(
    y.base,
    minimumSalary(cap, y.season, cap.veteranSalaryBenefit.chargedAsCreditedSeasons),
  );
}

/** The contract's charge against one League Year's cap while he's on the team. */
export function capHit(c: Contract, season: number, cap: CapRules): Dollars {
  const y = yearOf(c, season);
  const prorated = proration(c, season);
  if (!y) return prorated;
  const likely = y.incentives.filter((i) => i.likely).reduce((a, i) => a + i.amount, 0);
  return (
    countedBase(c, y, cap) + y.rosterBonus + y.workoutBonus + y.perGameBonus + likely + prorated
  );
}

/** The parts of a League Year's charge, for the contract page. */
export function capParts(
  c: Contract,
  season: number,
  cap: CapRules,
): { base: Dollars; bonuses: Dollars; proration: Dollars; incentives: Dollars; total: Dollars } {
  const y = yearOf(c, season);
  const prorated = proration(c, season);
  const base = y ? countedBase(c, y, cap) : 0;
  const bonuses = y ? y.rosterBonus + y.workoutBonus + y.perGameBonus : 0;
  const incentives = y ? y.incentives.filter((i) => i.likely).reduce((a, i) => a + i.amount, 0) : 0;
  return {
    base,
    bonuses,
    proration: prorated,
    incentives,
    total: base + bonuses + prorated + incentives,
  };
}

/**
 * Cash paid to the player in a League Year if he plays it out: salary and
 * bonuses due that year (incentives as earned: `earned` lists the amounts),
 * plus any bonus paid that year.
 */
export function cashIn(c: Contract, season: number, earnedIncentives = 0): Dollars {
  const y = yearOf(c, season);
  const paidBonuses = c.bonuses
    .filter((b) => b.paidIn === season)
    .reduce((a, b) => a + b.amount, 0);
  if (!y) return paidBonuses;
  return y.base + y.rosterBonus + y.workoutBonus + y.perGameBonus + earnedIncentives + paidBonuses;
}

/** Total value: every salary, bonus and incentive over the contract. */
export function totalValue(c: Contract): Dollars {
  let sum = c.bonuses.reduce((a, b) => a + b.amount, 0);
  for (const y of c.years)
    sum +=
      y.base +
      y.rosterBonus +
      y.workoutBonus +
      y.perGameBonus +
      y.incentives.reduce((a, i) => a + i.amount, 0);
  return sum;
}

/** Money he's guaranteed at signing: bonuses plus guaranteed salary. */
export function guaranteedAtSigning(c: Contract): Dollars {
  return (
    c.bonuses.reduce((a, b) => a + b.amount, 0) +
    c.years.reduce((a, y) => a + y.guaranteed + y.injuryGuaranteed, 0)
  );
}

/** Real (non-void) years left from `season` on. */
export function yearsLeft(c: Contract, season: number): number {
  return c.years.filter((y) => !y.void && y.season >= season).length;
}

/**
 * The League Years a new bonus paid in `season` is spread over: this year and
 * the contract's later years, at most five (void years count, which is why
 * teams add them).
 */
export function prorationSeasons(c: Contract, season: number, maxYears: number): number[] {
  return c.years
    .map((y) => y.season)
    .filter((s) => s >= season)
    .slice(0, maxYears);
}
