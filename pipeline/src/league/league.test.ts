/**
 * The real-league import's building blocks (Phase 6). These need no private
 * data, so they run everywhere; tests/realLeague.test.ts checks the real build.
 */
import { ATTRIBUTE_KEYS, baseProfile, FIRST_NAMES, LAST_NAMES, overallAt } from "@fgm/sim-core";
import { describe, expect, it } from "vitest";
import { injuryTraits, rescaleTraits } from "./careers";
import { MADDEN_MAP, matchMadden, normName, parseMadden, rawAttributes } from "./madden";
import { fictionalCollege, Renamer } from "./names";
import { shiftOverall } from "./performance";
import { mapPosition, type RealPerson } from "./roster";

function person(over: Partial<RealPerson>): RealPerson {
  return {
    gsis: "00-1",
    pfr: "",
    realFirst: "Alex",
    realLast: "Example",
    otherFirst: [],
    rawPosition: "WR",
    position: "WR",
    teamId: "BUF",
    status: "ACT",
    jersey: 1,
    birthDate: "2000-01-01",
    heightIn: 72,
    weightLb: 200,
    yearsBefore: 2,
    college: "",
    draft: null,
    snapShare: { offense: 0.8, defense: 0, special: 0 },
    games: 17,
    ...over,
  };
}

describe("positions", () => {
  it("maps real position labels to ours", () => {
    expect(mapPosition("T", 310)).toBe("OT");
    expect(mapPosition("FS", 200)).toBe("S");
    expect(mapPosition("NT", 330)).toBe("DT");
    expect(mapPosition("DE", 265)).toBe("EDGE");
    expect(mapPosition("DE", 305)).toBe("DT"); // a 3-4 end plays inside
  });

  it("splits outside linebackers into edge rushers and off-ball linebackers", () => {
    expect(mapPosition("OLB", 240, "Run Stopper - DE")).toBe("EDGE");
    expect(mapPosition("OLB", 240, "Speed Rusher - OLB")).toBe("EDGE");
    expect(mapPosition("OLB", 250, "Pass Coverage - OLB")).toBe("LB");
    expect(mapPosition("OLB", 255)).toBe("EDGE");
    expect(mapPosition("OLB", 230)).toBe("LB");
  });
});

describe("the Madden file", () => {
  it("reads exports with odd headers and spreadsheet-mangled dates", () => {
    const [p] = parseMadden([
      {
        "﻿Something": "Jordan",
        lastName: "Example",
        Team: "Anywhere",
        Position: "WR",
        birthdate: "2012-07-01", // "7/12/01" read by a spreadsheet as a date
        overallRating: "88",
        "stats/speed/value": "95",
      },
    ]);
    expect(p).toMatchObject({
      first: "Jordan",
      last: "Example",
      overall: 88,
      birthDate: "2001-07-12",
    });
    expect(p!.values.speed).toBe(95);
    expect(
      parseMadden([{ firstName: "A", lastName: "B", birthdate: "6/7/96" }])[0]!.birthDate,
    ).toBe("1996-06-07");
  });

  it("normalizes names for matching", () => {
    expect(normName("A.B. Example Jr.")).toBe("ab example");
    expect(normName("José  Núñez III")).toBe("jose nunez");
  });

  it("matches by last name and birth date, then by nickname, and honors overrides", () => {
    const people = [
      person({
        gsis: "A",
        realFirst: "Coleridge",
        realLast: "Quarterback",
        otherFirst: ["C.J."],
        birthDate: "2001-10-03",
      }),
      person({ gsis: "B", realFirst: "Sam", realLast: "Twin", birthDate: "1999-01-01" }),
      person({ gsis: "C", realFirst: "Max", realLast: "Twin", birthDate: "1999-01-01" }),
    ];
    const madden = parseMadden([
      { firstName: "C.J.", lastName: "Quarterback", birthdate: "" },
      { firstName: "Sam", lastName: "Twin", birthdate: "1/1/99" },
      { firstName: "Nobody", lastName: "Else", birthdate: "1/1/90" },
    ]);
    const match = matchMadden(madden, people, new Map([[4, "C"]]));
    expect(match.byGsis.get("A")?.first).toBe("C.J.");
    // Same last name and birthday: the full name settles it.
    expect(match.byGsis.get("B")?.first).toBe("Sam");
    // Row 4 (the third data row) is forced onto player C.
    expect(match.byGsis.get("C")?.first).toBe("Nobody");
  });

  it("every one of our attributes comes from Madden's, and pass rush leans on the better move", () => {
    expect(Object.keys(MADDEN_MAP).sort()).toEqual([...ATTRIBUTE_KEYS].sort());
    const [m] = parseMadden([
      {
        firstName: "A",
        lastName: "B",
        "stats/powerMoves/value": "60",
        "stats/finesseMoves/value": "90",
      },
    ]);
    const raw = rawAttributes(m!);
    expect(raw.passRush).toBeGreaterThan(75); // more than the plain average
  });
});

describe("ratings and traits", () => {
  it("moving a player's overall changes his skills, not his speed or strength", () => {
    const r = baseProfile("WR");
    const up = shiftOverall(r, "WR", 6);
    expect(Math.abs(overallAt(up, "WR") - overallAt(r, "WR") - 6)).toBeLessThanOrEqual(1);
    expect(up.speed).toBe(r.speed);
    expect(up.catching).toBeGreaterThan(r.catching);
  });

  it("injury history raises injury proneness and lowers durability", () => {
    const healthy = injuryTraits({ missedWeeks: 0, seasons: 3 });
    const hurt = injuryTraits({ missedWeeks: 20, seasons: 3 });
    expect(hurt.injuryProneness).toBeGreaterThan(healthy.injuryProneness);
    expect(hurt.durability).toBeLessThan(healthy.durability);
  });

  it("puts traits on the generated players' scale, keeping the order", () => {
    const traits = new Map(
      [10, 20, 30, 40, 50].map((v, i) => [String(i), { injuryProneness: v, durability: 100 - v }]),
    );
    rescaleTraits(traits, { injuryProneness: [45, 15], durability: [55, 15] });
    const values = [...traits.values()].map((t) => t.injuryProneness);
    expect(values.reduce((a, b) => a + b, 0) / values.length).toBeCloseTo(45, 0);
    expect([...values].sort((a, b) => a - b)).toEqual(values);
  });
});

describe("names", () => {
  it("never hands out a real person's name, and gives the same name every time", () => {
    // Every combination is "real" except those with the first last name on our list.
    const real = FIRST_NAMES.flatMap((first) =>
      LAST_NAMES.slice(1).map((last) => ({ first_name: first, last_name: last })),
    );
    const renamer = new Renamer(real, []);
    const name = renamer.name("00-0012345");
    expect(name.lastName).toBe(LAST_NAMES[0]);
    expect(renamer.clashes).toBeGreaterThan(0);
    expect(new Renamer(real, []).name("00-0012345")).toEqual(name);
  });

  it("gives everyone from the same real school the same fictional one", () => {
    expect(fictionalCollege("Some State")).toBe(fictionalCollege("some state"));
  });
});
