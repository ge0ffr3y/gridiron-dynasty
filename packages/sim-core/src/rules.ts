/**
 * The league's rules, loaded from the versioned config in `rules/`.
 * Every rule lives in that data, never in code (CLAUDE.md, hard rule 4).
 */
import { z } from "zod";
import rules2026 from "../../../rules/2026.json";

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "dates are written YYYY-MM-DD");

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

/** Team ids in rules order (conference, then division, then listed order). */
export function teamIdsInOrder(rules: Rules): string[] {
  return rules.structure.conferences.flatMap((c) => c.divisions.flatMap((d) => d.teams));
}
