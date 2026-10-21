/**
 * Each team's public cap page as archived closest to the league's start
 * (Feb 9, 2026): every player's 2026-2029 salary, bonus proration, roster and
 * workout bonuses, guarantees and cap number, plus the dead money left by
 * players already gone. Fetched once from the Internet Archive into
 * pipeline/private/cap/teams/ (never committed); facts only.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { minimumSalary, rulesFor, type Contract, type ContractYear } from "@fgm/sim-core";
import { CAP_SNAPSHOT, contractYear } from "./contracts";
import type { RealPerson } from "./roster";
import { leagueTeam, PRIVATE } from "./inputs";

export const TEAM_PAGES = join(PRIVATE, "cap", "teams");
const INDEX = join(TEAM_PAGES, "index.json");
const TARGET = "20260209";
/** Look for snapshots in this window; the closest to the target day wins (before the new League Year). */
const WINDOW = ["20260201", "20260310"] as const;
const AGENT = "FootballGMSimPipeline/0.1 (personal research project)";
const PAUSE_MS = 3000;
/** The veteran salary benefit charges a minimum deal as if he had this many credited seasons (CBA Art. 26). */
const VSB_CHARGED_AS = rulesFor(2026).cap.veteranSalaryBenefit.chargedAsCreditedSeasons;
/** Every minimum salary for a season (by credited seasons). */
const MINIMUMS = (season: number) =>
  Array.from({ length: 16 }, (_, cs) => minimumSalary(rulesFor(season).cap, season, cs));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Team code -> page path, read from the archived cap-space table's links. */
function teamPaths(): Map<string, string> {
  const html = readFileSync(CAP_SNAPSHOT, "utf8");
  const out = new Map<string, string>();
  for (const m of html.matchAll(
    /class="team-link ([A-Z]+)" href="[^"]*?(\/salary-cap\/[a-z0-9-]+)\/?"/g,
  ))
    if (!out.has(m[1]!)) out.set(m[1]!, m[2]!);
  return out;
}

export interface TeamPageIndex {
  [teamId: string]: { timestamp: string; file: string };
}

/** Downloads any team pages not yet on disk (politely: one at a time, with pauses). */
export async function fetchTeamPages(): Promise<TeamPageIndex> {
  mkdirSync(TEAM_PAGES, { recursive: true });
  const index: TeamPageIndex = existsSync(INDEX) ? JSON.parse(readFileSync(INDEX, "utf8")) : {};
  if (!existsSync(CAP_SNAPSHOT)) return index;
  for (const [code, path] of teamPaths()) {
    const teamId = leagueTeam(code);
    if (index[teamId] && existsSync(join(TEAM_PAGES, index[teamId]!.file))) continue;
    const cdx = `https://web.archive.org/cdx/search/cdx?url=overthecap.com${path}&from=${WINDOW[0]}&to=${WINDOW[1]}&output=json&filter=statuscode:200`;
    const list = (await (
      await fetch(cdx, { headers: { "User-Agent": AGENT } })
    ).json()) as string[][];
    const stamps = list.slice(1).map((r) => r[1]!);
    if (stamps.length === 0) {
      console.log(`No archived cap page for ${teamId} in the window.`);
      continue;
    }
    const distance = (s: string) => Math.abs(Number(s.slice(0, 8)) - Number(TARGET));
    const best = stamps.sort((a, b) => distance(a) - distance(b) || a.localeCompare(b))[0]!;
    await sleep(PAUSE_MS);
    const page = await fetch(`https://web.archive.org/web/${best}/https://overthecap.com${path}`, {
      headers: { "User-Agent": AGENT },
    });
    if (!page.ok) {
      console.log(`Couldn't fetch ${teamId}'s page (${page.status}).`);
      continue;
    }
    const file = `${teamId}.html`;
    writeFileSync(join(TEAM_PAGES, file), await page.text());
    index[teamId] = { timestamp: best, file };
    writeFileSync(INDEX, JSON.stringify(index, null, 2));
    console.log(`Fetched ${teamId}'s cap page (${best.slice(0, 8)}).`);
    await sleep(PAUSE_MS);
  }
  return index;
}

/** One player's row in a year's table (whole dollars; base null in a void year). */
export interface PageRow {
  name: string;
  base: number | null;
  signing: number;
  option: number;
  roster: number;
  perGame: number;
  workout: number;
  other: number;
  guaranteed: number;
  capNumber: number;
}

export interface TeamPage {
  teamId: string;
  timestamp: string;
  /** Season -> rows of players under contract that year. */
  years: Map<number, PageRow[]>;
  /** Players already gone and the cap charge they leave each season (dead money). */
  gone: { season: number; name: string; capNumber: number }[];
}

