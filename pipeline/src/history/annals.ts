/**
 * The real past seasons (Phase 15), 1966-2024, from a public game-by-game scores file kept in
 * pipeline/private/history/raw/: each franchise's record, points and playoff trip, and the
 * champion and runner-up with the championship game's score. Franchises follow the league's own
 * convention (a club that moved or renamed is one franchise; the league's 1996 expansion team is
 * its own); the mapping from real club names is in a private file (`teams.ts`). Cities are kept as
 * they were; nicknames are never stored.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Annal } from "@fgm/sim-core";
import { HISTORY } from "./fetch";

export const SCORES_FILE = join(HISTORY, "raw", "spreadspoke_scores.csv");
export const LAST_ANNAL = 2024;

import { franchiseOf } from "./teams";

interface Game {
  season: number;
  week: string;
  playoff: boolean;
  home: string;
  away: string;
  homeScore: number;
  awayScore: number;
}

/** A CSV line with quoted fields. */
function fields(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === "," && !quoted) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function readGames(): Game[] {
  if (!existsSync(SCORES_FILE)) return [];
  const [head, ...lines] = readFileSync(SCORES_FILE, "utf8").trim().split(/\r?\n/);
  const col = Object.fromEntries(head!.split(",").map((h, i) => [h, i]));
  return lines
    .map(fields)
    .map((f) => ({
      season: Number(f[col.schedule_season!]),
      week: f[col.schedule_week!]!,
      playoff: f[col.schedule_playoff!] === "TRUE",
      home: f[col.team_home!]!,
      away: f[col.team_away!]!,
      homeScore: Number(f[col.score_home!]),
      awayScore: Number(f[col.score_away!]),
    }))
    .filter((g) => g.season >= 1966 && g.season <= LAST_ANNAL && Number.isFinite(g.homeScore));
}

/** Every season from 1966 through 2024, oldest first. */
export function buildAnnals(): Annal[] {
  const games = readGames();
  const out: Annal[] = [];
  for (let season = 1966; season <= LAST_ANNAL; season++) {
    const year = games.filter((g) => g.season === season);
    if (year.length === 0) continue;
    type Tally = Annal["teams"][number];
    const tally = new Map<string, Tally>();
    const get = (name: string): Tally => {
      const f = franchiseOf(name);
      let t = tally.get(f.teamId);
      if (!t) {
        t = {
          teamId: f.teamId,
          city: f.city,
          wins: 0,
          losses: 0,
          ties: 0,
          pointsFor: 0,
          pointsAgainst: 0,
          playoffs: false,
        };
        tally.set(f.teamId, t);
      }
      return t;
    };
    for (const g of year) {
      const home = get(g.home);
      const away = get(g.away);
      if (g.playoff) {
        home.playoffs = true;
        away.playoffs = true;
        continue;
      }
      home.pointsFor += g.homeScore;
      home.pointsAgainst += g.awayScore;
      away.pointsFor += g.awayScore;
      away.pointsAgainst += g.homeScore;
      if (g.homeScore > g.awayScore) {
        home.wins += 1;
        away.losses += 1;
      } else if (g.homeScore < g.awayScore) {
        away.wins += 1;
        home.losses += 1;
      } else {
        home.ties += 1;
        away.ties += 1;
      }
    }
    // The championship game: the last round of the playoffs (the other rounds have these names).
    const earlier = new Set(["Wildcard", "Division", "Conference"]);
    const final = year.find((g) => g.playoff && !earlier.has(g.week));
    const winner = final ? (final.homeScore > final.awayScore ? final.home : final.away) : null;
    const loser = final ? (final.homeScore > final.awayScore ? final.away : final.home) : null;
    out.push({
      season,
      championId: winner ? franchiseOf(winner).teamId : null,
      runnerUpId: loser ? franchiseOf(loser).teamId : null,
      final: final
        ? [Math.max(final.homeScore, final.awayScore), Math.min(final.homeScore, final.awayScore)]
        : null,
      teams: [...tally.values()].sort((a, b) => a.teamId.localeCompare(b.teamId)),
      coaches: {},
    });
  }
  return out;
}
