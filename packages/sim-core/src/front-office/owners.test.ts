/**
 * Owners and Simulation Mode (Phase 13b): owners fire and hire GMs with reasons, a new GM may
 * bring his own head coach, GMs build careers, and the Simulation Mode views (power rankings, the
 * league overview, GM and owner pages) and the balance report work.
 */
import { describe, expect, it } from "vitest";
import { createLeague } from "../generate/league";
import type { League } from "../league/schema";
import { parseLeague, serializeLeague } from "../serialize";
import { advanceUntil } from "../season/flow";
import { byArchetype, parity, teamSeasonFacts, type TeamSeasonFacts } from "./balanceReport";
import { gmOf, ownerOf } from "./executives";
import { executivesSeasonEnd, gmFiringOdds, hireGm, ownerReviews } from "./owners";
import { executiveView, leagueOverview, powerRankingsView } from "./views";

// A league at the end of its first regular season (Black Monday comes next).
const SEASON_END = (() => {
  const l = createLeague({ seed: 31, name: "Owners" });
  advanceUntil(l, (x) => x.calendar.stage === "wildcard");
  return serializeLeague(l);
})();
const seasonEnd = (): League => parseLeague(SEASON_END);

describe("owners", () => {
  it("an impatient owner with a long-losing GM almost surely fires him; a new GM in the playoffs is safe", () => {
    const l = seasonEnd();
    const worst = [...l.teams]
      .map((t) => ({
        id: t.id,
        w: l.games.filter(
          (g) =>
            g.result &&
            ((g.homeId === t.id && g.result.homeScore > g.result.awayScore) ||
              (g.awayId === t.id && g.result.awayScore > g.result.homeScore)),
        ).length,
      }))
      .sort((a, b) => a.w - b.w)[0]!.id;
    ownerOf(l, worst)!.owner = { patience: -1, budget: 0, meddling: 0, ambition: 1 };
    const gm = gmOf(l, worst)!;
    gm.hiredSeason = l.season - 6;
    gm.contractThrough = l.season;
    for (const h of l.history)
      for (const s of h.standings)
        if (s.teamId === worst) {
          s.seed = null;
          s.wins = 3;
          s.losses = 14;
        }
    // A long run of history: four more losing, playoff-less seasons on record.
    for (let i = 0; i < 4; i++) l.history.unshift(JSON.parse(JSON.stringify(l.history[0]!)));
    const bad = gmFiringOdds(l, worst, new Set());
    expect(bad.chance).toBeGreaterThan(0.8);
    expect(bad.reason).toMatch(/without the playoffs/);
    expect(bad.reason).toMatch(/The owner: .*impatient/i);

    const good = l.teams.find((t) => t.id !== worst)!.id;
    gmOf(l, good)!.hiredSeason = l.season;
    ownerOf(l, good)!.owner = { patience: 1, budget: 0, meddling: 0, ambition: -1 };
    expect(gmFiringOdds(l, good, new Set([good])).chance).toBeLessThan(0.02);

    // Black Monday acts on the odds, and every move has a reason.
    ownerReviews(l, new Set());
    expect(l.executiveMoves.every((m) => m.reason.length > 0)).toBe(true);
    expect(l.teams.every((t) => gmOf(l, t.id))).toBe(true);
  });

  it("a hired GM gets a contract and an id; season's end adds career lines and reputations", () => {
    const l = seasonEnd();
    const team = l.teams[0]!.id;
    const old = gmOf(l, team)!;
    old.teamId = null;
    const fresh = hireGm(l, team, "Test.", false);
    expect(fresh.teamId).toBe(team);
    expect(fresh.id).toBeGreaterThanOrEqual(0);
    expect(fresh.contractThrough).toBeGreaterThanOrEqual(fresh.hiredSeason);
    const before = fresh.career.length;
    executivesSeasonEnd(l, new Set([team]), team);
    expect(fresh.career.length).toBe(before + 1);
    expect(fresh.career.at(-1)!.playoffs).toBe(true);
    expect(ownerOf(l, team)!.career.length).toBeGreaterThan(0);
  });

  it("over a season and its Black Monday, GM changes stay rare and every move has a reason", () => {
    const l = seasonEnd();
    ownerReviews(l, new Set());
    const hires = l.executiveMoves.filter((m) => m.kind === "hired");
    expect(hires.length).toBeLessThanOrEqual(10);
    expect(l.teams.every((t) => gmOf(l, t.id))).toBe(true);
  });
});

describe("Simulation Mode views", () => {
  it("power rankings rank every team once, with reasons", () => {
    const l = seasonEnd();
    const rows = powerRankingsView(l);
    expect(rows.length).toBe(l.teams.length);
    expect(new Set(rows.map((r) => r.teamId)).size).toBe(l.teams.length);
    expect(rows[0]!.rank).toBe(1);
    expect(rows.every((r) => r.reason.length > 5)).toBe(true);
  });

  it("the overview lists champions and every GM; a GM's page shows his philosophy", () => {
    const l = seasonEnd();
    const o = leagueOverview(l);
    expect(o.gms.length).toBe(l.teams.length);
    expect(o.champions.length).toBe(l.history.length);
    const gm = gmOf(l, l.teams[2]!.id)!;
    const page = executiveView(l, gm.id);
    expect(page.knobs.length).toBe(6);
    expect(page.type).toBeTruthy();
    const owner = executiveView(l, ownerOf(l, l.teams[2]!.id)!.id);
    expect(owner.role).toBe("Owner");
  });
});

describe("the balance report", () => {
  it("measures parity the way the real numbers were measured", () => {
    // Two teams that never change: perfect carryover, the same playoff team every year.
    const facts: TeamSeasonFacts[] = [];
    for (let s = 2026; s < 2040; s++)
      for (const [teamId, winShare] of [
        ["A", 0.8],
        ["B", 0.2],
      ] as const)
        facts.push({
          season: s,
          teamId,
          archetype: "analytics",
          winShare,
          playoffs: teamId === "A",
          title: teamId === "A",
          deadShare: 0,
          age: 26,
          faSpend: 0,
          trades: 0,
          restructures: 0,
        });
    const p = parity(facts);
    expect(p.winShareCorrelation).toBeCloseTo(1, 5);
    expect(p.playoffRepeatRate).toBe(1);
    expect(p.championsPerDecade).toBe(1);
    expect(p.longestPlayoffRun).toBe(14);
    expect(byArchetype(facts)[0]!.teamSeasons).toBe(28);
  });

  it("records a season's facts for every team", () => {
    const l = seasonEnd();
    const facts = teamSeasonFacts(l);
    expect(facts.length).toBe(l.teams.length);
    expect(facts.every((f) => f.age > 20 && f.age < 35)).toBe(true);
  });
});
