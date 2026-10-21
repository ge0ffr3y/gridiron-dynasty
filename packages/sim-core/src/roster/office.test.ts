/**
 * League-office roster moves (Phase 8b): allowed moves happen and are recorded
 * with a reason; a move that isn't allowed is refused with the reason and
 * changes nothing; jersey numbers stay unique.
 */
import { describe, expect, it } from "vitest";
import { createLeague } from "../generate/league";
import { parseLeague, serializeLeague } from "../serialize";
import { advanceUntil } from "../season/flow";
import { onTeam } from "./lists";
import { makeRosterMove, rosterManagementView } from "./office";

const VIEWER = { kind: "league" } as const;
const WEEK_ONE = (() => {
  const l = createLeague({ seed: 6, name: "Office" });
  advanceUntil(l, (x) => x.calendar.stage === "regular");
  return serializeLeague(l);
})();

describe("league-office roster moves", () => {
  it("a full roster can't sign anyone: refused with the reason, and nothing changes", () => {
    const league = parseLeague(WEEK_ONE);
    const view = rosterManagementView(league, "BUF", VIEWER);
    expect(view.counts.roster).toBe(53);
    const fa = view.freeAgents[0]!;
    const sign = fa.moves.find((m) => m.kind === "sign")!;
    expect(sign.available).toBe(false);
    expect(sign.note).toMatch(/No roster spot/);
    const before = serializeLeague(league);
    expect(() => makeRosterMove(league, "BUF", fa.id, "sign")).toThrow(/No roster spot/);
    expect(serializeLeague(league)).toBe(before);
  });

  it("waive one, sign another: both recorded with a reason, numbers stay unique", () => {
    const league = parseLeague(WEEK_ONE);
    const victim = onTeam(league, "BUF", "active").at(-1)!;
    makeRosterMove(league, "BUF", victim.id, "waive");
    expect(victim.teamId).not.toBe("BUF");
    const fa = rosterManagementView(league, "BUF", VIEWER).freeAgents.find((r) =>
      r.moves.some((m) => m.kind === "sign" && m.available),
    )!;
    makeRosterMove(league, "BUF", fa.id, "sign");
    expect(onTeam(league, "BUF", "active").length).toBe(53);
    expect(league.transactions.at(-1)!.reason).toMatch(/League office/);
    const numbers = onTeam(league, "BUF").map((p) => p.jersey);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it("elevates a practice-squad player for this week only", () => {
    const league = parseLeague(WEEK_ONE);
    const ps = rosterManagementView(league, "BUF", VIEWER).practiceSquad.find((r) =>
      r.moves.some((m) => m.kind === "elevate" && m.available),
    )!;
    makeRosterMove(league, "BUF", ps.id, "elevate");
    expect(league.teams.find((t) => t.id === "BUF")!.elevated).toContain(ps.id);
    expect(league.players.find((p) => p.id === ps.id)!.elevations).toBe(1);
  });
});
