/**
 * The league's rules, loaded from the versioned config in `rules/`.
 * Every rule lives in that data, never in code (CLAUDE.md, hard rule 4).
 */
import { z } from "zod";
import rules2026 from "../../../rules/2026.json";

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "dates are written YYYY-MM-DD");
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
      practiceSquadMax: z.number().int().nonnegative(),
      practiceSquadInternationalExemption: z.number().int().nonnegative(),
    }),
    draft: z.object({
      source: z.string(),
      rounds: z.number().int().positive(),
      seasonsOfPicksHeld: z.number().int().positive(),
    }),
    calendar: z.object({
      source: z.string(),
      kickoffThursday: IsoDate,
      preseasonStartDaysBeforeKickoff: z.number().int().positive(),
      playoffRoundGapDays: z.number().int().positive(),
      championshipGapDays: z.number().int().positive(),
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
