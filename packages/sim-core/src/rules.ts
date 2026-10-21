/**
 * The league's rules, loaded from the versioned config in `rules/`.
 * Every rule lives in that data, never in code (CLAUDE.md, hard rule 4).
 */
import { z } from "zod";
import rules2026 from "../../../rules/2026.json";

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "dates are written YYYY-MM-DD");
const OvertimeSchema = z.object({
  periodMinutes: z.number().positive(),
  /** null = keep playing periods until someone wins. */
  maxPeriods: z.number().int().positive().nullable(),
  timeouts: z.number().int().nonnegative(),
  bothTeamsPossess: z.boolean(),
});

/** Rules of a single game (clock, kicks, overtime). The game engine reads these. */
export const GameRulesSchema = z.object({
  source: z.string(),
  quarterMinutes: z.number().positive(),
  timeoutsPerHalf: z.number().int().nonnegative(),
  twoMinuteWarning: z.boolean(),
  playClockSeconds: z.number().int().positive(),
  outOfBoundsStopsClockLastSeconds: z.object({
    firstHalf: z.number().int(),
    secondHalf: z.number().int(),
  }),
  extraPointSpot: z.number().int().positive(),
  twoPointSpot: z.number().int().positive(),
  kickoff: z.object({
    /** The kicking team's yard line the ball is kicked from. */
    kickFrom: z.number().int().positive(),
    /** The landing zone runs from the receiving team's goal line out to this yard line. */
    landingZoneDepth: z.number().int().positive(),
    touchbackSpot: z.number().int().positive(),
    landingZoneTouchbackSpot: z.number().int().positive(),
    shortOrOutOfBoundsSpot: z.number().int().positive(),
    /** When an onside kick may be declared (there are no surprise onside kicks). */
    onside: z.object({ anyTime: z.boolean(), onlyWhenTrailing: z.boolean() }),
  }),
  puntTouchbackSpot: z.number().int().positive(),
  safetyFreeKickFrom: z.number().int().positive(),
  overtime: z.object({ regularSeason: OvertimeSchema, playoffs: OvertimeSchema }),
  penalties: z.object({
    source: z.string(),
    types: z.record(
      z.string(),
      z.object({
        /** When it can happen: before the snap, on any play, only on passes, or on kick returns. */
        phase: z.enum(["pre", "live", "pass", "return"]),
        side: z.enum(["offense", "defense"]),
        yards: z.number().int().nonnegative(),
        /** Previous spot, the spot of the foul (pass interference), or the end of the play (personal fouls). */
        from: z.enum(["previous", "spot", "end"]),
        automaticFirstDown: z.boolean(),
        lossOfDown: z.boolean(),
      }),
    ),
  }),
});
export type GameRules = z.infer<typeof GameRulesSchema>;

const Dollars = z.number().int();
const Share = z.number().min(0).max(1);
const TAG_CATEGORIES = ["QB", "RB", "WR", "TE", "OL", "DE", "DT", "LB", "CB", "S", "ST"] as const;
export type TagCategory = (typeof TAG_CATEGORIES)[number];
const ByCategory = z.object(
  Object.fromEntries(TAG_CATEGORIES.map((c) => [c, Dollars])) as Record<
    TagCategory,
    typeof Dollars
  >,
);

/** The salary cap and contract rules (Phase 7), every value from the CBA or an NFL announcement. */
export const CapRulesSchema = z.object({
  source: z.string(),
  /** Real caps; later years grow by `futureGrowthRate`. */
  salaryCapByYear: z.record(z.string(), Dollars),
  futureGrowthRate: z.number(),
  futureGrowthNote: z.string(),
  maxProrationYears: z.number().int().positive(),
  offseasonTopContracts: z.number().int().positive(),
  juneFirstDesignationsPerYear: z.number().int().nonnegative(),
  minimumSalary: z.object({
    /** Credited-season floors of each column: 0, 1, 2, 3, 4-6, 7+. */
    creditedSeasonFloors: z.array(z.number().int().nonnegative()),
    active: z.record(z.string(), z.array(Dollars)),
    notActive: z.record(z.string(), z.array(Dollars)),
    afterAgreementNote: z.string(),
  }),
  veteranSalaryBenefit: z.object({
    minCreditedSeasons: z.number().int(),
    chargedAsCreditedSeasons: z.number().int(),
    bonusAllowance: Dollars,
    note: z.string(),
  }),
  minimumCashSpending: z.object({
    share: Share,
    periods: z.array(z.tuple([z.number().int(), z.number().int()])),
    afterAgreementYears: z.number().int().positive(),
  }),
  tags: z.object({
    categories: z.array(z.enum(TAG_CATEGORIES)),
    positionCategory: z.record(z.string(), z.enum(TAG_CATEGORIES)),
    franchiseTopN: z.number().int().positive(),
    transitionTopN: z.number().int().positive(),
    yearsAveraged: z.number().int().positive(),
    priorSalaryMultiplier: z.number(),
    thirdTagMultiplier: z.number(),
    franchise2026: ByCategory,
    transition2026: ByCategory,
  }),
  rfaTenders2026: z.object({
    firstRound: Dollars,
    secondRound: Dollars,
    originalRound: Dollars,
    rightOfFirstRefusal: Dollars,
    priorSalaryMultiplier: z.number(),
  }),
  fifthYearOption: z.object({
    /** Ranks averaged (cap-percentage method) for the basic and playing-time tiers. */
    basic: z.tuple([z.number().int(), z.number().int()]),
    playingTime: z.tuple([z.number().int(), z.number().int()]),
    playingTimeShare: Share,
    playingTimeSeasons: z.number().int(),
    everySeasonShare: Share,
  }),
  rookieScale: z.object({
    years: z.number().int().positive(),
    note: z.string(),
    /** [overall pick, value above four rookie-minimum salaries as a share of the cap, signing-bonus share]. */
    picks: z.array(z.tuple([z.number().int().positive(), z.number(), Share])).min(2),
  }),
});
export type CapRules = z.infer<typeof CapRulesSchema>;

