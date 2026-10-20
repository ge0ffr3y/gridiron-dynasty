/**
 * One hand-built scenario per tiebreaker step. Each is designed so that only
 * the step under test can decide it (the NFL publishes no worked examples).
 */
import { describe, expect, it } from "vitest";
import { computeStandings } from "./seeding";
import { pctOf, SeasonTable } from "./standings";
import { RULES, Results, rulesTeams } from "./testHelpers";
import { Tiebreaker } from "./tiebreakers";

const teams = rulesTeams();

function breaker(results: Results, ranks: Record<string, number> = {}, salt = "test") {
  const table = new SeasonTable(teams, results.games);
  return { table, tb: new Tiebreaker(table, salt, new Map(Object.entries(ranks))) };
}

function expectTied(table: SeasonTable, ids: string[]) {
  const pcts = ids.map((id) => pctOf(table.record(id)));
  expect(new Set(pcts).size).toBe(1);
}

describe("division tiebreakers (two clubs)", () => {
  it("1. head-to-head", () => {
    const r = new Results()
      .win("BUF", "MIA")
      .win("BUF", "MIA")
      .win("MIA", "CHI")
      .win("MIA", "DET")
      .win("GB", "BUF")
      .win("MIN", "BUF");
    const { table, tb } = breaker(r);
    expectTied(table, ["BUF", "MIA"]);
    expect(tb.best(["BUF", "MIA"], "division")).toEqual({ winner: "BUF", reason: "head-to-head" });
  });

  it("2. division record", () => {
    // Split head-to-head; BUF beat NE, MIA lost to NE.
    const r = new Results()
      .win("BUF", "MIA")
      .win("MIA", "BUF")
      .win("BUF", "NE")
      .win("CHI", "BUF")
      .win("NE", "MIA")
      .win("MIA", "DET");
    const { table, tb } = breaker(r);
    expectTied(table, ["BUF", "MIA"]);
    expect(tb.best(["BUF", "MIA"], "division")).toEqual({
      winner: "BUF",
      reason: "division record",
    });
  });

  it("3. common games", () => {
    // Both played KC and DEN: BUF 2-0, MIA 1-1. Other results balance the overall record.
    const r = new Results()
      .win("BUF", "MIA")
      .win("MIA", "BUF")
      .win("BUF", "KC")
      .win("BUF", "DEN")
      .win("SEA", "BUF")
      .win("MIA", "KC")
      .win("DEN", "MIA")
      .win("MIA", "GB");
    const { table, tb } = breaker(r);
    expectTied(table, ["BUF", "MIA"]);
    expect(tb.best(["BUF", "MIA"], "division")).toEqual({
      winner: "BUF",
      reason: "record in common games",
    });
  });

  it("4. conference record (no common opponents, so that step is skipped)", () => {
    const r = new Results()
      .win("BUF", "MIA")
      .win("MIA", "BUF")
      .win("BUF", "KC")
      .win("CHI", "BUF")
      .win("MIA", "GB")
      .win("DEN", "MIA");
    const { table, tb } = breaker(r);
    expectTied(table, ["BUF", "MIA"]);
    expect(tb.best(["BUF", "MIA"], "division")).toEqual({
      winner: "BUF",
      reason: "conference record",
    });
  });

  it("coin toss when everything is equal, and it never changes", () => {
    const { tb } = breaker(new Results());
    const first = tb.best(["NE", "NYA"], "division");
    expect(first.reason).toBe("a coin toss");
    for (let i = 0; i < 5; i++)
      expect(tb.best(["NYA", "NE"], "division").winner).toBe(first.winner);
    // A different league or season tosses its own coins.
    const winners = new Set(
      ["a", "b", "c", "d", "e", "f", "g", "h"].map(
        (salt) => breaker(new Results(), {}, salt).tb.best(["NE", "NYA"], "division").winner,
      ),
    );
    expect(winners.size).toBe(2);
  });
});

describe("division tiebreakers (three clubs)", () => {
  it("head-to-head among the three, then the two left start over", () => {
    // BUF beat both; MIA beat NE. Extra games tie the overall records at 2-2.
    const r = new Results()
      .win("BUF", "MIA")
      .win("BUF", "NE")
      .win("MIA", "NE")
      .win("GB", "BUF")
      .win("MIN", "BUF")
      .win("MIA", "CHI")
      .win("DET", "MIA")
      .win("NE", "SEA")
      .win("NE", "SF");
    const s = computeStandings(RULES, teams, r.games, "test");
    expectTied(s.table, ["BUF", "MIA", "NE"]);
    expect(s.divisionOrder.get("A-EAST")!.slice(0, 3)).toEqual(["BUF", "MIA", "NE"]);
    expect(s.notes).toContain(
      "BUF ahead of MIA, NE for the Conference A East order (head-to-head)",
    );
    expect(s.notes).toContain("MIA ahead of NE for the Conference A East order (head-to-head)");
  });

  it("when a step drops one club, the other two restart at step 1 (head-to-head)", () => {
    // A cycle: BUF beat MIA, MIA beat NE, NE beat BUF (head-to-head all even).
    // Division record drops NE; BUF and MIA then restart, and BUF wins on head-to-head.
    const r = new Results()
      .win("BUF", "MIA")
      .win("MIA", "NE")
      .win("NE", "BUF")
      .win("BUF", "NYA")
      .win("MIA", "NYA")
      .win("NYA", "NE")
      .win("GB", "BUF")
      .win("DET", "MIA")
      .win("NE", "CHI");
    const { table, tb } = breaker(r);
    expectTied(table, ["BUF", "MIA", "NE"]);
    expect(tb.best(["BUF", "MIA", "NE"], "division")).toEqual({
      winner: "BUF",
      reason: "head-to-head",
    });
  });
});

