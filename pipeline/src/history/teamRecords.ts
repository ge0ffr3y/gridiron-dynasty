/**
 * Franchise records (Phase 15), read from each team's public records page (wikitext): the standing
 * single-game, single-season and career marks for the statistics this league's record book keeps.
 * Pages differ in layout, so rows are read by what's in them: a statistic's name, a number, a
 * linked player, and a year or date. Only the record holder is kept (the top of each list).
 */
import { existsSync, readFileSync } from "node:fs";
import type { RecordLevel, RecordStat } from "@fgm/sim-core";
import { teamRecordsFile } from "./fetch";
import { wikiNames } from "./teams";

export interface TeamRecord {
  teamId: string;
  level: RecordLevel;
  stat: RecordStat;
  value: number;
  /** The real name (private). */
  name: string;
  season: number | null;
}

/** A statistic's label in these tables -> this league's stat. */
const LABELS: [RegExp, RecordStat][] = [
  [/^(passing yards|yards passing)\b/i, "passYds"],
  [/^(passing touchdowns|touchdown passes|passing tds)\b/i, "passTd"],
  [/^(rushing yards|yards rushing)\b/i, "rushYds"],
  [/^(rushing touchdowns|rushing tds)\b/i, "rushTd"],
  [/^(receptions|catches|pass receptions)\b/i, "rec"],
  [/^(receiving yards|yards receiving)\b/i, "recYds"],
  [/^(receiving touchdowns|receiving tds|touchdown receptions)\b/i, "recTd"],
  [/^(sacks|quarterback sacks)\b/i, "sacks"],
  [/^(interceptions|passes intercepted|interceptions \(defense\))\b/i, "defInt"],
  [/^(field goals made|field goals|field goals \(made\))\b/i, "fgm"],
];

/** Labels that look like a match but measure something else. */
const NOT =
  /\b(per|average|avg|longest|long|percentage|allowed|rating|attempts|yards after|team)\b/i;

function level(heading: string): RecordLevel | null {
  const h = heading.toLowerCase();
  if (/post-?season|playoff|rookie|appearance|team records|miscellaneous|series|streak/.test(h))
    return null;
  if (/single[- ]game|game records/.test(h)) return "game";
  if (/single[- ]season|season records/.test(h)) return "season";
  if (/career/.test(h)) return "career";
  return null;
}

