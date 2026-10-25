/**
 * Real league history (Phase 15): public reference pages as archived just after the 2025 season
 * (the league starts Feb 9, 2026), fetched once from the Internet Archive into
 * pipeline/private/history/pages/ (never committed; facts only). One page at a time, politely,
 * backing off when the archive asks us to slow down; a rerun picks up where it stopped.
 *
 * Pages: award winners, the Hall of Fame, every All-Pro team since 1966, the league's career,
 * single-season and single-game leaders, and each franchise's career and single-season leaders.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PRIVATE } from "../league/inputs";
import { wikiNames } from "./teams";

export const HISTORY = join(PRIVATE, "history");
export const PAGES = join(HISTORY, "pages");
const INDEX = join(PAGES, "index.json");
const SITE = "www.pro-football-reference.com";
/** After the 2025 regular season, before the 2026 season; the closest to March 1 wins. */
const WINDOW = ["20260106", "20260831"] as const;
/**
 * Franchise leader pages are archived less often, so the newest usable copy will do, however old:
 * the seasons since are added from the stats files (`teamLeaders.ts`). Usable means taken between
 * the season's end and the next one's start, so it holds only whole seasons.
 */
const TEAM_FROM = "20200101";

/** The last season a copy taken on this date (YYYYMMDD...) holds whole, or null if it was taken mid-season. */
export function lastFullSeason(stamp: string): number | null {
  const year = Number(stamp.slice(0, 4));
  const md = stamp.slice(4, 8);
  if (md > "0831") return null;
  // The regular season ends in the first days of January.
  return md < "0106" ? year - 2 : year - 1;
}
const TARGET = 20260301;
const AGENT = "FootballGMSimPipeline/0.1 (personal research project)";
const PAUSE_MS = 6000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The reference site's franchise codes (a franchise keeps one code through moves). */
export const FRANCHISE_CODES = [
  "crd",
  "atl",
  "rav",
  "buf",
  "car",
  "chi",
  "cin",
  "cle",
  "dal",
  "den",
  "det",
  "gnb",
  "htx",
  "clt",
  "jax",
  "kan",
  "rai",
  "sdg",
  "ram",
  "mia",
  "min",
  "nwe",
  "nor",
  "nyg",
  "nyj",
  "phi",
  "pit",
  "sfo",
  "sea",
  "tam",
  "oti",
  "was",
] as const;

/** Stats with league leader pages (career, single season, single game). */
export const LEADER_STATS = [
  "pass_yds",
  "pass_td",
  "rush_yds",
  "rush_td",
  "rec",
  "rec_yds",
  "rec_td",
  "sacks",
  "def_int",
  "fgm",
] as const;

export const AWARD_PAGES = [
  "ap-nfl-mvp-award",
  "ap-offensive-player-of-the-year",
  "ap-defensive-player-of-the-year",
  "ap-offensive-rookie-of-the-year-award",
  "ap-defensive-rookie-of-the-year-award",
  "ap-comeback-player-award",
  "ap-coach-of-the-year",
] as const;

/**
 * A franchise's own leader pages: every player's career totals with the club and every single
 * season, one page per statistic group (single-season pages exist for passing, rushing, receiving
 * and kicking only).
 */
export const TEAM_LEADER_PAGES = [
  "career-passing",
  "career-rushing",
  "career-receiving",
  "career-defense",
  "career-kicking",
  "single-season-passing",
  "single-season-rushing",
  "single-season-receiving",
  "single-season-kicking",
] as const;

export const FIRST_SEASON = 1966;
export const LAST_SEASON = 2025;

/** Every page the history step reads (paths on the reference site). */
export function historyPaths(): string[] {
  const out: string[] = ["awards/", "hof/"];
  for (const a of AWARD_PAGES) out.push(`awards/${a}.htm`);
  for (let y = FIRST_SEASON; y <= LAST_SEASON; y++) out.push(`years/${y}/allpro.htm`);
  // The last three Pro Bowls: their slots by position, and the original-ballot selections that
  // set the 2023 draft class's fifth-year options (CBA Article 7).
  for (const y of [LAST_SEASON, LAST_SEASON - 1, LAST_SEASON - 2])
    out.push(`years/${y}/probowl.htm`);
  for (const s of LEADER_STATS)
    for (const kind of ["career", "single_season", "single_game"])
      out.push(`leaders/${s}_${kind}.htm`);
  for (const code of FRANCHISE_CODES)
    for (const p of TEAM_LEADER_PAGES) out.push(`teams/${code}/${p}.htm`);
  return out;
}

/** When the archived copy of a page was taken (YYYYMMDDhhmmss), or null. */
export function pageStamp(path: string): string | null {
  if (!existsSync(INDEX)) return null;
  return (JSON.parse(readFileSync(INDEX, "utf8")) as PageIndex)[path]?.timestamp ?? null;
}

export function pageFile(path: string): string {
  return join(PAGES, `${path.replace(/\/$/, "/index").replace(/[^a-z0-9_.-]+/gi, "_")}.html`);
}

interface PageIndex {
  [path: string]: { timestamp: string | null; file: string | null };
}

/** A request that waits out throttling and refused connections (longer each time). */
async function patient(url: string): Promise<Response | null> {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": AGENT } });
      if (res.ok) return res;
      // Not there, or a capture the archive won't serve: nothing to wait for.
      if (res.status === 404 || res.status === 403) return null;
    } catch {
      // Refused or dropped: the archive is asking us to slow down.
    }
    const wait = Math.min(10 * 60_000, PAUSE_MS * 5 * 2 ** attempt);
    console.log(`  The archive is busy; waiting ${Math.round(wait / 1000)} s.`);
    await sleep(wait);
  }
  return null;
}

