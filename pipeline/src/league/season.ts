/**
 * The real 2025 season: every regular-season and playoff score (nflverse
 * schedules) with touchdowns counted from the play-by-play (tiebreakers use
 * them).
 */
import type { GameRound, RealGameInput } from "@fgm/sim-core";
import type { Row } from "../matchups";
import { num } from "../matchups";
import { leagueTeam, SEASON } from "./inputs";

const ROUNDS: Record<string, GameRound> = {
  REG: "regular",
  WC: "wildcard",
  DIV: "divisional",
  CON: "conference",
  SB: "championship",
};

/** `touchdowns` counts touchdowns by "game id|team code". */
export function seasonGames(games: Row[], touchdowns: Map<string, number>): RealGameInput[] {
  return games
    .filter((g) => Number(g.season) === SEASON && ROUNDS[g.game_type ?? ""])
    .sort(
      (a, b) =>
        (a.gameday ?? "").localeCompare(b.gameday ?? "") ||
        (a.game_id ?? "").localeCompare(b.game_id ?? ""),
    )
    .map((g) => {
      const round = ROUNDS[g.game_type!]!;
      if (num(g.home_score) !== num(g.home_score)) throw new Error(`no score for ${g.game_id}`);
      return {
        round,
        week: num(g.week),
        date: g.gameday!,
        homeId: leagueTeam(g.home_team!),
        awayId: leagueTeam(g.away_team!),
        neutral: g.location === "Neutral",
        homeScore: num(g.home_score),
        awayScore: num(g.away_score),
        homeTouchdowns: touchdowns.get(`${g.game_id}|${g.home_team}`) ?? 0,
        awayTouchdowns: touchdowns.get(`${g.game_id}|${g.away_team}`) ?? 0,
        overtime: g.overtime === "1",
      };
    });
}
