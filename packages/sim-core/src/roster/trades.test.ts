/**
 * Trades (Phase 8b), worked examples: the old team keeps the bonus money as
 * dead money, the new team carries the rest of the contract, picks change
 * hands, the preview equals the result, and illegal trades are refused with a
 * reason (closed period, over the cap, over the roster limit, practice squad).
 */
import { describe, expect, it } from "vitest";
import { capHit, remainingProration } from "../contracts/contract";
import { capSheet } from "../contracts/team";
import { createLeague } from "../generate/league";
import type { League } from "../league/schema";
import { parseLeague, serializeLeague } from "../serialize";
import { advanceUntil } from "../season/flow";
import { onTeam } from "./lists";
import { makeTrade, previewTradeDeal, tradablePicks } from "./trades";

const BASE = createLeague({ seed: 5, name: "Trades" });
// After the draft: trading is open (the League Year began in March).
const OPEN = (() => {
  const l = parseLeague(serializeLeague(BASE));
  advanceUntil(l, (x) => x.calendar.stage === "after-draft");
  return serializeLeague(l);
})();
const copy = (): League => parseLeague(OPEN);

/** A player with bonus money left to spread (so the trade leaves dead money). */
function withBonus(league: League, teamId: string) {
  return onTeam(league, teamId, "active").find(
    (p) => remainingProration(p.contract!, league.season) > 0,
  )!;
}

describe("trades", () => {
  it("a player for a player and a pick: dead money for the old team, the rest of the deal for the new", () => {
    const league = copy();
    const p = withBonus(league, "BUF");
    const back = onTeam(league, "MIA", "active").find(
      (x) => remainingProration(x.contract!, league.season) === 0,
    )!;
    const pick = tradablePicks(league, "MIA").find((d) => d.season === league.season + 1)!;
    const a = { teamId: "BUF", players: [p.id], picks: [] };
    const b = { teamId: "MIA", players: [back.id], picks: [pick.id] };
    const bonus = remainingProration(p.contract!, league.season);
    // What MIA will carry: his contract without the bonus money.
    const withoutBonus = capHit({ ...p.contract!, bonuses: [] }, league.season, league.rules.cap);
    const preview = previewTradeDeal(league, a, b);
    expect(preview.problems).toEqual([]);
    makeTrade(league, a, b, "Test");
    expect(p.teamId).toBe("MIA");
    expect(back.teamId).toBe("BUF");
    expect(league.draftPicks.find((d) => d.id === pick.id)!.ownerTeamId).toBe("BUF");
    // Before June 1: all his remaining bonus money is BUF's dead money this year.
    expect(preview.teams[0].deadMoney).toBe(bonus);
    expect(p.contract!.bonuses).toEqual([]);
    expect(capHit(p.contract!, league.season, league.rules.cap)).toBe(withoutBonus);
    // The preview is what happened.
    expect(capSheet(league, "BUF", league.season).room).toBe(preview.teams[0].roomNow.after);
    expect(capSheet(league, "MIA", league.season).room).toBe(preview.teams[1].roomNow.after);
    expect(league.transactions.at(-1)!.type).toBe("traded");
  });

  it("is refused outside the trading period, after the deadline", () => {
    const league = copy();
    league.date = "2026-11-11";
    const p = onTeam(league, "BUF", "active")[0]!;
    const preview = previewTradeDeal(
      league,
      { teamId: "BUF", players: [p.id], picks: [] },
      { teamId: "MIA", players: [], picks: [] },
    );
    expect(preview.legal).toBe(false);
    expect(preview.problems.join(" ")).toMatch(/deadline/);
    expect(() =>
      makeTrade(
        league,
        { teamId: "BUF", players: [p.id], picks: [] },
        { teamId: "MIA", players: [], picks: [] },
        "Test",
      ),
    ).toThrow(/deadline/);
  });

  it("is refused when it would put a team over the cap", () => {
    const league = copy();
    // Fill MIA's room to the dollar with dead money, then send it a salary.
    const room = capSheet(league, "MIA", league.season).room;
    league.teams
      .find((t) => t.id === "MIA")!
      .cap.deadMoney.push({ season: league.season, playerId: -1, amount: room, reason: "Test" });
    const p = onTeam(league, "BUF", "active").sort(
      (a, b) =>
        capHit(b.contract!, league.season, league.rules.cap) -
        capHit(a.contract!, league.season, league.rules.cap),
    )[0]!;
    const preview = previewTradeDeal(
      league,
      { teamId: "BUF", players: [p.id], picks: [] },
      { teamId: "MIA", players: [], picks: [] },
    );
    expect(preview.legal).toBe(false);
    expect(preview.problems.join(" ")).toMatch(/MIA is over the cap/);
  });

  it("is refused when it would put a team over the roster limit", () => {
    const league = copy();
    // MIA at 90: taking two players for one is too many.
    while (onTeam(league, "MIA").length < 90) {
      const fa = league.players.find((p) => p.teamId === null && p.retiredAfter === null)!;
      fa.teamId = "MIA";
      fa.contract = {
        ...onTeam(league, "MIA")[0]!.contract!,
        bonuses: [],
        years: [
          {
            ...onTeam(league, "MIA")[0]!.contract!.years[0]!,
            base: 0,
            guaranteed: 0,
            rosterBonus: 0,
            workoutBonus: 0,
            perGameBonus: 0,
            incentives: [],
          },
        ],
      };
    }
    const two = onTeam(league, "BUF", "active")
      .slice(-2)
      .map((p) => p.id);
    const one = onTeam(league, "MIA", "active")[0]!.id;
    const preview = previewTradeDeal(
      league,
      { teamId: "BUF", players: two, picks: [] },
      { teamId: "MIA", players: [one], picks: [] },
    );
    expect(preview.legal).toBe(false);
    expect(preview.problems.join(" ")).toMatch(/MIA has 91 players/);
  });

  it("practice-squad players can't be traded", () => {
    const league = copy();
    advanceUntil(league, (x) => x.calendar.stage === "regular");
    const ps = onTeam(league, "BUF", "practice-squad")[0]!;
    const preview = previewTradeDeal(
      league,
      { teamId: "BUF", players: [ps.id], picks: [] },
      { teamId: "MIA", players: [], picks: [] },
    );
    expect(preview.legal).toBe(false);
    expect(preview.problems.join(" ")).toMatch(/practice squad/);
  }, 120_000);

  it("previews never change the league", () => {
    const league = copy();
    const before = serializeLeague(league);
    const p = withBonus(league, "BUF");
    previewTradeDeal(
      league,
      { teamId: "BUF", players: [p.id], picks: [] },
      {
        teamId: "MIA",
        players: [],
        picks: tradablePicks(league, "MIA")
          .slice(0, 2)
          .map((d) => d.id),
      },
    );
    expect(serializeLeague(league)).toBe(before);
  });
});
