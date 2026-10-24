/**
 * The carousel the real league missed (Phase 16). The real staffs come from the end of the 2025
 * regular season, so the firings and hires that followed (Black Monday, interviews, the hires as
 * playoff teams finished) happen in each new game, on its own seed, by the same rules as every
 * later year. The real starting file keeps the 2025 games for this; the league steps back into
 * that season, runs the offseason's carousel, and returns to the day the league starts.
 */
import type { League } from "../league/schema";
import { executivesSeasonEnd } from "../front-office/owners";
import { PLAYOFF_ROUNDS } from "../league/schema";
import { currentStandings } from "../season/flow";
import { seasonDates } from "../season/calendar";
import { winnerOf } from "../season/playoffs";
import { blackMonday, hiringRound, offseasonStaffing } from "./carousel";

export function runStartingCarousel(league: League): void {
  const prior = league.priorSeason;
  if (!prior) return;
  const keep = {
    season: league.season,
    date: league.date,
    calendar: league.calendar,
    games: league.games,
  };
  const dates = seasonDates(league.rules, prior.season);
  league.season = prior.season;
  league.games = prior.games;
  try {
    league.calendar = { stage: "wildcard", week: 1 };
    league.date = dates.weekSundays[dates.weekSundays.length - 1]!;
    blackMonday(league);
    // Each playoff round ends: teams that are out can interview and sign.
    const rounds = PLAYOFF_ROUNDS.slice(0, -1);
    rounds.forEach((round, i) => {
      league.calendar = { stage: PLAYOFF_ROUNDS[i + 1]!, week: 1 };
      league.date = dates.playoffs[round];
      hiringRound(league, false);
    });
    league.calendar = { stage: "complete", week: 1 };
    league.date = dates.playoffs.championship;
    const final = league.games.find((g) => g.round === "championship" && g.result);
    const seeded = new Set(currentStandings(league).seed.keys());
    offseasonStaffing(league);
    executivesSeasonEnd(league, seeded, final ? (winnerOf(final) as string) : null);
  } finally {
    league.season = keep.season;
    league.date = keep.date;
    league.calendar = keep.calendar;
    league.games = keep.games;
    league.priorSeason = null;
  }
}