/** Two division names, e.g. ["East", "West"]. */
const DivisionPair = z.tuple([z.string(), z.string()]);

export const RulesSchema = z
  .object({
    version: z.number().int().positive(),
    season: z.number().int(),
    startDate: IsoDate,
    structure: z.object({
      source: z.string(),
      conferences: z
        .array(
          z.object({
            id: z.string(),
            name: z.string(),
            divisions: z
              .array(
                z.object({ id: z.string(), name: z.string(), teams: z.array(z.string()).min(1) }),
              )
              .min(1),
          }),
        )
        .min(1),
    }),
    roster: z.object({
      source: z.string(),
      offseasonMax: z.number().int().positive(),
      regularSeasonMax: z.number().int().positive(),
      gameDayActives: z.number().int().positive(),
      gameDayActivesFewOffensiveLinemen: z.number().int().positive(),
      gameDayMinOffensiveLinemen: z.number().int().nonnegative(),
      practiceSquad: z.object({
        max: z.number().int().nonnegative(),
        internationalExemption: z.number().int().nonnegative(),
        /** Players with any number of accrued seasons. */
        veteransMax: z.number().int().nonnegative(),
        /** Everyone else may have at most this many accrued seasons. */
        restrictedMaxAccruedSeasons: z.number().int().nonnegative(),
        elevationsPerGame: z.number().int().nonnegative(),
        elevationsPerPlayerPerSeason: z.number().int().nonnegative(),
        protectedPerWeek: z.number().int().nonnegative(),
        /** Season -> [restricted players' weekly pay, veteran minimum, veteran maximum]. */
        weeklySalary: z.record(z.string(), z.tuple([Dollars, Dollars, Dollars])),
        weeklySalaryNote: z.string(),
      }),
      reserve: z.object({
        injuredMinGames: z.number().int().positive(),
        returnsPerSeason: z.number().int().nonnegative(),
        returnsPlayoffExtra: z.number().int().nonnegative(),
        returnsAtCutdown: z.number().int().nonnegative(),
        pupMinGames: z.number().int().positive(),
      }),
      waivers: z.object({
        /** Players with at least this many accrued seasons skip waivers until the trade deadline. */
        vestedVeteranSeasons: z.number().int().positive(),
        /** Claim order follows last season's draft order through this week, then current standings. */
        draftOrderThroughWeek: z.number().int().nonnegative(),
      }),
    }),
    draft: z.object({
      source: z.string(),
      rounds: z.number().int().positive(),
      seasonsOfPicksHeld: z.number().int().positive(),
    }),
    calendar: z.object({
      source: z.string(),
      kickoffThursday: IsoDate,
      playoffRoundGapDays: z.number().int().positive(),
      championshipGapDays: z.number().int().positive(),
      /** Month-day dates ("MM-DD") that repeat every year. */
      tagWindow: z.object({
        opens: z.string().regex(/^\d{2}-\d{2}$/),
        closes: z.string().regex(/^\d{2}-\d{2}$/),
      }),
      combineDaysAfterChampionship: z.number().int().nonnegative(),
      negotiatingPeriodOpens: z.string().regex(/^\d{2}-\d{2}$/),
      leagueYearOpens: z.string().regex(/^\d{2}-\d{2}$/),
      /** Known draft dates; other years use the last Thursday of April. */
      draftDates: z.record(z.string(), IsoDate),
      fifthYearOptionDeadline: z.string().regex(/^\d{2}-\d{2}$/),
      trainingCampDaysBeforeFirstPreseasonSaturday: z.number().int().positive(),
      preseasonWeeks: z.number().int().nonnegative(),
      lastPreseasonSaturdayDaysBeforeKickoff: z.number().int().positive(),
      cutdownDaysAfterLastPreseasonSaturday: z.number().int().nonnegative(),
      tradeDeadlineDaysAfterWeekSunday: z.number().int().nonnegative(),
    }),
    schedule: z.object({
      source: z.string(),
      regularSeasonWeeks: z.number().int().positive(),
      byeWeeks: z.tuple([z.number().int().positive(), z.number().int().positive()]),
      maxByesPerWeek: z.number().int().positive(),
      finalWeekDivisionOnly: z.boolean(),
      tradeDeadlineAfterWeek: z.number().int().positive(),
      rotationBaseSeason: z.number().int(),
      sameConferenceRotation: z.array(z.array(DivisionPair)).min(1),
      otherConferenceRotation: z.array(z.array(DivisionPair)).min(1),
      seventeenthGameRotationOffset: z.number().int(),
      seventeenthGameHostInEvenSeasons: z.string(),
    }),
    playoffs: z.object({
      source: z.string(),
      teamsPerConference: z.number().int().positive(),
      byesPerConference: z.number().int().nonnegative(),
    }),
    game: GameRulesSchema,
    cap: CapRulesSchema,
  })
  .superRefine((rules, ctx) => {
    const seen = new Set<string>();
    for (const conference of rules.structure.conferences) {
      for (const division of conference.divisions) {
        for (const team of division.teams) {
          if (seen.has(team))
            ctx.addIssue({ code: "custom", message: `team ${team} appears twice` });
          seen.add(team);
        }
      }
    }
    if (rules.roster.gameDayActives > rules.roster.regularSeasonMax) {
      ctx.addIssue({
        code: "custom",
        message: "game-day actives can't exceed the regular-season roster",
      });
    }
    // Every rotation table must pair each division exactly once.
    const [first, second] = rules.structure.conferences;
    const names = JSON.stringify(first?.divisions.map((d) => d.name).sort() ?? []);
    const coversAll = (list: string[]) => JSON.stringify([...list].sort()) === names;
    rules.schedule.sameConferenceRotation.forEach((year, i) => {
      if (!coversAll(year.flat())) {
        ctx.addIssue({
          code: "custom",
          message: `sameConferenceRotation[${i}] must pair every division once`,
        });
      }
    });
    rules.schedule.otherConferenceRotation.forEach((year, i) => {
      if (!coversAll(year.map((p) => p[0])) || !coversAll(year.map((p) => p[1]))) {
        ctx.addIssue({
          code: "custom",
          message: `otherConferenceRotation[${i}] must pair every division once`,
        });
      }
    });
    if (second && !coversAll(second.divisions.map((d) => d.name))) {
      ctx.addIssue({ code: "custom", message: "both conferences need the same division names" });
    }
    if (
      !rules.structure.conferences.some(
        (c) => c.id === rules.schedule.seventeenthGameHostInEvenSeasons,
      )
    ) {
      ctx.addIssue({
        code: "custom",
        message: "seventeenthGameHostInEvenSeasons must be a conference id",
      });
    }
  });

