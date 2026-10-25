/**
 * Franchise record books from each club's own leader pages (Phase 15c): every player's career
 * totals with the club and every single season it has had, for the statistics this league's record
 * book keeps. One layout for all 32 clubs, so every club gets a book; the pages have no
 * single-game lists, so those come from the clubs' public records pages where they exist.
 */
import { existsSync, readFileSync } from "node:fs";
import type { Position, RealHistoryInput, RecordLevel, RecordStat } from "@fgm/sim-core";
import { join } from "node:path";
import { CACHE, num as csvNum, readCsv, type Row } from "../matchups";
import { leagueTeam } from "../league/inputs";
import { FRANCHISE_CODES, lastFullSeason, pageFile, pageStamp } from "./fetch";
import { num, tableRows } from "./html";
import { cleanName, POSITION_FOR, type RecordsContext } from "./records";

/** A leader page, the level it lists, and its columns: (column, this league's stat). */
const PAGES: { page: string; level: RecordLevel; stats: [string, RecordStat][] }[] = [
  {
    page: "career-passing",
    level: "career",
    stats: [
      ["pass_yds", "passYds"],
      ["pass_td", "passTd"],
    ],
  },
  {
    page: "career-rushing",
    level: "career",
    stats: [
      ["rush_yds", "rushYds"],
      ["rush_td", "rushTd"],
    ],
  },
  {
    page: "career-receiving",
    level: "career",
    stats: [
      ["rec", "rec"],
      ["rec_yds", "recYds"],
      ["rec_td", "recTd"],
    ],
  },
  {
    page: "career-defense",
    level: "career",
    stats: [
      ["sacks", "sacks"],
      ["def_int", "defInt"],
    ],
  },
  { page: "career-kicking", level: "career", stats: [["fgm", "fgm"]] },
  {
    page: "single-season-passing",
    level: "season",
    stats: [
      ["pass_yds", "passYds"],
      ["pass_td", "passTd"],
    ],
  },
  {
    page: "single-season-rushing",
    level: "season",
    stats: [
      ["rush_yds", "rushYds"],
      ["rush_td", "rushTd"],
    ],
  },
  {
    page: "single-season-receiving",
    level: "season",
    stats: [
      ["rec", "rec"],
      ["rec_yds", "recYds"],
      ["rec_td", "recTd"],
    ],
  },
  { page: "single-season-kicking", level: "season", stats: [["fgm", "fgm"]] },
];

/** A franchise's lists keep this many. */
const KEEP = 3;

/** The stats files' columns for each statistic (no kicking: the files don't have it). */
const COLUMNS: Partial<Record<RecordStat, string>> = {
  passYds: "passing_yards",
  passTd: "passing_tds",
  rushYds: "rushing_yards",
  rushTd: "rushing_tds",
  rec: "receptions",
  recYds: "receiving_yards",
  recTd: "receiving_tds",
  sacks: "def_sacks",
  defInt: "def_interceptions",
};

/** Field goals made come from the play-by-play files (the stats files have no kicking). */
const KICKING_FROM = 2019;

/** The archived pages can be a few seasons old: seasons after the copy come from these. */
const RECENT_FROM = 2019;
const RECENT_TO = 2025;

interface Recent {
  pfr: string;
  name: string;
  season: number;
  teamId: string;
  values: Partial<Record<RecordStat, number>>;
}
let recent: Recent[] = [];