const money = (s: string) => (s.includes("(") ? -1 : 1) * Number(s.replace(/[^\d]/g, "") || "0");
const cellsOf = (row: string) =>
  [...row.matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map((c) =>
    c[1]!
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&#039;|&#39;/g, "'")
      .trim(),
  );

export function readTeamPages(index: TeamPageIndex): Map<string, TeamPage> {
  const out = new Map<string, TeamPage>();
  for (const [teamId, { timestamp, file }] of Object.entries(index)) {
    const path = join(TEAM_PAGES, file);
    if (!existsSync(path)) continue;
    const html = readFileSync(path, "utf8");
    const years = new Map<number, PageRow[]>();
    const gone: TeamPage["gone"] = [];
    // Each year's section starts at id="yYYYY"; within it, the first table is the contracted players.
    const sections = [...html.matchAll(/id="y(\d{4})"/g)].map((m) => ({
      season: Number(m[1]),
      at: m.index!,
    }));
    sections.forEach((sec, i) => {
      const end = sections[i + 1]?.at ?? html.length;
      const part = html.slice(sec.at, end);
      const tableStart = part.indexOf('class="salary-cap-table contracted-players"');
      if (tableStart < 0) return;
      const table = part.slice(tableStart, part.indexOf("</table>", tableStart));
      const rows: PageRow[] = [];
      for (const tr of table.split("<tr").slice(1)) {
        const c = cellsOf(tr);
        // Player, base, signing, option, roster, per game, workout, other, (spacer), guaranteed, (spacer), cap number...
        if (c.length < 12 || !c[0] || c[0] === "TOTAL") continue;
        rows.push({
          name: c[0],
          base: /void/i.test(c[1]!) ? null : money(c[1]!),
          signing: money(c[2]!),
          option: money(c[3]!),
          roster: money(c[4]!),
          perGame: money(c[5]!),
          workout: money(c[6]!),
          other: money(c[7]!),
          guaranteed: money(c[9]!),
          capNumber: money(c[11]!),
        });
      }
      years.set(sec.season, rows);
      // Each year's section also lists players already gone (dead money).
      const goneStart = part.indexOf('class="salary-cap-table non-active"');
      if (goneStart >= 0) {
        const goneTable = part.slice(goneStart, part.indexOf("</table>", goneStart));
        for (const tr of goneTable.split("<tr").slice(1)) {
          const c = cellsOf(tr);
          if (c.length >= 2 && c[0] && c[0] !== "TOTAL" && c[0] !== "Name")
            gone.push({ season: sec.season, name: c[0], capNumber: money(c[1]!) });
        }
      }
    });
    out.set(teamId, { teamId, timestamp, years, gone });
  }
  return out;
}

/** Names compared loosely: case, punctuation and suffixes (Jr., III) ignored. */
export function nameKey(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[.,'’]/g, "")
    .replace(/-/g, " ")
    .split(/\s+/)
    .filter((w) => w && !/^(jr|sr|ii|iii|iv|v)$/.test(w))
    .join(" ");
}

export interface PageMatch {
  /** gsis id -> his rows in the team's page, by season. */
  byPlayer: Map<string, Map<number, PageRow>>;
  /** Page rows no one on our roster matched (signed after the season, or missing from the roster data). */
  unmatched: { teamId: string; name: string; capNumber2026: number }[];
  /**
   * Players on our end-of-2025 roster who aren't on their team's page but are in its dead
   * money list: released (or traded) between the league's start and the page's archive date.
   */
  released: Set<string>;
}

/** Pairs each team page's players with our people on that team, by name. */
export function matchPages(people: RealPerson[], pages: Map<string, TeamPage>): PageMatch {
  const byPlayer = new Map<string, Map<number, PageRow>>();
  const unmatched: PageMatch["unmatched"] = [];
  const released = new Set<string>();
  for (const [teamId, page] of [...pages].sort((a, b) => a[0].localeCompare(b[0]))) {
    const roster = people.filter((p) => p.teamId === teamId);
    const keysOf = (p: RealPerson) =>
      [p.realFirst, ...p.otherFirst].map((f) => nameKey(`${f} ${p.realLast}`));
    // Every name on the page in any season (some appear only in later years).
    const names = new Set<string>();
    for (const rows of page.years.values()) for (const r of rows) names.add(r.name);
    const rowsOf = (name: string) => {
      const rows = new Map<number, PageRow>();
      for (const [season, list] of page.years) {
        const r = list.find((x) => x.name === name);
        if (r) rows.set(season, r);
      }
      return rows;
    };
    const taken = new Set<string>();
    const left: string[] = [];
    // Pass 1: exact names (with nicknames). Pass 2: last name and any first-name initial,
    // when only one player left on the team fits ("Mike" for a player listed under his legal name "Michael").
    for (const name of [...names].sort()) {
      const hit = roster.filter((p) => !taken.has(p.gsis) && keysOf(p).includes(nameKey(name)));
      if (hit.length === 1) {
        taken.add(hit[0]!.gsis);
        byPlayer.set(hit[0]!.gsis, rowsOf(name));
      } else left.push(name);
    }
    for (const name of left) {
      const key = nameKey(name);
      const last = key.split(" ").slice(1).join(" ");
      const hit = roster.filter(
        (p) =>
          !taken.has(p.gsis) &&
          nameKey(p.realLast) === last &&
          [p.realFirst, ...p.otherFirst].some((f) => nameKey(f)[0] === key[0]),
      );
      const rows = rowsOf(name);
      if (hit.length === 1) {
        taken.add(hit[0]!.gsis);
        byPlayer.set(hit[0]!.gsis, rows);
      } else unmatched.push({ teamId, name, capNumber2026: rows.get(2026)?.capNumber ?? 0 });
    }
    for (const g of page.gone.filter((x) => x.season === 2026)) {
      const hit = roster.filter((p) => !taken.has(p.gsis) && keysOf(p).includes(nameKey(g.name)));
      if (hit.length === 1) released.add(hit[0]!.gsis);
    }
  }
  return { byPlayer, unmatched, released };
}

/** A season past the page's last, from the contract data. */
export interface LaterYear {
  season: number;
  base: number;
  proration: number;
  void: boolean;
}

/**
 * A contract from a player's page rows. Each year's bonus proration is kept as that
 * year's share (paid earlier), so it charges and accelerates exactly as published.
 * Years past the page's last season come from `later` (the contract data's history).
 */
export function contractFromPage(
  rows: Map<number, PageRow>,
  later: LaterYear[],
): { years: ContractYear[]; bonuses: Contract["bonuses"]; veteranSalaryBenefit: boolean } | null {
  const seasons = [...rows.keys()].sort((a, b) => a - b);
  if (seasons[0] !== 2026) return null;
  const years: ContractYear[] = [];
  const bonuses: Contract["bonuses"] = [];
  const addBonus = (season: number, amount: number) => {
    if (amount > 0) bonuses.push({ amount, kind: "signing", seasons: [season], paidIn: 2025 });
  };
  let veteranSalaryBenefit = false;
  let season = 2026;
  for (; rows.has(season); season++) {
    const r = rows.get(season)!;
    if (r.base === null) {
      years.push(contractYear(season, { void: true }));
      addBonus(season, r.signing + r.option);
      continue;
    }
    // What the page counts beyond salary and fixed bonuses explains two things it doesn't list:
    // - per-game roster bonuses count only as far as they're likely (games active last
    //   season); the rest is an unlikely incentive;
    // - a veteran-minimum deal counts at the two-season minimum (the salary benefit).
    const fixed = r.signing + r.option + r.roster + r.workout + r.other;
    const charge = minimumSalary(rulesFor(season).cap, season, VSB_CHARGED_AS);
    const vsbRest = r.capNumber - fixed - charge;
    const vsb =
      r.base > charge && vsbRest >= 0 && vsbRest <= r.perGame && r.capNumber < fixed + r.base;
    if (vsb) veteranSalaryBenefit = true;
    // A salary that doesn't add up to the cap number, when the cap number implies a minimum
    // salary, is a typo on the page (one known case): the cap number wins.
    const implied = r.capNumber - fixed - r.perGame;
    const base = !vsb && implied < r.base && MINIMUMS(season).includes(implied) ? implied : r.base;
    const rest = vsb ? vsbRest : r.capNumber - fixed - base;
    const perGame = rest >= 0 && rest < r.perGame ? rest : r.perGame;
    years.push(
      contractYear(season, {
        base,
        guaranteed: Math.min(base, r.guaranteed),
        rosterBonus: r.roster,
        workoutBonus: r.workout,
        perGameBonus: perGame,
        incentives: [
          // "Other" bonuses on the page are counted like likely incentives.
          ...(r.other > 0 ? [{ amount: r.other, games: 1, likely: true }] : []),
          ...(perGame < r.perGame
            ? [{ amount: r.perGame - perGame, games: 17, likely: false }]
            : []),
        ],
      }),
    );
    addBonus(season, r.signing + r.option);
  }
  // Later years continue the contract only if it's still running at the page's last season.
  const running = rows.get(season - 1)!.base !== null;
  for (const l of running ? later : []) {
    if (l.season !== season) break;
    years.push(
      l.void ? contractYear(season, { void: true }) : contractYear(season, { base: l.base }),
    );
    addBonus(season, l.proration);
    season += 1;
  }
  // A contract with no real year left is no contract.
  if (!years.some((y) => !y.void)) return null;
  return { years, bonuses, veteranSalaryBenefit };
}
