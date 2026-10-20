import { describe, expect, it } from "vitest";
import rules2026 from "../../../rules/2026.json";
import { loadRules, RULES_BY_SEASON, teamIdsInOrder } from "./rules";

describe("rules config", () => {
  it("the 2026 rules file is valid", () => {
    const rules = RULES_BY_SEASON[2026];
    expect(rules?.season).toBe(2026);
    expect(teamIdsInOrder(rules!)).toHaveLength(32);
    expect(rules!.roster.offseasonMax).toBe(90);
  });

  it("rejects a broken rules file with a readable message", () => {
    const broken = JSON.parse(JSON.stringify(rules2026)) as Record<string, unknown>;
    (broken["roster"] as Record<string, unknown>)["offseasonMax"] = "ninety";
    delete broken["startDate"];
    expect(() => loadRules(broken)).toThrow(/roster\.offseasonMax/);
    expect(() => loadRules(broken)).toThrow(/startDate/);
  });

  it("rejects a team listed twice", () => {
    const broken = JSON.parse(JSON.stringify(rules2026)) as typeof rules2026;
    broken.structure.conferences[1]!.divisions[0]!.teams[0] = "BUF";
    expect(() => loadRules(broken)).toThrow(/BUF appears twice/);
  });
});
