/**
 * The player lifecycle (Phase 9a): real age curves by position, growth toward
 * potential, decline (physical traits first), retirement odds, close position
 * battles settled in camp, and the rating history kept each season.
 */
import { ageOn, overallAt, Rng, type Position } from "@fgm/foundation";
import { describe, expect, it } from "vitest";
import { createLeague } from "../generate/league";
import type { League, Player } from "../league/schema";
import { parseLeague, serializeLeague } from "../serialize";
import { autoDepthChart, campWinners } from "../season/depthChart";
import { DEVELOPMENT } from "./config";
import { ageCurve, growthShare, peakAge, retirementAges } from "./curves";
import { developPlayer, expectedChange, offseasonDevelopment } from "./development";
import { retirementChance } from "./retirement";

const BASE = createLeague({ seed: 9, name: "Lifecycle" });
const TEXT = serializeLeague(BASE);
const copy = (): League => parseLeague(TEXT);
// (sim-core has no browser or Node types, so no structuredClone: a JSON copy is enough here.)
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** A copy of a player, aged to `age` on the league's date. */
function aged(league: League, p: Player, age: number): Player {
  const c = clone(p);
  const year = Number(league.date.slice(0, 4)) - age;
  c.birthDate = `${year}${league.date.slice(4)}`;
  return c;
}

function someone(league: League, position: Position): Player {
  return league.players.find((p) => p.position === position && p.teamId !== null)!;
}

describe("age curves (real players, calibration/lifecycle.json)", () => {
  it("running backs peak and decline earlier than quarterbacks", () => {
    expect(peakAge("RB")).toBeLessThan(peakAge("QB"));
    for (const age of [28, 29, 30]) expect(ageCurve("RB", age)).toBeLessThan(ageCurve("QB", age));
    expect(ageCurve("RB", 22)).toBeGreaterThan(0);
    expect(ageCurve("CB", 31)).toBeLessThan(ageCurve("CB", 27));
  });

  it("growth shares run out at the peak; past the measured ages decline keeps steepening", () => {
    for (const position of ["RB", "WR", "OT", "CB", "QB"] as Position[]) {
      expect(growthShare(position, peakAge(position) + 1)).toBe(0);
      expect(growthShare(position, 22)).toBeGreaterThan(0);
      expect(growthShare(position, 22)).toBeLessThanOrEqual(1);
    }
    expect(ageCurve("CB", 34)).toBeLessThan(ageCurve("CB", 32));
  });

  it("real retirement ages are later for quarterbacks and kickers than for running backs", () => {
    expect(retirementAges("QB")[4]).toBeGreaterThan(retirementAges("RB")[4]!);
    expect(retirementAges("K")[4]).toBeGreaterThan(retirementAges("RB")[4]!);
  });
});

describe("development", () => {
  it("a young player with room grows toward his potential, more with work ethic and snaps", () => {
    const league = copy();
    const p = aged(league, someone(league, "WR"), 22);
    p.hidden.potential = Math.min(99, overallAt(p.ratings, p.position) + 12);
    p.hidden.workEthic = 50;
    const ctx = { age: 22, playingTime: 0.5, portion: 1 };
    const base = expectedChange(p, ctx);
    expect(base).toBeGreaterThan(0);
    expect(base).toBeLessThanOrEqual(12);
    expect(expectedChange({ ...p, hidden: { ...p.hidden, workEthic: 90 } }, ctx)).toBeGreaterThan(
      base,
    );
    expect(expectedChange(p, { ...ctx, playingTime: 1 })).toBeGreaterThan(base);
    // At his potential there's nothing left to grow into.
    const capped = clone(p);
    capped.hidden.potential = overallAt(p.ratings, p.position);
    expect(expectedChange(capped, ctx)).toBe(0);
    // Over many draws the average gain matches the expectation (luck averages out).
    let total = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const c = clone(p);
      const r = developPlayer(c, ctx, new Rng(seed));
      total += r.after - r.before;
    }
    expect(total / 300).toBeGreaterThan(base - 1);
    expect(total / 300).toBeLessThan(base + 1);
  });

  it("veterans decline, losing speed first after 30, and potential fades toward what he is", () => {
    const league = copy();
    const p = aged(league, someone(league, "CB"), 32);
    const ctx = { age: 32, playingTime: 1, portion: 1 };
    expect(expectedChange(p, ctx)).toBeLessThan(-2);
    let speed = 0;
    let skills = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const c = clone(p);
      const r = developPlayer(c, ctx, new Rng(seed));
      speed += c.ratings.speed - p.ratings.speed;
      skills += c.ratings.manCoverage - p.ratings.manCoverage;
      expect(c.hidden.potential).toBeGreaterThanOrEqual(r.after);
      expect(c.hidden.potential).toBeLessThanOrEqual(Math.max(p.hidden.potential, r.after));
    }
    expect(speed / 200).toBeLessThan(skills / 200);
    expect(speed / 200).toBeLessThan(-1);
  });

  it("each notable change has a reason, and the same seed gives the same league", () => {
    const a = copy();
    const b = copy();
    a.date = b.date = `${a.season}-03-11`;
    const changes = offseasonDevelopment(a);
    offseasonDevelopment(b);
    expect(serializeLeague(a)).toBe(serializeLeague(b));
    expect(changes.length).toBeGreaterThan(50);
    for (const c of changes) {
      expect(Math.abs(c.after - c.before)).toBeGreaterThanOrEqual(DEVELOPMENT.notableChange);
      expect(c.reason).toMatch(/^Age \d+ /);
    }
    // Biggest first.
    const sizes = changes.map((c) => Math.abs(c.after - c.before));
    expect([...sizes].sort((x, y) => y - x)).toEqual(sizes);
  });
});

