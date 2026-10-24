/**
 * The real first season's schedule (Phase 16): every regular-season game of the season after the
 * one just played, as nflverse's schedule file has it (week, day, home team, neutral site), and
 * the picks traded away before the league starts (nfldata's trades file), in the order they were made.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "csv-parse/sync";
import type { RealPickTrade, RealScheduleGame } from "@fgm/sim-core";
import type { Row } from "../matchups";
import { CACHE } from "../matchups";
import { leagueTeam, SEASON } from "./inputs";

/** The league's first season: the one after the real season played. */
export const FIRST_SEASON = SEASON + 1;

export function realSchedule(games: Row[]): RealScheduleGame[] {
  return games
    .filter((g) => Number(g.season) === FIRST_SEASON && g.game_type === "REG")
    .map((g) => ({
      week: Number(g.week),
      date: g.gameday!,
      homeId: leagueTeam(g.home_team!),
      awayId: leagueTeam(g.away_team!),
      neutral: g.location === "Neutral",
    }))
    .sort(
      (a, b) => a.week - b.week || a.date.localeCompare(b.date) || a.homeId.localeCompare(b.homeId),
    );
}

/** Picks of later drafts that changed hands by `before` (the league's start date). */
export function realPickTrades(before: string): RealPickTrade[] {
  const file = join(CACHE, "trades.csv");
  if (!existsSync(file)) return [];
  const rows = parse(readFileSync(file), { columns: true, relax_column_count: true }) as Row[];
  return rows
    .filter(
      (r) =>
        r.pick_season &&
        r.pick_round &&
        Number(r.pick_season) > FIRST_SEASON &&
        (r.trade_date ?? "9999") <= before,
    )
    .map((r) => ({
      id: Number(r.trade_id),
      date: r.trade_date!,
      season: Number(r.pick_season),
      round: Number(r.pick_round),
      from: leagueTeam(r.gave!),
      to: leagueTeam(r.received!),
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
}
