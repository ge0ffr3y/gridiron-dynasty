/**
 * The League Year's key dates, worked out from the rules with exact date math.
 * A season's year runs from the day after the previous championship (the
 * offseason, February) through its own championship the next February.
 */
import { addDays, weekdayOf, yearOf, type LeagueDate } from "@fgm/foundation";
import type { CalendarStage, GameRound } from "../league/schema";
import type { Rules } from "../rules";

export interface SeasonDates {
  tagWindowOpens: LeagueDate;
  tagWindowCloses: LeagueDate;
  combine: LeagueDate;
  negotiatingPeriod: LeagueDate;
  /** The new League Year: contracts expire, free agency opens, trading resumes. */
  leagueYear: LeagueDate;
  draft: LeagueDate;
  fifthYearOptionDeadline: LeagueDate;
  juneFirst: LeagueDate;
  trainingCamp: LeagueDate;
  /** Saturday of each preseason weekend. */
  preseasonSaturdays: LeagueDate[];
  /** Final cut to 53. */
  cutdown: LeagueDate;
  /** Waiver claims from the cutdown are awarded and practice squads form. */
  practiceSquads: LeagueDate;
  /** Thursday that opens Week 1. */
  kickoff: LeagueDate;
  /** Sunday of each regular-season week (index 0 = Week 1). */
  weekSundays: LeagueDate[];
  tradeDeadline: LeagueDate;
  playoffs: Record<Exclude<GameRound, "regular" | "preseason">, LeagueDate>;
}

/** The Thursday after the first Monday of September (Labor Day). */
export function thursdayAfterLaborDay(season: number): LeagueDate {
  const septFirst = `${season}-09-01`;
  const toMonday = (7 - weekdayOf(septFirst)) % 7;
  return addDays(septFirst, toMonday + 3);
}

/** The last Thursday of April (the usual draft opening). */
function lastThursdayOfApril(season: number): LeagueDate {
  const april30 = `${season}-04-30`;
  // weekdayOf: 0 = Monday, so Thursday is 3.
  return addDays(april30, -((weekdayOf(april30) - 3 + 7) % 7));
}

function championshipOf(rules: Rules, season: number, kickoff: LeagueDate): LeagueDate {
  const cal = rules.calendar;
  const lastWeek = addDays(kickoff, 7 * (rules.schedule.regularSeasonWeeks - 1) + 3);
  return addDays(lastWeek, 3 * cal.playoffRoundGapDays + cal.championshipGapDays);
}

function kickoffOf(rules: Rules, season: number): LeagueDate {
  const cal = rules.calendar;
  return yearOf(cal.kickoffThursday) === season
    ? cal.kickoffThursday
    : thursdayAfterLaborDay(season);
}

/** Dates are pure date math from the rules, and asked for constantly: worked out once per season. */
const cache = new WeakMap<Rules, Map<number, SeasonDates>>();

export function seasonDates(rules: Rules, season: number): SeasonDates {
  let bySeason = cache.get(rules);
  if (!bySeason) cache.set(rules, (bySeason = new Map()));
  const known = bySeason.get(season);
  if (known) return known;
  const dates = computeSeasonDates(rules, season);
  bySeason.set(season, dates);
  return dates;
}