export type Rules = z.infer<typeof RulesSchema>;

/** Validates a rules file, with a readable message listing every problem. */
export function loadRules(data: unknown): Rules {
  const result = RulesSchema.safeParse(data);
  if (!result.success) {
    const problems = result.error.issues.map(
      (i) => `  - ${i.path.join(".") || "(file)"}: ${i.message}`,
    );
    throw new Error(`The rules file is invalid:\n${problems.join("\n")}`);
  }
  return result.data;
}

/** The rules for each season we have a config for. */
export const RULES_BY_SEASON: Record<number, Rules> = { 2026: loadRules(rules2026) };

/**
 * The rules that apply to a season: that season's file if we have one,
 * otherwise the nearest earlier file (or the earliest file for seasons before it).
 */
export function rulesFor(season: number): Rules {
  const seasons = Object.keys(RULES_BY_SEASON)
    .map(Number)
    .sort((a, b) => a - b);
  const pick = seasons.filter((s) => s <= season).pop() ?? seasons[0];
  return RULES_BY_SEASON[pick as number] as Rules;
}

/** Team ids in rules order (conference, then division, then listed order). */
export function teamIdsInOrder(rules: Rules): string[] {
  return rules.structure.conferences.flatMap((c) => c.divisions.flatMap((d) => d.teams));
}
