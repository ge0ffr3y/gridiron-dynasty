/**
 * The contract and cap screens (Phase 7b): what the "what if" panel previews is
 * exactly what the move then does, a restructure frees room now and raises
 * next year's bill, and a cut shows the right dead money before and after June 1.
 */
import { describe, expect, it } from "vitest";
import { createLeague } from "../generate/league";
import type { League } from "../league/schema";
import { parseLeague, serializeLeague } from "../serialize";
import { remainingGuarantees, remainingProration } from "./contract";
import { capSheet, playersOn } from "./team";
import { capSheetView, contractView, makeCapMove } from "./views";

const BASE = createLeague({ seed: 7, name: "Cap screens" });
const fresh = (): League => parseLeague(serializeLeague(BASE));
const VIEWER = { kind: "league" } as const;

/** The team's biggest contract that a restructure can convert (salary above the minimum, years left). */
function restructurable(league: League) {
  for (const team of league.teams)
    for (const p of playersOn(league, team.id).sort((a, b) => b.id - a.id)) {
      const move = contractView(league, p.id).moves.find((m) => m.kind === "restructure");
      if (move?.available && move.roomNow.after > move.roomNow.before) return p;
    }
  throw new Error("no restructurable contract");
}

/** A player with bonus proration left beyond this year (so June 1 matters). */
function withProration(league: League) {
  for (const team of league.teams)
    for (const p of playersOn(league, team.id))
      if (remainingProration(p.contract!, league.season + 1) > 0) return p;
  throw new Error("no contract with proration left");
}

describe("contract and cap screens", () => {
  it("a contract shows every year: cap hits add up, and the current year is marked", () => {
    const league = fresh();
    const p = withProration(league);
    const view = contractView(league, p.id);
    expect(view.rows.length).toBe(p.contract!.years.length);
    expect(view.rows.filter((r) => r.current).length).toBe(1);
    for (const r of view.rows)
      expect(r.capHit).toBe(
        r.base + r.proration + r.rosterBonus + r.workoutBonus + r.perGameBonus + r.likelyIncentives,
      );
  });

  it("a restructure frees room now and raises next year's bill, as previewed", () => {
    const league = fresh();
    const p = restructurable(league);
    const teamId = p.teamId!;
    const move = contractView(league, p.id).moves.find((m) => m.kind === "restructure")!;
    const nowBefore = capSheet(league, teamId, league.season).room;
    const nextBefore = capSheet(league, teamId, league.season + 1).room;
    expect(move.roomNow.before).toBe(nowBefore);
    expect(move.roomNow.after).toBeGreaterThan(nowBefore);
    expect(move.roomNext.after).toBeLessThan(nextBefore);
    makeCapMove(league, p.id, "restructure");
    expect(capSheet(league, teamId, league.season).room).toBe(move.roomNow.after);
    expect(capSheet(league, teamId, league.season + 1).room).toBe(move.roomNext.after);
    expect(league.transactions.at(-1)!.type).toBe("restructured");
    expect(league.transactions.at(-1)!.reason).toMatch(/League office/);
  });

  it("a cut before June 1 accelerates all proration; a June 1 designation splits it", () => {
    const league = fresh();
    const p = withProration(league);
    const c = p.contract!;
    const season = league.season;
    const moves = contractView(league, p.id).moves;
    const early = moves.find((m) => m.kind === "release")!;
    const june = moves.find((m) => m.kind === "release-june-1")!;
    const guarantees = remainingGuarantees(c, season, league.date);
    // Before June 1: everything left counts now.
    expect(early.deadThisYear).toBe(remainingProration(c, season) + guarantees);
    expect(early.deadNextYear).toBe(0);
    // June 1 designation: this year's share now, the rest next year; the total is the same.
    expect(june.deadThisYear).toBe(
      remainingProration(c, season) - remainingProration(c, season + 1) + guarantees,
    );
    expect(june.deadNextYear).toBe(remainingProration(c, season + 1));
    expect(june.deadThisYear + june.deadNextYear).toBe(early.deadThisYear);
    // Making the designated cut does what the preview said.
    const teamId = p.teamId!;
    makeCapMove(league, p.id, "release-june-1");
    expect(capSheet(league, teamId, season).room).toBe(june.roomNow.after);
    expect(capSheet(league, teamId, season + 1).room).toBe(june.roomNext.after);
    expect(league.players.find((x) => x.id === p.id)!.teamId).toBeNull();
  });

  it("previews never change the league", () => {
    const league = fresh();
    const before = serializeLeague(league);
    for (const p of playersOn(league, league.teams[0]!.id)) contractView(league, p.id);
    expect(serializeLeague(league)).toBe(before);
  });

  it("the cap sheet adds up for four League Years, with the top-51 rule now", () => {
    const league = fresh();
    const view = capSheetView(league, league.teams[0]!.id, VIEWER);
    expect(view.years.length).toBe(4);
    expect(view.years[0]!.topContractsRule).toBe(true);
    expect(view.years.slice(1).every((y) => !y.topContractsRule)).toBe(true);
    for (const y of view.years) {
      expect(y.total).toBe(y.contracts + y.deadMoney);
      expect(y.room).toBe(y.adjustedCap - y.total);
    }
    expect(view.players.filter((p) => p.inTopContracts).length).toBeLessThanOrEqual(51);
    const counted = view.players.reduce((a, p) => a + p.counted, 0);
    expect(counted).toBe(view.years[0]!.contracts);
  });
});