/** Loads the stats files for the recent seasons (call once, before building the records). */
export async function loadRecentStats(): Promise<void> {
  const pfrOf = new Map<string, string>();
  await readCsv(join(CACHE, "players.csv.gz"), (r: Row) => {
    if (r.gsis_id && r.pfr_id) pfrOf.set(r.gsis_id, r.pfr_id);
  });
  recent = [];
  for (let season = RECENT_FROM; season <= RECENT_TO; season++)
    await readCsv(join(CACHE, `stats_player_reg_${season}.csv.gz`), (r: Row) => {
      const pfr = pfrOf.get(r.player_id ?? "");
      if (!pfr || !r.recent_team) return;
      const values: Recent["values"] = {};
      for (const [stat, column] of Object.entries(COLUMNS) as [RecordStat, string][]) {
        const v = csvNum(r[column]);
        if (Number.isFinite(v) && v > 0) values[stat] = v;
      }
      if (Object.keys(values).length === 0) return;
      recent.push({
        pfr,
        name: r.player_display_name ?? r.player_name ?? "",
        season,
        teamId: leagueTeam(r.recent_team),
        values,
      });
    });
  // Field goals made, by kicker and team.
  const names = new Map<string, string>();
  await readCsv(join(CACHE, "players.csv.gz"), (r: Row) => {
    if (r.pfr_id) names.set(r.pfr_id, r.display_name ?? "");
  });
  for (let season = KICKING_FROM; season <= RECENT_TO; season++) {
    const made = new Map<string, number>();
    await readCsv(join(CACHE, `play_by_play_${season}.csv.gz`), (r: Row) => {
      if (r.season_type !== "REG" || r.play_type !== "field_goal" || r.field_goal_result !== "made")
        return;
      const pfr = pfrOf.get(r.kicker_player_id ?? "");
      if (!pfr || !r.posteam) return;
      const key = `${pfr}|${leagueTeam(r.posteam)}`;
      made.set(key, (made.get(key) ?? 0) + 1);
    });
    for (const [key, n] of made) {
      const [pfr, teamId] = key.split("|") as [string, string];
      recent.push({ pfr, name: names.get(pfr) ?? "", season, teamId, values: { fgm: n } });
    }
  }
}

interface Candidate {
  pfr: string | null;
  name: string;
  value: number;
  season: number | null;
}

export function franchiseLeaderRecords(
  ctx: RecordsContext,
  franchise: (code: string) => string | null,
): RealHistoryInput["records"] {
  const out: RealHistoryInput["records"] = [];
  let patched = 0;
  for (const code of FRANCHISE_CODES) {
    const scope = franchise(code);
    if (!scope) continue;
    for (const { page, level, stats } of PAGES) {
      const path = `teams/${code}/${page}.htm`;
      const file = pageFile(path);
      if (!existsSync(file)) continue;
      const html = readFileSync(file, "utf8");
      const id = /<table[^>]*id="([^"]+)"/.exec(html)?.[1];
      const rows = tableRows(html, id).filter((r) => r.player);
      const stamp = pageStamp(path);
      // Seasons the copy doesn't hold (it can be a few years old) come from the stats files.
      const held = (stamp ? lastFullSeason(stamp) : null) ?? RECENT_TO;
      const yearColumn = level === "season" ? "year_id" : "year_max";
      for (const [column, stat] of stats) {
        const candidates: Candidate[] = rows
          .filter((r) => num(r[column]) > 0)
          .map((r) => ({
            pfr: r.player!.id,
            name: cleanName(r.player!.text),
            value: num(r[column]),
            season: num(r[yearColumn]) || null,
          }));
        const later = recent.filter((x) => x.season > held && x.teamId === scope && x.values[stat]);
        if (later.length > 0) patched += 1;
        if (level === "season") {
          for (const x of later)
            candidates.push({ pfr: x.pfr, name: x.name, value: x.values[stat]!, season: x.season });
        } else {
          // Career: add the later seasons to the player's total (or start him, if he's new).
          const byPlayer = new Map<string, Candidate>(
            candidates.filter((c) => c.pfr).map((c) => [c.pfr!, c]),
          );
          for (const x of later) {
            const have = byPlayer.get(x.pfr);
            if (have) {
              have.value += x.values[stat]!;
              have.season = Math.max(have.season ?? 0, x.season);
            } else {
              const fresh = { pfr: x.pfr, name: x.name, value: x.values[stat]!, season: x.season };
              byPlayer.set(x.pfr, fresh);
              candidates.push(fresh);
            }
          }
        }
        const best = candidates
          // Biggest first; a tie goes to whoever did it first.
          .sort((a, b) => b.value - a.value || (a.season ?? 0) - (b.season ?? 0))
          .slice(0, KEEP);
        const top: RealHistoryInput["records"][number]["top"] = [];
        for (const c of best) {
          const p = ctx.person(c.pfr, c.name, {
            position: POSITION_FOR[stat] as Position,
            seasons: c.season ? [c.season] : [],
            teamId: scope,
          });
          top.push({
            value: c.value,
            key: p.known ? p.key : null,
            name: p.name,
            teamId: scope,
            season: c.season,
          });
        }
        if (top.length) out.push({ scope, level, stat, top });
      }
    }
  }
  ctx.report.push(
    `Franchise leader pages: ${out.length} lists; ${patched} extended with seasons played after the archived copy was taken.`,
  );
  return out;
}
