import { describe, expect, it } from "vitest";
import { createLeague } from "../generate/league";
import { serializeLeague } from "../serialize";
import { exhibitionRig } from "./exhibition";

describe("exhibition games", () => {
  const league = createLeague({ seed: 31, name: "Exhibition" });
  const [a, b] = league.teams.map((t) => t.id) as [string, string];

  it("are repeatable from a seed and change nothing in the league", () => {
    const before = serializeLeague(league);
    const rig = exhibitionRig(league);
    const one = rig.play(a, b, 5);
    const two = exhibitionRig(league).play(a, b, 5);
    expect([one.homeScore, one.awayScore]).toEqual([two.homeScore, two.awayScore]);
    expect(serializeLeague(league)).toBe(before);
  });

  it("differ by seed, and a playoff game can't end tied", () => {
    const rig = exhibitionRig(league);
    const scores = new Set(
      [1, 2, 3, 4, 5, 6].map((s) => {
        const g = rig.play(a, b, s);
        return `${g.homeScore}-${g.awayScore}`;
      }),
    );
    expect(scores.size).toBeGreaterThan(1);
    for (let s = 1; s <= 20; s++) {
      const g = rig.play(a, b, s, true);
      expect(g.homeScore).not.toBe(g.awayScore);
    }
  });

  it("refuse an unknown team", () => {
    expect(() => exhibitionRig(league).play(a, "ZZZ", 1)).toThrow(/no such team/);
  });
});
