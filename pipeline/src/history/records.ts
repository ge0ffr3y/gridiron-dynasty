/**
 * The real record books (Phase 15): league and franchise records for single games, single seasons
 * and careers, from the archived leader pages. Records still standing are kept (the league's top
 * ten, a franchise's top three of each list) whatever year they were set, renamed through the
 * same names as everyone else; a record set by someone who never otherwise appears gets a legend
 * card so his name has a page.
 */
import { existsSync, readFileSync } from "node:fs";
import type { Position, RealHistoryInput, RecordLevel, RecordStat } from "@fgm/sim-core";
import { pageFile } from "./fetch";
import { num, tableRows, type Row } from "./html";
import { allTeamRecords } from "./teamRecords";
import { franchiseLeaderRecords } from "./teamLeaders";

export interface RecordsContext {
  person: (
    pfrId: string | null,
    realName: string,
    hint?: { position: Position; seasons: number[]; teamId: string | null },
  ) => { key: string; name: string; known: boolean };
  report: string[];
}

/** Leader pages by stat: this league's record stat, the page's column, and the usual position. */
export const LEADER_PAGES: { page: string; stat: RecordStat; position: Position }[] = [
  { page: "pass_yds", stat: "passYds", position: "QB" },
  { page: "pass_td", stat: "passTd", position: "QB" },
  { page: "rush_yds", stat: "rushYds", position: "RB" },
  { page: "rush_td", stat: "rushTd", position: "RB" },
  { page: "rec", stat: "rec", position: "WR" },
  { page: "rec_yds", stat: "recYds", position: "WR" },
  { page: "rec_td", stat: "recTd", position: "WR" },
  { page: "sacks", stat: "sacks", position: "EDGE" },
  { page: "def_int", stat: "defInt", position: "CB" },
  { page: "fgm", stat: "fgm", position: "K" },
];

const KINDS: { kind: string; level: RecordLevel }[] = [
  { kind: "single_game", level: "game" },
  { kind: "single_season", level: "season" },
  { kind: "career", level: "career" },
];

/** League lists keep this many; a franchise's keep this many. */
const KEEP = { league: 10, team: 3 };

/** "[name removed]+ (37)" -> "[name removed]". */
export const cleanName = (s: string) =>
  s
    .replace(/\(\d+\)/g, "")
    .replace(/[*+%^]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** The season of a record row: a season list's year, a game's date, a career's last year. */
function seasonOf(row: Row, level: RecordLevel): number | null {
  if (level === "season") return num(row.year) || null;
  if (level === "game") {
    const m = /(\d{4})\s*$/.exec(row.boxscore?.text ?? "");
    if (!m) return null;
    const year = Number(m[1]);
    const month = /^[^,]*,\s*([A-Za-z]+)/.exec(row.boxscore?.text ?? "")?.[1] ?? "";
    // January and February games belong to the season before.
    return /^(January|February)/.test(month) ? year - 1 : year;
  }
  const years = /(\d{4})\D+(\d{4})/.exec(row.years?.text ?? "");
  return years ? Number(years[2]) : null;
}

const teamIdOf = (row: Row, franchise: (code: string) => string | null): string | null => {
  const code =
    row.team?.href?.match(/\/teams\/([a-z]+)\//)?.[1] ?? row.team?.text.toLowerCase() ?? "";
  return /^\dtm$/.test(code) ? null : franchise(code);
};

export function leagueRecords(
  ctx: RecordsContext,
  franchise: (code: string) => string | null,
): RealHistoryInput["records"] {
  const out: RealHistoryInput["records"] = [];
  for (const { page, stat, position } of LEADER_PAGES)
    for (const { kind, level } of KINDS) {
      const file = pageFile(`leaders/${page}_${kind}.htm`);
      if (!existsSync(file)) continue;
      const html = readFileSync(file, "utf8");
      const id = /<table[^>]*id="([^"]+)"/.exec(html)?.[1];
      const rows = tableRows(html, id).filter(
        (r) => r.player && num(r[page === "sacks" ? "sacks" : page]) > 0,
      );
      const top: RealHistoryInput["records"][number]["top"] = [];
      for (const r of rows.slice(0, KEEP.league)) {
        const season = seasonOf(r, level);
        const teamId = teamIdOf(r, franchise);
        const p = ctx.person(r.player!.id, cleanName(r.player!.text), {
          position,
          seasons: season ? [season] : [],
          teamId,
        });
        top.push({
          value: num(r[page]),
          key: p.known ? p.key : null,
          name: p.name,
          teamId,
          season,
        });
      }
      if (top.length) out.push({ scope: "league", level, stat, top });
    }
  return out;
}

export const POSITION_FOR: Record<RecordStat, Position> = {
  passYds: "QB",
  passTd: "QB",
  rushYds: "RB",
  rushTd: "RB",
  rec: "WR",
  recYds: "WR",
  recTd: "WR",
  sacks: "EDGE",
  defInt: "CB",
  fgm: "K",
};

/**
 * Each franchise's standing record holders: the top three of each career and season list from the
 * club's leader pages, and the single-game marks (and any list a leader page lacks) from the club's
 * public records page, where it has one.
 */
export function franchiseRecords(
  ctx: RecordsContext,
  franchise: (code: string) => string | null,
): RealHistoryInput["records"] {
  const out = franchiseLeaderRecords(ctx, franchise);
  const have = new Set(out.map((r) => `${r.scope}|${r.level}|${r.stat}`));
  for (const r of allTeamRecords()) {
    if (have.has(`${r.teamId}|${r.level}|${r.stat}`)) continue;
    const p = ctx.person(null, r.name, {
      position: POSITION_FOR[r.stat],
      seasons: r.season ? [r.season] : [],
      teamId: r.teamId,
    });
    out.push({
      scope: r.teamId,
      level: r.level,
      stat: r.stat,
      top: [
        {
          value: r.value,
          key: p.known ? p.key : null,
          name: p.name,
          teamId: r.teamId,
          season: r.season,
        },
      ],
    });
  }
  return out;
}

export function buildRecords(
  ctx: RecordsContext,
  franchise: (code: string) => string | null,
): RealHistoryInput["records"] {
  const league = leagueRecords(ctx, franchise);
  const teams = franchiseRecords(ctx, franchise);
  ctx.report.push(
    `Records: ${league.length} league lists from the archived leader pages, ${teams.length} franchise record lists (leader pages for career and season marks, the clubs' public record pages for single games).`,
  );
  return [...league, ...teams];
}