const strip = (s: string) =>
  s
    .replace(/<ref[^>]*\/>/g, "")
    .replace(/<ref[\s\S]*?<\/ref>/g, "")
    .replace(/'''?/g, "")
    .replace(/<[^>]+>/g, "")
    .trim();

/** A player's name from a cell: a link or a sortname template. */
function playerOf(cell: string): string | null {
  const sort = /\{\{sortname\|([^|}]+)\|([^|}]+)/i.exec(cell);
  if (sort) return `${sort[1]!.trim()} ${sort[2]!.trim()}`;
  const link = /\[\[(?:[^|\]]+\|)?([^\]]+)\]\]/.exec(cell);
  return link ? link[1]!.trim() : null;
}

/** A row's cells, from `|` and `!` lines (or one line split on `||`). */
function cells(row: string): string[] {
  const out: string[] = [];
  for (const line of row.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("|") && !t.startsWith("!")) continue;
    if (t.startsWith("|-") || t.startsWith("|}") || t.startsWith("|+")) continue;
    for (const part of t.slice(1).split(/\|\||!!/)) {
      // Drop leading attributes ("style=... |value").
      out.push(part.includes("|") && !part.includes("[[") ? part.split("|").pop()! : part);
    }
  }
  return out.map(strip);
}

/** The statistic named by a bullet's label, with the sub-section it sits in (Passing, Rushing...). */
function statOf(label: string, subsection: string): RecordStat | null {
  const l = label.toLowerCase().replace(/^most\s+/, "");
  if (NOT.test(l) && !/^(yards|touchdowns)\b/.test(l)) return null;
  const sub = `${subsection} ${l}`.toLowerCase();
  const yards = /\byards\b/.test(l);
  const tds = /\b(touchdowns?|tds)\b/.test(l);
  if (
    /\bpass(ing|es)?\b|completions/.test(sub) &&
    !/\b(rush|receiv|catch|reception|intercept|sack)/.test(l)
  ) {
    if (yards) return "passYds";
    if (tds) return "passTd";
  }
  if (/\brush(ing)?\b/.test(sub) && !/\b(pass|receiv)/.test(l)) {
    if (yards) return "rushYds";
    if (tds) return "rushTd";
  }
  if (/\b(receiv|catch|reception)/.test(sub)) {
    if (/\b(receptions|catches)\b/.test(l)) return "rec";
    if (yards) return "recYds";
    if (tds) return "recTd";
  }
  if (/\bsacks?\b/.test(l)) return "sacks";
  if (/\binterceptions?\b/.test(l) && !/pass/.test(l) && !/\bpass/.test(subsection.toLowerCase()))
    return "defInt";
  if (/\bfield goals\b/.test(l) && !/\b(attempt|percent|long)/.test(l)) return "fgm";
  return null;
}

/** The level a label names for itself ("..., career", "..., single season", "... in a game"). */
function labelLevel(label: string): RecordLevel | null {
  const l = label.toLowerCase();
  if (/rookie|playoff|post-?season|two games|consecutive|streak|\bgames\b/.test(l)) return null;
  if (/\bcareer\b/.test(l)) return "career";
  if (/\b(single[- ])?season\b/.test(l)) return "season";
  if (/\b(single[- ])?game\b/.test(l)) return "game";
  return null;
}

const sans = (s: string) => s.replace(/\[\[[^\]]*\]\]/g, "");

/** One bullet: a label, a linked player, a number and (usually) a year. */
function bullet(
  line: string,
  inherited: RecordLevel | null,
  subsection: string,
): {
  level: RecordLevel;
  stat: RecordStat;
  value: number;
  name: string;
  season: number | null;
} | null {
  const body = line
    .replace(/^\*+\s*/, "")
    .replace(/<ref[^>]*\/>/g, "")
    .replace(/<ref[\s\S]*?<\/ref>/g, "");
  const colon = body.indexOf(":");
  if (colon < 0) return null;
  const label = strip(body.slice(0, colon).replace(/\{\{em\|([^}]*)\}\}/g, "$1"));
  const rest = body.slice(colon + 1);
  const level = labelLevel(label) ?? inherited;
  if (!level) return null;
  const stat = statOf(
    label.replace(/,?\s*(career|single[- ]season|season|single[- ]game|game)\b.*$/i, ""),
    subsection,
  );
  if (!stat) return null;
  const name = playerOf(rest);
  const text = sans(rest);
  const num = /(\d{1,3}(?:,\d{3})+|\d+(?:\.\d)?)/.exec(text.replace(/\((19|20)\d\d\)/g, ""))?.[1];
  if (!name || !num) return null;
  const value = Number(num.replace(/,/g, ""));
  if (!Number.isFinite(value) || value <= 0) return null;
  const years = [...text.matchAll(/\b(19\d\d|20\d\d)\b/g)].map((m) => Number(m[1]));
  const season = years.length ? (level === "career" ? years[years.length - 1]! : years[0]!) : null;
  return { level, stat, value, name, season };
}

export function parseTeamRecords(teamId: string): TeamRecord[] {
  const file = teamRecordsFile(teamId);
  if (!existsSync(file)) return [];
  const wikitext: string = JSON.parse(readFileSync(file, "utf8")).parse.wikitext;
  const out: TeamRecord[] = [];
  const seen = new Set<string>();
  const keep = (r: {
    level: RecordLevel;
    stat: RecordStat;
    value: number;
    name: string;
    season: number | null;
  }) => {
    const key = `${r.level}:${r.stat}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ teamId, ...r });
  };
  // Walk the page: headings set the level (career, single season, single game) for what's below,
  // and the sub-section (Passing, Rushing...); bullet lists are read as they come.
  let lvl: RecordLevel | null = null;
  let lvlDepth = 0;
  let sub = "";
  for (const line of wikitext.split("\n")) {
    const h = /^(=+)\s*([^=]+?)\s*=+\s*$/.exec(line);
    if (h) {
      const depth = h[1]!.length;
      const found = level(h[2]!);
      if (found) {
        lvl = found;
        lvlDepth = depth;
        sub = "";
      } else if (depth <= lvlDepth) {
        lvl = null;
        sub = h[2]!;
      } else sub = h[2]!;
      continue;
    }
    if (line.startsWith("*")) {
      const b = bullet(line, lvl, sub);
      if (b) keep(b);
    }
  }
  // Tables (one row per record) under a classified heading.
  const parts = wikitext.split(/^==([^=][^\n]*?)==\s*$/m);
  for (let i = 1; i < parts.length; i += 2) {
    const tl = level(parts[i]!);
    if (!tl) continue;
    for (const table of parts[i + 1]!.split("{|").slice(1)) {
      for (const row of table.split("\n|-").slice(1)) {
        const c = cells(row);
        if (c.length < 3) continue;
        const label = c[0]!.replace(/\[\[(?:[^|\]]+\|)?([^\]]+)\]\]/g, "$1").trim();
        const hit = LABELS.find(([re]) => re.test(label));
        if (!hit || NOT.test(label)) continue;
        const value = Number(
          c.find((x) => /^[\d,]+(\.\d)?$/.test(x.replace(/\s/g, "")))?.replace(/,/g, ""),
        );
        const name = playerOf(row.replace(/^[^\n]*\n/, ""));
        if (!Number.isFinite(value) || value <= 0 || !name) continue;
        // The season: a year after the player (a single season's year, a game's date, or the last
        // year of a career span). Read from the row as written: dates may be templates.
        const after = row.slice(row.indexOf(name) + name.length);
        const years = [...after.matchAll(/\b(19\d\d|20\d\d)\b/g)].map((m) => Number(m[1]));
        const month = /\b(January|February)\b|\{\{dts\|\d{4}\|0?[12]\|/.exec(after);
        let season = years.length ? (tl === "career" ? years[years.length - 1]! : years[0]!) : null;
        if (tl === "game" && season !== null && month) season -= 1;
        keep({ level: tl, stat: hit[1], value, name, season });
      }
    }
  }
  return out;
}

/** Every franchise's record holders that were fetched. */
export function allTeamRecords(): TeamRecord[] {
  return Object.keys(wikiNames()).flatMap((id) => parseTeamRecords(id));
}