function computeSeasonDates(rules: Rules, season: number): SeasonDates {
  const cal = rules.calendar;
  const kickoff = kickoffOf(rules, season);
  const weekSundays = Array.from({ length: rules.schedule.regularSeasonWeeks }, (_, i) =>
    addDays(kickoff, 7 * i + 3),
  );
  const lastWeek = weekSundays[weekSundays.length - 1] as LeagueDate;
  const wildcard = addDays(lastWeek, cal.playoffRoundGapDays);
  const divisional = addDays(wildcard, cal.playoffRoundGapDays);
  const conference = addDays(divisional, cal.playoffRoundGapDays);
  const lastPreseason = addDays(kickoff, -cal.lastPreseasonSaturdayDaysBeforeKickoff);
  const preseasonSaturdays = Array.from({ length: Math.max(1, cal.preseasonWeeks) }, (_, i) =>
    addDays(lastPreseason, -7 * (Math.max(1, cal.preseasonWeeks) - 1 - i)),
  );
  const cutdown = addDays(lastPreseason, cal.cutdownDaysAfterLastPreseasonSaturday);
  // The offseason belongs to this season's League Year: it follows last season's championship.
  const lastChampionship = championshipOf(rules, season - 1, kickoffOf(rules, season - 1));
  const md = (monthDay: string) => `${season}-${monthDay}`;
  const deadlineWeek = weekSundays[rules.schedule.tradeDeadlineAfterWeek - 1] as LeagueDate;
  return {
    tagWindowOpens: md(cal.tagWindow.opens),
    tagWindowCloses: md(cal.tagWindow.closes),
    combine: addDays(lastChampionship, cal.combineDaysAfterChampionship),
    negotiatingPeriod: md(cal.negotiatingPeriodOpens),
    leagueYear: md(cal.leagueYearOpens),
    draft: cal.draftDates[String(season)] ?? lastThursdayOfApril(season),
    fifthYearOptionDeadline: md(cal.fifthYearOptionDeadline),
    juneFirst: md("06-01"),
    trainingCamp: addDays(
      preseasonSaturdays[0] as LeagueDate,
      -cal.trainingCampDaysBeforeFirstPreseasonSaturday,
    ),
    preseasonSaturdays,
    cutdown,
    practiceSquads: addDays(cutdown, 1),
    kickoff,
    weekSundays,
    tradeDeadline: addDays(deadlineWeek, cal.tradeDeadlineDaysAfterWeekSunday),
    playoffs: {
      wildcard,
      divisional,
      conference,
      championship: addDays(conference, cal.championshipGapDays),
    },
  };
}

/** One dated event of the League Year, for the calendar screen. */
export interface CalendarEvent {
  date: LeagueDate;
  label: string;
}

export function calendarEvents(rules: Rules, season: number): CalendarEvent[] {
  const d = seasonDates(rules, season);
  const events: CalendarEvent[] = [
    { date: d.tagWindowOpens, label: "Franchise and transition tag window opens" },
    { date: d.combine, label: "Scouting combine" },
    { date: d.tagWindowCloses, label: "Tag deadline" },
    { date: d.negotiatingPeriod, label: "Negotiating period with pending free agents" },
    {
      date: d.leagueYear,
      label: "New League Year: contracts expire, free agency and trading open",
    },
    { date: d.draft, label: "Draft, then the undrafted free-agent rush" },
    { date: d.fifthYearOptionDeadline, label: "Fifth-year option deadline" },
    { date: d.juneFirst, label: "June 1: releases split their dead money over two years" },
    { date: d.trainingCamp, label: "Training camp opens" },
    ...d.preseasonSaturdays.map((date, i) => ({ date, label: `Preseason week ${i + 1}` })),
    { date: d.cutdown, label: "Final cuts to 53" },
    { date: d.practiceSquads, label: "Waiver claims awarded; practice squads form" },
    { date: d.kickoff, label: "Week 1 kicks off" },
    { date: d.tradeDeadline, label: "Trade deadline; vested veterans now go on waivers" },
    { date: d.weekSundays.at(-1)!, label: `Week ${d.weekSundays.length}` },
    { date: d.playoffs.wildcard, label: "Wild-card round" },
    { date: d.playoffs.divisional, label: "Divisional round" },
    { date: d.playoffs.conference, label: "Conference championships" },
    { date: d.playoffs.championship, label: "Championship game" },
  ];
  return events.sort((a, b) => a.date.localeCompare(b.date));
}

/** Human-readable name of a calendar stage. */
export function stageLabel(stage: CalendarStage, week: number): string {
  switch (stage) {
    case "offseason":
      return "Offseason";
    case "free-agency":
      return "Free agency";
    case "after-draft":
      return "After the draft";
    case "preseason":
      return week === 1 ? "Training camp" : `Preseason week ${week - 1} played`;
    case "cutdown":
      return "Final cuts";
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

/** Stages that count as "the season is under way" (53-man rosters, practice squads). */
export function isPlaying(stage: CalendarStage): boolean {
  return (
    stage === "regular" ||
    stage === "wildcard" ||
    stage === "divisional" ||
    stage === "conference" ||
    stage === "championship"
  );
}
