/**
 * Real contracts (Phase 7b). Kept private: the sources stay in pipeline/private
 * and pipeline/cache, and only the league file (local) carries contracts built
 * from them.
 *
 * - 2026-2029: each team's public cap page as archived closest to Feb 9, 2026
 *   (capPages.ts), player by player: salary, bonus proration, roster and
 *   workout bonuses, guarantees. A player on his end-of-2025 team's page is
 *   under contract; one who isn't is a pending free agent.
 * - Seasons after 2029, and the year each deal was signed: nflverse's contract
 *   data (compiled by OverTheCap).
 * - Team facts (dead money, carried-over room): the team pages and an archived
 *   cap-space table from Feb 10, 2026.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { asyncBufferFromFile, parquetReadObjects } from "hyparquet";
import type { Contract, ContractYear } from "@fgm/sim-core";
import { CACHE, ensure, RELEASE } from "../matchups";
import { contractFromPage, type LaterYear, type PageRow } from "./capPages";
import { leagueTeam, PRIVATE } from "./inputs";
import type { RealPerson } from "./roster";

const FILE = "historical_contracts.parquet";
export const CAP_SNAPSHOT = join(PRIVATE, "cap", "cap-space-2026-02-10.html");
/** The 2026 cap the snapshot was computed with (the official $301.2M came later in February). */
export const SNAPSHOT_BASE_CAP = 303_500_000;
const FIRST_SEASON = 2026;

/** One contract row as read (amounts in millions of dollars). */
interface HistoryRow {
  year: string;
  team: string;
  base_salary: number | null;
  prorated_bonus: number | null;
  option_bonus: number | null;
  roster_bonus: number | null;
  guaranteed_salary: number | null;
  cap_number: number | null;
  workout_bonus: number | null;
  per_game_roster_bonus: number | null;
}
interface ContractRow {
  team: string | null;
  is_active: boolean | null;
  year_signed: number | null;
  years: number | null;
  apy: number | null;
  gsis_id: string | null;
  season_history: HistoryRow[] | null;
}

const dollars = (millions: number | null | undefined) => Math.round((millions ?? 0) * 1_000_000);

export async function readContracts(): Promise<Map<string, ContractRow[]>> {
  const path = await ensure(FILE, `${RELEASE}/contracts/${FILE}`);
  const file = await asyncBufferFromFile(path);
  const rows = (await parquetReadObjects({
    file,
    // The per-contract history column is very large and not needed.
    columns: ["team", "is_active", "year_signed", "years", "apy", "gsis_id", "season_history"],
  })) as ContractRow[];
  const byPlayer = new Map<string, ContractRow[]>();
  for (const r of rows) {
    if (!r.gsis_id) continue;
    byPlayer.set(r.gsis_id, [...(byPlayer.get(r.gsis_id) ?? []), r]);
  }
  return byPlayer;
}

/** The player's year-by-year history (the same on each of his contract rows; the newest is used). */
function historyOf(rows: ContractRow[]): HistoryRow[] {
  const newest = [...rows].sort((a, b) => (b.year_signed ?? 0) - (a.year_signed ?? 0))[0];
  return (newest?.season_history ?? []).filter((h) => /^\d{4}$/.test(h.year));
}

/** Team names in the data -> our team ids, by majority vote over players' 2025 rows and end-of-2025 teams. */
export function teamNameMap(
  people: RealPerson[],
  contracts: Map<string, ContractRow[]>,
): Map<string, string> {
  const votes = new Map<string, Map<string, number>>();
  for (const p of people) {
    if (!p.teamId) continue;
    const row = historyOf(contracts.get(p.gsis) ?? []).find((h) => h.year === "2025");
    if (!row) continue;
    const v = votes.get(row.team) ?? new Map<string, number>();
    v.set(p.teamId, (v.get(p.teamId) ?? 0) + 1);
    votes.set(row.team, v);
  }
  const out = new Map<string, string>();
  for (const [name, v] of votes)
    out.set(name, [...v].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]![0]);
  return out;
}

export function contractYear(season: number, extra: Partial<ContractYear> = {}): ContractYear {
  return {
    season,
    base: 0,
    guaranteed: 0,
    injuryGuaranteed: 0,
    vestsOn: null,
    rosterBonus: 0,
    workoutBonus: 0,
    perGameBonus: 0,
    incentives: [],
    void: false,
    ...extra,
  };
}

/**
 * "page": from the team's cap page; "voided": his deal ended with 2025 but its void years
 * still charge the team; "pending": not on the page (his deal ended with 2025); "none": no team.
 */
export type ImportKind = "page" | "voided" | "pending" | "none";

export interface ImportedContract {
  kind: ImportKind;
  contract: Contract | null;
  /** For "voided": the proration still charged, by season (dead money once the deal voids). */
  voidedProration?: { season: number; amount: number }[];
}