async function json(url: string): Promise<unknown> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await patient(url);
    const text = res ? await res.text() : "";
    if (text.startsWith("[") || text.startsWith("{")) return JSON.parse(text);
    await sleep(PAUSE_MS * 5);
  }
  throw new Error(`The archive kept refusing ${url}`);
}

/** Downloads any pages not on disk yet. Returns how many are on disk. */
export async function fetchHistoryPages(): Promise<number> {
  mkdirSync(PAGES, { recursive: true });
  const index: PageIndex = existsSync(INDEX) ? JSON.parse(readFileSync(INDEX, "utf8")) : {};
  const paths = historyPaths();
  let have = 0;
  for (const path of paths) {
    const known = index[path];
    if (known && (known.file === null || existsSync(pageFile(path)))) {
      if (known.file) have += 1;
      continue;
    }
    // The archive redirects a dated request to its nearest copy: one request when that copy is in
    // the window; otherwise list the copies in the window and take the closest.
    const isTeam = path.startsWith("teams/");
    let html: string | null = null;
    let best: string | null = null;
    const direct = isTeam
      ? null
      : await patient(`https://web.archive.org/web/${TARGET}id_/https://${SITE}/${path}`);
    const stamp = direct?.url.match(/\/web\/(\d{14})/)?.[1] ?? null;
    if (direct && stamp && stamp >= WINDOW[0] && stamp.slice(0, 8) <= WINDOW[1]) {
      html = await direct.text();
      best = stamp;
    } else {
      await sleep(PAUSE_MS);
      const cdx = `https://web.archive.org/cdx/search/cdx?url=${SITE}/${path}&from=${isTeam ? TEAM_FROM : WINDOW[0]}&to=${WINDOW[1]}&output=json&filter=statuscode:200`;
      const list = (await json(cdx)) as string[][];
      const stamps = list
        .slice(1)
        .map((r) => r[1]!)
        .filter((st) => !isTeam || lastFullSeason(st) !== null);
      await sleep(PAUSE_MS);
      if (stamps.length === 0) {
        index[path] = { timestamp: null, file: null };
        writeFileSync(INDEX, JSON.stringify(index, null, 2));
        console.log(`No usable archived copy of ${path}.`);
        continue;
      }
      const distance = (s: string) => Math.abs(Number(s.slice(0, 8)) - TARGET);
      best = isTeam
        ? stamps.sort().at(-1)!
        : stamps.sort((a, b) => distance(a) - distance(b) || a.localeCompare(b))[0]!;
      // "id_" asks for the page as it was, without the archive's own toolbar.
      const res = await patient(`https://web.archive.org/web/${best}id_/https://${SITE}/${path}`);
      html = res ? await res.text() : null;
    }
    if (html === null || best === null) {
      console.log(`Couldn't fetch ${path}; a rerun will try again.`);
      continue;
    }
    writeFileSync(pageFile(path), html);
    index[path] = { timestamp: best, file: pageFile(path) };
    writeFileSync(INDEX, JSON.stringify(index, null, 2));
    have += 1;
    console.log(`Fetched ${path} (${best.slice(0, 8)}), ${have} of ${paths.length}.`);
    await sleep(PAUSE_MS);
  }
  return have;
}

export const teamRecordsFile = (teamId: string) => join(HISTORY, "raw", `wiki_team_${teamId}.json`);

/** Downloads any franchise record pages not on disk yet (one a few seconds, never in bulk). */
export async function fetchTeamRecordPages(): Promise<number> {
  mkdirSync(join(HISTORY, "raw"), { recursive: true });
  // Teams whose records page doesn't exist (or isn't titled the usual way) are remembered, so a
  // rerun doesn't keep asking. Delete this file to try them again.
  const missingFile = join(HISTORY, "raw", "wiki_team_missing.json");
  const missing: string[] = existsSync(missingFile)
    ? JSON.parse(readFileSync(missingFile, "utf8"))
    : [];
  let have = 0;
  for (const [id, name] of Object.entries(wikiNames())) {
    if (existsSync(teamRecordsFile(id))) {
      have += 1;
      continue;
    }
    if (missing.includes(id)) continue;
    const parse = async (page: string) => {
      const res = await patient(
        `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(page.replace(/ /g, "_"))}&prop=wikitext&format=json&formatversion=2&redirects=1`,
      );
      const body = res ? await res.text() : "";
      return body.includes('"wikitext"') ? body : null;
    };
    let text = await parse(`List of ${name} team records`);
    if (!text) {
      // The page may have another title: search for it.
      await sleep(PAUSE_MS);
      const found = await patient(
        `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(`${name} team records`)}&srlimit=8&format=json`,
      );
      const titles: string[] = found
        ? (
            ((await found.json()) as { query?: { search?: { title: string }[] } }).query?.search ??
            []
          ).map((x) => x.title)
        : [];
      const last = name.split(" ").slice(-1)[0]!.toLowerCase();
      const title = titles.find(
        (t) =>
          /record/i.test(t) &&
          t.toLowerCase().includes(last) &&
          !/postseason|playoff|rookie/i.test(t),
      );
      if (title) {
        await sleep(PAUSE_MS);
        text = await parse(title);
      }
    }
    if (!text) {
      console.log(`No team records page for ${id}.`);
      missing.push(id);
      writeFileSync(missingFile, JSON.stringify(missing));
      await sleep(PAUSE_MS);
      continue;
    }
    writeFileSync(teamRecordsFile(id), text);
    have += 1;
    console.log(
      `Fetched ${id}'s team records page (${have} of ${Object.keys(wikiNames()).length}).`,
    );
    await sleep(PAUSE_MS);
  }
  return have;
}
