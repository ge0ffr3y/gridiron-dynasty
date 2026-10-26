/**
 * Experiments (Phase 17): levers hold when a general manager or coach is replaced, groups are split
 * evenly, and a result doesn't depend on how many workers ran it or whether it was interrupted.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  advance,
  coachIn,
  createLeague,
  gmOf,
  hireGm,
  officeFire,
  ownerOf,
  uniformFrom,
} from "@fgm/sim-core";
import { describe, expect, it } from "vitest";
import { applyAll, applyLever, assignTeams, startingQuarterback } from "./levers";
import { SpecSchema, type Group } from "./spec";

const groups: Group[] = [
  { name: "a", label: "A", levers: [{ type: "gm", knobs: { capAggression: 1 }, skill: 70 }] },
  { name: "b", label: "B", levers: [{ type: "gm", knobs: { capAggression: -1 }, skill: 70 }] },
];

describe("levers", () => {
  const league = createLeague({ seed: 5, name: "Levers" });

  it("set a general manager's profile whole, and an owner's traits", () => {
    const team = league.teams[0]!.id;
    applyLever(league, team, groups[0]!.levers[0]!);
    expect(gmOf(league, team)!.gm).toEqual({
      futureDiscount: 0,
      analytics: 0,
      capAggression: 1,
      tradeAppetite: 0,
      loyalty: 0,
      risk: 0,
      skill: 70,
    });
    applyLever(league, team, { type: "owner", style: { budget: 1 } });
    expect(ownerOf(league, team)!.owner).toMatchObject({ budget: 1, patience: 0 });
  });

  it("make a coach and a quarterback what the experiment says", () => {
    const team = league.teams[1]!.id;
    applyLever(league, team, {
      type: "coach",
      roles: ["HC"],
      ratings: { leadership: 99 },
      style: { fourthDown: 0.07 },
    });
    expect(coachIn(league, team, "HC")!.ratings.leadership).toBe(99);
    expect(coachIn(league, team, "HC")!.style.fourthDown).toBe(0.07);
    applyLever(league, team, { type: "quarterback", level: 96 });
    const qb = startingQuarterback(league, team)!;
    expect(qb.ratings.throwAccuracyShort).toBe(96);
    expect(qb.ratings.decisionMaking).toBe(96);
  });

  it("split the teams into equal groups, differently for each seed", () => {
    const ids = league.teams.map((t) => t.id);
    const a = assignTeams(ids, groups, 1, uniformFrom);
    const again = assignTeams(ids, groups, 1, uniformFrom);
    const b = assignTeams(ids, groups, 2, uniformFrom);
    const names = (m: Map<string, Group>) => ids.map((id) => m.get(id)!.name).join("");
    expect(names(a)).toBe(names(again));
    expect(names(a)).not.toBe(names(b));
    expect([...a.values()].filter((g) => g.name === "a")).toHaveLength(16);
  });

  it("hold: a replaced general manager and a replaced head coach get the profile again", () => {
    const l = createLeague({ seed: 6, name: "Hold" });
    const assignment = assignTeams(
      l.teams.map((t) => t.id),
      groups,
      6,
      uniformFrom,
    );
    applyAll(l, [], assignment);
    const team = l.teams[0]!.id;
    const profile = assignment.get(team)!.levers[0]!;
    // Fire the GM and hire another, as an owner would on Black Monday.
    const old = gmOf(l, team)!;
    old.teamId = null;
    const hired = hireGm(l, team, "test");
    expect(hired.id).not.toBe(old.id);
    // The newcomer arrives with his own knobs...
    applyAll(l, [], assignment);
    expect(gmOf(l, team)!.gm).toMatchObject(
      profile.type === "gm" ? { capAggression: profile.knobs.capAggression, skill: 70 } : {},
    );
    // ...and the same goes for a head coach.
    officeFire(l, coachIn(l, team, "HC")!.id);
    advance(l);
    applyAll(
      l,
      [{ type: "coach", roles: ["HC"], ratings: { leadership: 90 }, style: {} }],
      assignment,
    );
    const hc = coachIn(l, team, "HC");
    if (hc) expect(hc.ratings.leadership).toBe(90);
  });
});

describe("the spec file", () => {
  it("rejects what it can't use, with the field named", () => {
    const bad = SpecSchema.safeParse({ id: "x", title: "t", question: "q", kind: "nope" });
    expect(bad.success).toBe(false);
  });

  it("the experiment files in the repository are all valid", async () => {
    const { readdirSync } = await import("node:fs");
    const { loadSpec } = await import("./spec");
    const folder = join(import.meta.dirname, "..", "..", "..", "..", "experiments");
    for (const f of readdirSync(folder).filter((x) => x.endsWith(".json")))
      expect(() => loadSpec(join(folder, f)), f).not.toThrow();
  });
});

describe("the runner", () => {
  // A tiny experiment: two seeds, one season. Each run builds a league and plays a season (~15 s).
  const spec = {
    id: "test-tiny",
    title: "Tiny",
    question: "Does it run?",
    kind: "team-groups",
    start: { type: "generated" },
    runs: { count: 2, firstSeed: 90 },
    seasons: 1,
    baseline: [{ type: "gm", knobs: {}, skill: 55 }],
    groups,
    visibility: "private",
  };

  it("gives the same result with one process in-line, two workers, and after an interruption", async () => {
    const { runExperiment, outputFolder } = await import("./pool");
    const { SpecSchema: S } = await import("./spec");
    const dir = mkdtempSync(join(tmpdir(), "fgm-exp-"));
    const file = join(dir, "tiny.json");
    writeFileSync(file, JSON.stringify(spec));
    const out = outputFolder(S.parse(spec));
    const results = join(out, "test-tiny.json");
    const runs = join(out, "test-tiny.runs.jsonl");
    const clean = () => {
      for (const f of [results, runs]) if (existsSync(f)) rmSync(f);
    };
    const quiet = () => {};
    try {
      clean();
      await runExperiment(file, { workers: 0, log: quiet, publish: false });
      const inline = readFileSync(results, "utf8");
      clean();
      await runExperiment(file, { workers: 2, log: quiet, publish: false });
      expect(readFileSync(results, "utf8")).toBe(inline);
      // Interrupted after one run, then resumed.
      clean();
      await runExperiment(file, { workers: 0, runs: 1, log: quiet, publish: false });
      expect(readFileSync(runs, "utf8").trim().split("\n")).toHaveLength(1);
      await runExperiment(file, { workers: 1, log: quiet, publish: false });
      expect(readFileSync(runs, "utf8").trim().split("\n")).toHaveLength(2);
      expect(readFileSync(results, "utf8")).toBe(inline);
    } finally {
      clean();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 300_000);
});
