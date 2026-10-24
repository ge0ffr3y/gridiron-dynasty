/**
 * Franchise and transition tags and fifth-year option salaries (Phase 7).
 *
 * Article 10 sets each tag from a "Cap Percentage Average": add up the
 * position's top salaries for the five previous League Years, divide by those
 * years' caps, and multiply by this year's cap. The league keeps each year's
 * top 25 salaries by position category (`league.salaryHistory`) to do that.
 * 2026 uses the officially published values.
 */
import type { Dollars } from "@fgm/foundation";
import type { League } from "../league/schema";
import type { CapRules, TagCategory } from "../rules";
import { salaryCap, tagCategory } from "./cap";
import { bonusShare, yearOf } from "./contract";

/** How many top salaries per category are kept each year (enough for the option's 3rd-25th). */
export const SALARY_HISTORY_DEPTH = 25;
export const OFFICIAL_TAG_SEASON = 2026;

/**
 * A player's "Salary" for a League Year in Article 10's sense: salary, roster
 * and workout bonuses and bonus proration (not performance incentives).
 */
export function tagSalary(league: League, playerId: number, season: number): Dollars {
  const p = league.players.find((x) => x.id === playerId);
  const c = p?.contract;
  if (!c) return 0;
  const y = yearOf(c, season);
  const prorated = c.bonuses.reduce((a, b) => a + bonusShare(b, season), 0);
  return (y ? y.base + y.rosterBonus + y.workoutBonus + y.perGameBonus : 0) + prorated;
}

/** The top salaries at each tag category for a League Year, highest first. */
export function topSalaries(league: League, season: number): Record<TagCategory, Dollars[]> {
  const cap = league.rules.cap;
  const out = Object.fromEntries(cap.tags.categories.map((c) => [c, [] as Dollars[]])) as Record<
    TagCategory,
    Dollars[]
  >;
  for (const p of league.players) {
    if (!p.contract || p.teamId === null) continue;
    const salary = tagSalary(league, p.id, season);
    if (salary > 0) out[tagCategory(cap, p.position)].push(salary);
  }
  for (const c of cap.tags.categories)
    out[c] = out[c].sort((a, b) => b - a).slice(0, SALARY_HISTORY_DEPTH);
  return out;
}

/** Records a League Year's top salaries (called as it ends). */
export function recordSalaryHistory(league: League, season: number): void {
  const tops = topSalaries(league, season);
  league.salaryHistory = league.salaryHistory.filter((h) => h.season !== season);
  for (const category of league.rules.cap.tags.categories)
    league.salaryHistory.push({ season, category, top: tops[category] });
}

/**
 * Seeds five years of history from today's contracts when a league starts:
 * each earlier year's salaries are today's at the same share of that year's
 * cap (an assumption until the league has played those years).
 */
export function seedSalaryHistory(league: League): void {
  const cap = league.rules.cap;
  const tops = topSalaries(league, league.season);
  const now = salaryCap(cap, league.season);
  league.salaryHistory = [];
  for (let back = 1; back <= cap.tags.yearsAveraged; back++) {
    const season = league.season - back;
    const ratio = salaryCap(cap, season) / now;
    for (const category of cap.tags.categories)
      league.salaryHistory.push({
        season,
        category,
        top: tops[category].map((s) => Math.round(s * ratio)),
      });
  }
}

/** The Cap Percentage Average of ranks [from, to] (1-based) at a category, applied to a League Year's cap. */
export function capPercentageAverage(
  league: League,
  category: TagCategory,
  season: number,
  ranks: [number, number],
): Dollars {
  const cap = league.rules.cap;
  let salaries = 0;
  let caps = 0;
  for (let y = season - cap.tags.yearsAveraged; y < season; y++) {
    const row = league.salaryHistory.find((h) => h.season === y && h.category === category);
    if (!row) continue;
    const slice = row.top.slice(ranks[0] - 1, ranks[1]);
    if (slice.length === 0) continue;
    salaries += slice.reduce((a, b) => a + b, 0) / slice.length;
    caps += salaryCap(cap, y);
  }
  if (caps === 0) return 0;
  return Math.round((salaries / caps) * salaryCap(cap, season));
}

function officialTag(
  cap: CapRules,
  kind: "franchise" | "transition",
  category: TagCategory,
  season: number,
) {
  if (season !== OFFICIAL_TAG_SEASON) return null;
  return (kind === "franchise" ? cap.tags.franchise2026 : cap.tags.transition2026)[category];
}

/**
 * The required tender for a tagged player (Article 10, Sections 2 and 4):
 * the position's Cap Percentage Average, or 120% of his prior salary if more
 * (144% for a third franchise tag).
 */
export function tagTender(
  league: League,
  kind: "franchise" | "transition",
  position: string,
  season: number,
  priorSalary: Dollars,
  timesTagged = 0,
): Dollars {
  const cap = league.rules.cap;
  const category = tagCategory(cap, position);
  const topN = kind === "franchise" ? cap.tags.franchiseTopN : cap.tags.transitionTopN;
  const average =
    officialTag(cap, kind, category, season) ??
    capPercentageAverage(league, category, season, [1, topN]);
  const multiplier =
    kind === "franchise" && timesTagged >= 2
      ? cap.tags.thirdTagMultiplier
      : cap.tags.priorSalaryMultiplier;
  return Math.max(average, Math.round(priorSalary * multiplier));
}

/**
 * Fifth-year option salary (Article 7, Section 7(g)) for a first-round pick's fifth season.
 * Pro Bowls on the original ballot in his first three seasons set the top tiers (one: the
 * transition tender, two or more: the franchise tender); otherwise the tiers are playing time:
 * 75% of snaps in two of his first three seasons, a 75% average, or 50% in each.
 */
export function fifthYearOptionSalary(
  league: League,
  position: string,
  optionSeason: number,
  snapShares: number[],
  /** Pro Bowls in his first three seasons (Phase 15). */
  proBowls = 0,
): Dollars {
  const cap = league.rules.cap;
  const rule = cap.fifthYearOption;
  const category = tagCategory(cap, position);
  if (proBowls >= 1)
    return tagTender(
      league,
      proBowls >= 2 ? "franchise" : "transition",
      position,
      optionSeason - 1,
      0,
    );
  const average = snapShares.reduce((a, b) => a + b, 0) / Math.max(1, snapShares.length);
  const playedEnough =
    snapShares.filter((s) => s >= rule.playingTimeShare).length >= rule.playingTimeSeasons ||
    average >= rule.playingTimeShare ||
    (snapShares.length > 0 && snapShares.every((s) => s >= rule.everySeasonShare));
  // The option salary is set in year four, from the averages through year four's prior seasons.
  return capPercentageAverage(
    league,
    category,
    optionSeason - 1,
    playedEnough ? rule.playingTime : rule.basic,
  );
}
