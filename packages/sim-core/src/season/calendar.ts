/**
 * The season's key dates, worked out from the rules with exact date math.
 */
import { addDays, weekdayOf, yearOf, type LeagueDate } from "../dates";
import type { CalendarStage, GameRound } from "../league/schema";
import type { Rules } from "../rules";

export interface SeasonDates {
  preseasonStart: LeagueDate;
  /** Thursday that opens Week 1. */
  kickoff: LeagueDate;
  /** Sunday of each regular-season week (index 0 = Week 1). */
  weekSundays: LeagueDate[];
  playoffs: Record<Exclude<GameRound, "regular">, LeagueDate>;
}

/** The Thursday after the first Monday of September (Labor Day). */
export function thursdayAfterLaborDay(season: number): LeagueDate {
  const septFirst = `${season}-09-01`;
  const toMonday = (7 - weekdayOf(septFirst)) % 7;
  return addDays(septFirst, toMonday + 3);
}

export function seasonDates(rules: Rules, season: number): SeasonDates {
  const cal = rules.calendar;
  const kickoff =
    yearOf(cal.kickoffThursday) === season ? cal.kickoffThursday : thursdayAfterLaborDay(season);
  const weekSundays = Array.from({ length: rules.schedule.regularSeasonWeeks }, (_, i) =>
    addDays(kickoff, 7 * i + 3),
  );
  const lastWeek = weekSundays[weekSundays.length - 1] as LeagueDate;
  const wildcard = addDays(lastWeek, cal.playoffRoundGapDays);
  const divisional = addDays(wildcard, cal.playoffRoundGapDays);
  const conference = addDays(divisional, cal.playoffRoundGapDays);
  return {
    preseasonStart: addDays(kickoff, -cal.preseasonStartDaysBeforeKickoff),
    kickoff,
    weekSundays,
    playoffs: {
      wildcard,
      divisional,
      conference,
      championship: addDays(conference, cal.championshipGapDays),
    },
  };
}

/** Human-readable name of a calendar stage. */
export function stageLabel(stage: CalendarStage, week: number): string {
  switch (stage) {
    case "offseason":
      return "Offseason";
    case "preseason":
      return "Preseason";
    case "regular":
      return `Week ${week}`;
    case "wildcard":
      return "Wild-card round";
    case "divisional":
      return "Divisional round";
    case "conference":
      return "Conference championships";
    case "championship":
      return "Championship game";
    case "complete":
      return "Season complete";
  }
}
