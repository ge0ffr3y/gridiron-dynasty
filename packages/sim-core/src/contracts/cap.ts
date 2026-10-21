/**
 * League-level money rules (Phase 7): the salary cap by year, minimum
 * salaries, tenders and the rookie scale, all read from the rules file
 * (`rules.cap`, every value from the CBA or an NFL announcement).
 */
import { assertDollars, type Dollars } from "@fgm/foundation";
import type { CapRules, Rules, TagCategory } from "../rules";

/** NFL caps are announced to the nearest $100,000; projected years follow suit. */
const CAP_ROUNDING = 100_000;

/** The salary cap for a League Year: the real figure where known, else projected. */
export function salaryCap(cap: CapRules, season: number): Dollars {
  const known = cap.salaryCapByYear[String(season)];
  if (known !== undefined) return known;
  const years = Object.keys(cap.salaryCapByYear).map(Number);
  const last = Math.max(...years);
  if (season < Math.min(...years)) return cap.salaryCapByYear[String(Math.min(...years))]!;
  let value = cap.salaryCapByYear[String(last)]!;
  for (let y = last + 1; y <= season; y++) value *= 1 + cap.futureGrowthRate;
  return assertDollars(Math.round(value / CAP_ROUNDING) * CAP_ROUNDING, "projected cap");
}

/**
 * Minimum Paragraph 5 salary (Article 26) for a League Year and a player's
 * credited seasons. After the agreement's last year (2030) the schedule keeps
 * rising by its final step.
 */
export function minimumSalary(
  cap: CapRules,
  season: number,
  creditedSeasons: number,
  list: "active" | "notActive" = "active",
): Dollars {
  const table = cap.minimumSalary[list];
  const floors = cap.minimumSalary.creditedSeasonFloors;
  let column = 0;
  for (let i = 0; i < floors.length; i++) if (creditedSeasons >= floors[i]!) column = i;
  const years = Object.keys(table).map(Number);
  const first = Math.min(...years);
  const last = Math.max(...years);
  if (season <= last) return table[String(Math.max(first, season))]![column]!;
  const step = table[String(last)]![column]! - table[String(last - 1)]![column]!;
  return table[String(last)]![column]! + step * (season - last);
}

/** The tag category (Article 10, Section 7(a)) a position belongs to. */
export function tagCategory(cap: CapRules, position: string): TagCategory {
  const category = cap.tags.positionCategory[position];
  if (!category) throw new Error(`no tag category for position ${position}`);
  return category;
}

/**
 * Restricted free agent tender amounts (Article 9, Section 2): the official
 * 2026 amounts, then growing each year with the cap (rounded to $1,000, as
 * the league publishes them).
 */
export function rfaTenders(
  cap: CapRules,
  season: number,
): {
  firstRound: Dollars;
  secondRound: Dollars;
  originalRound: Dollars;
  rightOfFirstRefusal: Dollars;
} {
  const base = cap.rfaTenders2026;
  const grow = (amount: number) => {
    let value = amount;
    for (let y = 2027; y <= season; y++) {
      const increase = salaryCap(cap, y) / salaryCap(cap, y - 1);
      if (increase > 1) value *= increase;
    }
    return Math.round(value / 1000) * 1000;
  };
  return {
    firstRound: grow(base.firstRound),
    secondRound: grow(base.secondRound),
    originalRound: grow(base.originalRound),
    rightOfFirstRefusal: grow(base.rightOfFirstRefusal),
  };
}

/**
 * A rookie contract's total value and signing bonus by overall pick: four
 * minimum salaries plus the slot's share of the cap above that (interpolated
 * between the rules file's knots), with the slot's signing-bonus share.
 */
export function rookieSlot(
  rules: Rules,
  draftSeason: number,
  overallPick: number,
): { total: Dollars; signingBonus: Dollars; minimums: Dollars[] } {
  const cap = rules.cap;
  const minimums = Array.from({ length: cap.rookieScale.years }, (_, i) =>
    minimumSalary(cap, draftSeason + i, i),
  );
  const knots = cap.rookieScale.picks;
  let above = knots[knots.length - 1]![1];
  let bonusShare = knots[knots.length - 1]![2];
  for (let i = 0; i < knots.length - 1; i++) {
    const [p0, v0, b0] = knots[i]!;
    const [p1, v1, b1] = knots[i + 1]!;
    if (overallPick >= p0 && overallPick <= p1) {
      const t = (overallPick - p0) / (p1 - p0);
      above = v0 + (v1 - v0) * t;
      bonusShare = b0 + (b1 - b0) * t;
      break;
    }
  }
  const floor = minimums.reduce((a, b) => a + b, 0);
  const total = floor + Math.round(above * salaryCap(cap, draftSeason));
  return { total, signingBonus: Math.round(total * bonusShare), minimums };
}

/**
 * Weekly practice-squad pay (CBA Art. 33 Sec. 3): the fixed rate for players with two or fewer
 * accrued seasons, or the veteran minimum. After the table ends it keeps growing by its last step.
 */
export function practiceSquadWeeklyRate(rules: Rules, season: number, veteran: boolean): Dollars {
  const table = rules.roster.practiceSquad.weeklySalary;
  const years = Object.keys(table).map(Number);
  const first = Math.min(...years);
  const last = Math.max(...years);
  const year = Math.min(Math.max(season, first), last);
  let [restricted, veteranMin] = table[String(year)]!;
  if (season > last) {
    const [r0, v0] = table[String(last - 1)]!;
    restricted += (restricted - r0) * (season - last);
    veteranMin += (veteranMin - v0) * (season - last);
  }
  return veteran ? veteranMin : restricted;
}