describe("retirement", () => {
  it("odds rise with age and are tiny for a young starter", () => {
    const league = copy();
    const p = someone(league, "CB");
    const at = (age: number) => retirementChance(league, aged(league, p, age), league.season - 1);
    expect(at(24).chance).toBeLessThan(0.02);
    expect(at(30).chance).toBeGreaterThan(at(27).chance);
    expect(at(35).chance).toBeGreaterThan(0.8);
    expect(at(45).chance).toBe(1);
    expect(at(35).reasons.join(" ")).toMatch(/late in a career/);
  });

  it("a quarterback lasts longer than a running back of the same age", () => {
    const league = copy();
    const qb = aged(league, someone(league, "QB"), 33);
    const rb = aged(league, someone(league, "RB"), 33);
    expect(retirementChance(league, qb, league.season - 1).chance).toBeLessThan(
      retirementChance(league, rb, league.season - 1).chance,
    );
  });

  it("a free agent nobody played all season retires", () => {
    const league = copy();
    const p = aged(league, someone(league, "LB"), 29);
    p.teamId = null;
    p.contract = null;
    p.stats = p.stats.filter((s) => s.season < league.season - 1);
    const call = retirementChance(league, p, league.season - 1);
    expect(call.chance).toBe(1);
    expect(call.reasons[0]).toMatch(/no team played him/);
  });
});

describe("close position battles", () => {
  function battle(gap: number, winnerGrade: number, loserGrade: number) {
    const league = copy();
    const team = league.teams[0]!;
    const roster = league.players.filter((p) => p.teamId === team.id && p.roster === "active");
    const qbs = roster
      .filter((p) => p.position === "QB")
      .sort((a, b) => overallAt(b.ratings, "QB") - overallAt(a.ratings, "QB"));
    const [starter, backup] = qbs as [Player, Player];
    // Make the backup exactly `gap` points worse.
    backup.ratings = clone(starter.ratings);
    for (
      let i = 0;
      i < 40 && overallAt(backup.ratings, "QB") > overallAt(starter.ratings, "QB") - gap;
      i++
    )
      for (const k of ["throwAccuracyShort", "throwAccuracyDeep", "decisionMaking"] as const)
        if (overallAt(backup.ratings, "QB") > overallAt(starter.ratings, "QB") - gap)
          backup.ratings[k] -= 1;
    expect(overallAt(starter.ratings, "QB") - overallAt(backup.ratings, "QB")).toBe(gap);
    for (const p of roster) p.preseason = { season: league.season, line: {}, grade: 50 };
    starter.preseason!.grade = loserGrade;
    backup.preseason!.grade = winnerGrade;
    return { league, roster, starter, backup };
  }

  it("a strong camp wins a job from a player a point better, with the reason on the chart", () => {
    const { league, roster, backup } = battle(1, 90, 20);
    expect(autoDepthChart(roster, league.season).QB[0]).toBe(backup.id);
    expect(campWinners(roster, league.season).get("QB")?.has(backup.id)).toBe(true);
    // Last year's grades don't count.
    expect(autoDepthChart(roster, league.season + 1).QB[0]).not.toBe(backup.id);
  });

  it("a clearly better player always starts", () => {
    const { league, roster, starter } = battle(3, 100, 0);
    expect(autoDepthChart(roster, league.season).QB[0]).toBe(starter.id);
  });
});

describe("rating history", () => {
  it("everyone on a team gets a line for each season played", () => {
    const league = copy();
    const last = league.season - 1;
    const onTeams = league.players.filter((p) => p.teamId !== null);
    expect(onTeams.length).toBeGreaterThan(1500);
    for (const p of onTeams.slice(0, 200)) {
      const h = p.ratingHistory.find((x) => x.season === last);
      expect(h, `${p.id}`).toBeDefined();
      expect(h!.overall).toBe(overallAt(p.ratings, p.position));
      const now = ageOn(p.birthDate, league.date);
      expect([now - 1, now]).toContain(h!.age);
      expect(h!.teamId).toBe(p.teamId);
    }
  });
});
