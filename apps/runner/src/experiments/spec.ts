/**
 * Experiment files (Phase 17): JSON that says what to run (a kind of experiment and its settings),
 * on which start, for how many seeds and seasons, and what to measure. Everything an experiment
 * needs to be repeated is in the file; the result file carries a copy.
 */
import { readFileSync } from "node:fs";
import { z } from "zod";

/** A change made to a league before it is simulated (and, when held, after every step). */
export const LeverSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("gm"),
    /** Knobs from -1 to 1 (futureDiscount, analytics, capAggression, tradeAppetite, loyalty, risk); the rest are 0. */
    knobs: z.record(z.string(), z.number()).default({}),
    skill: z.number().default(55),
  }),
  z.object({
    type: z.literal("owner"),
    /** Traits (patience, budget, meddling, ambition); the rest are typical. */
    style: z.record(z.string(), z.number()).default({}),
  }),
  z.object({
    type: z.literal("coach"),
    roles: z.array(z.enum(["HC", "OC", "DC"])),
    ratings: z.record(z.string(), z.number()).default({}),
    style: z.record(z.string(), z.number()).default({}),
  }),
  z.object({
    type: z.literal("quarterback"),
    /** Every attribute that counts toward a quarterback's overall is set to this. */
    level: z.number(),
  }),
]);
export type Lever = z.infer<typeof LeverSchema>;

export const GroupSchema = z.object({
  name: z.string(),
  label: z.string(),
  levers: z.array(LeverSchema),
});
export type Group = z.infer<typeof GroupSchema>;

export const StartSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("generated") }),
  z.object({
    type: z.literal("real"),
    file: z.string(),
    /** The seed of the one start every run clones. */
    seed: z.number().int(),
  }),
]);

export const SpecSchema = z.object({
  id: z.string(),
  title: z.string(),
  question: z.string(),
  /** Which experiment code runs it (see registry.ts). */
  kind: z.enum(["team-groups", "title-odds", "playoff-randomness", "swap-study"]),
  start: StartSchema,
  runs: z.object({ count: z.number().int().positive(), firstSeed: z.number().int() }),
  /** Seasons simulated per run (kinds that play seasons). */
  seasons: z.number().int().positive().default(1),
  /** Applied to every team before the groups' own levers. */
  baseline: z.array(LeverSchema).default([]),
  groups: z.array(GroupSchema).default([]),
  /** Re-apply the levers after every step, so a replaced GM or coach gets the same profile. */
  hold: z.boolean().default(true),
  /** Settings only one kind reads. */
  params: z.record(z.string(), z.unknown()).default({}),
  /** Where the result goes: public ones are committed, private ones never leave this machine. */
  visibility: z.enum(["public", "private"]).default("public"),
  /** Written after the runs, by hand. */
  conclusion: z.string().default(""),
});
export type Spec = z.infer<typeof SpecSchema>;

export function loadSpec(path: string): Spec {
  const parsed = SpecSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
  if (!parsed.success)
    throw new Error(
      `${path} isn't a valid experiment file:\n${parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n")}`,
    );
  return parsed.data;
}
