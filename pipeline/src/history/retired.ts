/**
 * Retired numbers (Phase 15), read from a public list's wikitext (fetched once into
 * pipeline/private/history/raw/): the player, his number, the team that retired it and the year.
 * Numbers "to be retired" after the league's start are left out.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { HISTORY } from "./fetch";
import { franchiseOf, isClub } from "./teams";

export const RETIRED_FILE = join(HISTORY, "raw", "wiki_List_of_NFL_retired_numbers.json");

export interface RealRetired {
  /** The real name (private). */
  name: string;
  number: number;
  teamId: string;
  season: number | null;
}

/** The player's name from the list's cell: a sortname template or a link. */
function playerName(cell: string): string | null {
  const sort = /\{\{sortname\|([^|}]+)\|([^|}]+)/i.exec(cell);
  if (sort) return `${sort[1]!.trim()} ${sort[2]!.trim()}`;
  const link = /\[\[(?:[^|\]]+\|)?([^\]]+)\]\]/.exec(cell);
  return link ? link[1]!.trim() : null;
}

export function parseRetired(lastYear = 2025): RealRetired[] {
  if (!existsSync(RETIRED_FILE)) return [];
  const wikitext: string = JSON.parse(readFileSync(RETIRED_FILE, "utf8")).parse.wikitext;
  const start = wikitext.indexOf('{| class="wikitable sortable"');
  const body = wikitext.slice(start, wikitext.indexOf("\n|}", start));
  const out: RealRetired[] = [];
  let team: string | null = null;
  for (const chunk of body.split("\n|-").slice(2)) {
    const clean = chunk.replace(/<ref[^>]*\/>/g, "").replace(/<ref[\s\S]*?<\/ref>/g, "");
    const name = playerName(clean);
    const number = /'''(\d{1,2})'''/.exec(clean)?.[1];
    const teamLink = /\[\[([^|\]]+(?:\|[^\]]*)?)\]\]\s*(?:\|\||\n|$)/.exec(
      clean.replace(/\{\{sortname[^}]*\}\}/gi, ""),
    );
    // A team cell spans the rows below it, so later rows carry no team.
    const linked = /rowspan="\d+"\s*\|\s*\[\[([^|\]]+)/.exec(clean)?.[1] ?? null;
    if (linked) team = linked;
    else if (teamLink && isClub(teamLink[1]!)) team = teamLink[1]!.split("|")[0]!;
    if (!name || !number || !team) continue;
    // The year retired is the last four-digit year in the row's own cells.
    const years = [...clean.replace(/'''\d+'''/g, "").matchAll(/\b(19\d\d|20\d\d)\b/g)].map((m) =>
      Number(m[1]),
    );
    const season = years.length >= 3 ? years[years.length - 1]! : (years.at(-1) ?? null);
    if (season !== null && season > lastYear) continue;
    try {
      out.push({ name, number: Number(number), teamId: franchiseOf(team).teamId, season });
    } catch {
      // A team we don't map (a defunct club): skipped.
    }
  }
  return out;
}