/** A player's contract on Feb 9, 2026, with his end-of-2025 team, from his rows on its cap page. */
export function contractAtStart(
  p: RealPerson,
  pageRows: Map<number, PageRow> | undefined,
  rows: ContractRow[],
  names: Map<string, string>,
): ImportedContract {
  if (!p.teamId) return { kind: "none", contract: null };
  if (!pageRows) return { kind: "pending", contract: null };
  // Years past the page's last season, from the contract data while he's still with the team.
  const later: LaterYear[] = [];
  for (const h of historyOf(rows)
    .filter((h) => Number(h.year) > 2029)
    .sort((a, b) => Number(a.year) - Number(b.year))) {
    if (names.get(h.team) !== p.teamId) break;
    const base = dollars(h.base_salary);
    later.push({
      season: Number(h.year),
      base,
      proration: dollars(h.prorated_bonus) + dollars(h.option_bonus),
      void: base > 0 && dollars(h.cap_number) < base,
    });
  }
  const built = contractFromPage(pageRows, later);
  if (!built) {
    // Only void years left: a pending free agent whose leftover proration stays on the cap.
    const voidedProration = [...pageRows]
      .filter(([, r]) => r.capNumber > 0)
      .map(([season, r]) => ({ season, amount: r.capNumber }));
    return voidedProration.length > 0
      ? { kind: "voided", contract: null, voidedProration }
      : { kind: "pending", contract: null };
  }
  const signed = rows.filter((r) => (r.year_signed ?? 9999) <= 2025).map((r) => r.year_signed!);
  const signedYear = signed.length > 0 ? Math.max(...signed) : (p.draft?.season ?? 2025);
  return {
    kind: "page",
    contract: {
      ...withRookieTerms(p, `${signedYear}-03-15`, built.years, built.bonuses),
      veteranSalaryBenefit: built.veteranSalaryBenefit,
    },
  };
}

/** Rookie deals: the contract type and, for first-rounders, the fifth-year option. */
function withRookieTerms(
  p: RealPerson,
  signedOn: string,
  years: ContractYear[],
  bonuses: Contract["bonuses"],
): Contract {
  const rookie = !!p.draft && p.draft.season + 4 > FIRST_SEASON && p.yearsBefore <= 3;
  const optionSeason = p.draft ? p.draft.season + 4 : 0;
  // A first-rounder's fifth-year option is decided in May, after the league starts: undecided
  // unless it's for 2026 (decided a year ago).
  const fifthYearOption =
    rookie && p.draft!.round === 1
      ? { season: optionSeason, exercised: optionSeason === FIRST_SEASON ? true : null }
      : null;
  const kept =
    fifthYearOption && fifthYearOption.exercised === null
      ? years.filter((y) => y.season < optionSeason)
      : years;
  const finalYears = kept.length > 0 ? kept : years;
  return {
    teamId: p.teamId!,
    type: rookie ? "rookie" : "veteran",
    signedOn,
    years: finalYears,
    bonuses: bonuses.filter((b) => finalYears.some((y) => y.season === b.seasons[0])),
    fifthYearOption,
    veteranSalaryBenefit: false,
  };
}

export interface TeamCapFacts {
  space: number;
  activeSpending: number;
  deadMoney: number;
  players: number;
  carryover: number;
}

/** Each team's 2026 row from the archived cap-space table (Feb 10, 2026), by our team id. */
export function capSnapshot(): Map<string, TeamCapFacts> | null {
  if (!existsSync(CAP_SNAPSHOT)) return null;
  const html = readFileSync(CAP_SNAPSHOT, "utf8");
  // The page has tables for 2026, 2027 and 2028; the first is 2026.
  const firstTableEnd = html.indexOf("</table>", html.indexOf('class="team-link'));
  const table = html.slice(0, firstTableEnd);
  const money = (s: string) => (s.includes("(") ? -1 : 1) * Number(s.replace(/[^\d]/g, ""));
  const out = new Map<string, TeamCapFacts>();
  for (const row of table.split("<tr").slice(1)) {
    const code = /class="team-link ([A-Z]+)"/.exec(row)?.[1];
    if (!code) continue;
    // Cells, with any markup inside them (negative amounts come wrapped in a span) removed.
    const cells = [...row.matchAll(/<td[^>]*>(.*?)<\/td>/g)].map((c) =>
      c[1]!.replace(/<[^>]+>/g, "").trim(),
    );
    const [, space, , players, active, dead] = cells as [
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    const facts = {
      space: money(space),
      activeSpending: money(active),
      deadMoney: money(dead),
      players: Number(players),
      carryover: 0,
    };
    facts.carryover = facts.space + facts.activeSpending + facts.deadMoney - SNAPSHOT_BASE_CAP;
    out.set(leagueTeam(code), facts);
  }
  return out;
}

export { CACHE };