describe("wild-card tiebreakers", () => {
  it("two clubs: strength of victory", () => {
    // BUF beat KC (2-1 by the end); BAL beat DEN (0-2). Same conference record, no common games.
    const r = new Results()
      .win("BUF", "KC")
      .win("BAL", "DEN")
      .win("KC", "LV")
      .win("KC", "LAA")
      .win("LV", "DEN");
    const { tb } = breaker(r);
    expect(tb.best(["BUF", "BAL"], "wildcard")).toEqual({
      winner: "BUF",
      reason: "strength of victory",
    });
  });

  it("two clubs: strength of schedule", () => {
    // Equal strength of victory (KC and DEN both 1-1); BUF's loss came to the stronger LV.
    const r = new Results()
      .win("BUF", "KC")
      .win("KC", "LV")
      .win("LV", "BUF")
      .win("LV", "NYA")
      .win("BAL", "DEN")
      .win("DEN", "LAA")
      .win("LAA", "BAL");
    const { tb } = breaker(r);
    expect(tb.best(["BUF", "BAL"], "wildcard")).toEqual({
      winner: "BUF",
      reason: "strength of schedule",
    });
  });

  it("two clubs: combined points ranking in the conference", () => {
    const r = new Results().win("BUF", "KC", [30, 10]).win("BAL", "DEN", [20, 10]);
    const { tb } = breaker(r);
    expect(tb.best(["BUF", "BAL"], "wildcard")).toEqual({
      winner: "BUF",
      reason: "points ranking in the conference",
    });
  });

  it("two clubs: common games need at least four, so three are skipped", () => {
    // BUF is 2-1 against the three common opponents (KC, DEN, LV), BAL 1-2, but that step needs four games.
    // Strength of victory decides instead, for BAL.
    const r = new Results()
      .win("BUF", "KC")
      .win("BUF", "DEN")
      .win("LV", "BUF")
      .win("NE", "BUF")
      .win("BAL", "KC")
      .win("DEN", "BAL")
      .win("LV", "BAL")
      .win("BAL", "HOU")
      .win("HOU", "JAX")
      .win("HOU", "TEN");
    const { table, tb } = breaker(r);
    expectTied(table, ["BUF", "BAL"]);
    expect(tb.best(["BUF", "BAL"], "wildcard")).toEqual({
      winner: "BAL",
      reason: "strength of victory",
    });
  });

  it("three clubs: only the best-placed club of each division stays in", () => {
    // MIA beat BAL, but MIA finished behind BUF in their division, so MIA can't take this spot.
    const r = new Results().win("BUF", "MIA").win("CHI", "BUF").win("MIA", "BAL").win("BAL", "GB");
    const { table, tb } = breaker(r, { BUF: 1, MIA: 2, BAL: 1 });
    expectTied(table, ["BUF", "MIA", "BAL"]);
    expect(tb.best(["BUF", "MIA", "BAL"], "wildcard")).toEqual({
      winner: "BUF",
      reason: "conference record",
    });
  });

  it("three clubs: a head-to-head sweep advances the sweeper", () => {
    const r = new Results()
      .win("BUF", "BAL")
      .win("BUF", "HOU")
      .win("CHI", "BUF")
      .win("GB", "BUF")
      .win("BAL", "DET")
      .win("BAL", "MIN")
      .win("SEA", "BAL")
      .win("HOU", "ARI")
      .win("HOU", "SF")
      .win("LAB", "HOU");
    const { table, tb } = breaker(r, { BUF: 1, BAL: 1, HOU: 1 });
    expectTied(table, ["BUF", "BAL", "HOU"]);
    expect(tb.best(["BUF", "BAL", "HOU"], "wildcard")).toEqual({
      winner: "BUF",
      reason: "head-to-head sweep",
    });
  });

  it("three clubs: a club swept by the others drops out, even with the best conference record", () => {
    const r = new Results()
      .win("BUF", "HOU")
      .win("BUF", "DET")
      .win("DEN", "BUF")
      .win("BAL", "HOU")
      .win("BAL", "SEA")
      .win("KC", "BAL")
      .win("HOU", "LV")
      .win("HOU", "LAA")
      .win("HOU", "KC")
      .win("HOU", "DEN")
      .win("HOU", "JAX")
      .win("HOU", "IND")
      .win("CHI", "HOU");
    const { table, tb } = breaker(r, { BUF: 1, BAL: 1, HOU: 1 });
    expectTied(table, ["BUF", "BAL", "HOU"]);
    // Without the sweep rule HOU would win on conference record (6-2 against 1-1).
    expect(tb.best(["BUF", "BAL", "HOU"], "wildcard").winner).not.toBe("HOU");
  });
});
