/**
 * Draft day (Phase 11b): compensatory picks by the CBA's formula (a worked
 * example), the draft run pick by pick with trades at sensible prices, boards
 * set by hand, mock drafts, draft history and the format-13 upgrade.
 */
import { describe, expect, it } from "vitest";
import { createLeague } from "../generate/league";
import type { League } from "../league/schema";
import { parseLeague, serializeLeague } from "../serialize";
import { advance, advanceUntil } from "../season/flow";
import { tradablePicks } from "../roster/trades";
import { draftClass } from "../scouting/classes";
import { awardCompensatoryPicks, compensatoryAwards } from "./compensatory";
import { DRAFT_DAY } from "./config";
import { draftAction, draftOrder, makePick, onTheClock, tradeOffers } from "./day";
import { careerValue } from "./values";
import { bigBoardView, draftHistoryView, draftRoomView, mockDraftView, setBoard } from "./views";

const BASE = serializeLeague(createLeague({ seed: 71, name: "Draft day" }));
const copy = (): League => parseLeague(BASE);
// The same league on draft day, before the first pick.
const DRAFT_DAY_SAVE = (() => {
  const l = copy();
  advanceUntil(l, (x) => x.calendar.stage === "draft");
  return serializeLeague(l);
})();
const onDraftDay = (): League => parseLeague(DRAFT_DAY_SAVE);

describe("compensatory picks (CBA Appendix V, a worked example)", () => {
  /**
   * Last year's free agency, made up for the example (the season before this year's draft):
   * - ARI lost X1 ($60M a year) and X2 ($50M), and signed Y1 ($55M) from BAL. Y1 (top 5%, the
   *   round-3 bracket) cancels X1 (same bracket). Net loss: 1. X2 earns a pick after round 3.
   * - ARI also lost X3 on a one-year $1.0M deal: cheap one-year deals don't count.
   * - CHI lost X4 ($58M), a wide receiver with 11 accrued seasons: a round-3 value, but a
   *   non-quarterback veteran can't bring a pick before the end of round 5.
   * - BAL lost Y1 and signed no one: its pick follows round 3.
   * - Everything else is filled with supplemental picks at the end of round 7, by draft order,
   *   to one per club (32).
   */
  function example(): League {
    const league = copy();
    const last = league.season - 1;
    const vets = league.players.filter((p) => p.teamId && p.contract && p.experience >= 5);
    const [x1, x2, x3, x4, y1] = vets;
    for (const p of [x1, x2, x3, x4, y1]) p!.contract!.veteranSalaryBenefit = false;
    const move = (
      p: (typeof vets)[number],
      from: string,
      to: string,
      apy: number,
      years: number,
      accrued = 6,
      position = p.position,
    ) => ({
      season: last,
      date: `${last}-03-12`,
      playerId: p.id,
      fromTeamId: from,
      toTeamId: to,
      position,
      averagePerYear: apy,
      years,
      accruedSeasons: accrued,
    });
    league.freeAgentMoves = [
      move(x1!, "ARI", "DAL", 60_000_000, 4),
      move(x2!, "ARI", "DEN", 50_000_000, 4),
      move(x3!, "ARI", "DET", 1_000_000, 1),
      move(x4!, "CHI", "GB", 58_000_000, 3, 11, "WR"),
      move(y1!, "BAL", "ARI", 55_000_000, 4),
    ];
    return league;
  }

  it("cancels, places by bracket, excludes cheap one-year deals, and holds veterans to round 5", () => {
    const league = example();
    const awards = compensatoryAwards(league, league.season);
    const formula = awards.filter((a) => a.kind === "formula");
    const ids = league.freeAgentMoves.map((m) => m.playerId);
    // Within a round, the more valuable lost free agent's pick comes first (Y1 $55M, X2 $50M).
    expect(formula.map((a) => [a.teamId, a.round, a.playerId])).toEqual([
      ["BAL", 3, ids[4]],
      ["ARI", 3, ids[1]],
      ["CHI", 5, ids[3]],
    ]);
    // One per club in all: the rest are supplemental, at the end of round 7.
    expect(awards).toHaveLength(league.teams.length);
    expect(awards.filter((a) => a.kind === "supplemental").every((a) => a.round === 7)).toBe(true);
    for (const a of formula) expect(a.reason.length).toBeGreaterThan(20);
  });

  it("numbers compensatory picks after their round's regular picks", () => {
    const league = example();
    const regularInRound = league.teams.length;
    expect(awardCompensatoryPicks(league)).toBe(league.teams.length);
    const order = draftOrder(league);
    expect(order).toHaveLength(league.rules.draft.rounds * regularInRound + league.teams.length);
    expect(order.map((p) => p.overall)).toEqual(order.map((_, i) => i + 1));
    // Round 3's two compensatory picks come right after its 32 regular ones (picks 97 and 98).
    const round3 = order.filter((p) => p.round === 3);
    expect(round3.slice(0, regularInRound).every((p) => p.compensatory === null)).toBe(true);
    expect(round3.slice(regularInRound).map((p) => p.overall)).toEqual([97, 98]);
    // Awarded once: calling again changes nothing.
    expect(awardCompensatoryPicks(league)).toBe(0);
    expect(league.transactions.filter((t) => t.type === "compensatory")).toHaveLength(32);
  });

  it("caps a club at four picks", () => {
    const league = example();
    const last = league.season - 1;
    const others = league.players
      .filter((p) => p.teamId && p.contract && p.experience >= 5)
      .slice(5, 11);
    league.freeAgentMoves.push(
      ...others.map((p, i) => ({
        season: last,
        date: `${last}-03-12`,
        playerId: p.id,
        fromTeamId: "CLE",
        toTeamId: "DAL",
        position: p.position,
        averagePerYear: 40_000_000 - i * 1_000_000,
        years: 3,
        accruedSeasons: 5,
      })),
    );
    for (const p of others) p.contract!.veteranSalaryBenefit = false;
    const cle = compensatoryAwards(league, league.season).filter(
      (a) => a.teamId === "CLE" && a.kind === "formula",
    );
    expect(cle).toHaveLength(league.rules.draft.compensatory.maxPerClub);
  });
});

describe("draft day", () => {
  it("runs pick by pick: the league office picks, the AI picks, and picks can't be reused", () => {
    const league = onDraftDay();
    expect(league.calendar.stage).toBe("draft");
    const first = onTheClock(league)!;
    expect(first.overall).toBe(1);
    // Every class member has been measured by draft day.
    expect(draftClass(league).every((p) => p.tested)).toBe(true);
    const target = draftClass(league).at(-1)!; // the league office takes anyone it likes
    makePick(league, target.id);
    const player = league.players.find((p) => p.id === target.id)!;
    expect(player.drafted).toMatchObject({ pick: 1, round: 1, teamId: first.ownerTeamId });
    expect(player.contract?.type).toBe("rookie");
    expect(first.selection).toBe(target.id);
    expect(tradablePicks(league, first.ownerTeamId).some((p) => p.id === first.id)).toBe(false);
    // Unused picks this year can still be traded on draft day.
    const second = onTheClock(league)!;
    expect(tradablePicks(league, second.ownerTeamId).some((p) => p.id === second.id)).toBe(true);
    // Sim to a team's next pick: it's then on the clock.
    const later = draftOrder(league).find((p) => p.overall! > 10)!;
    draftAction(league, { kind: "sim", until: "team", teamId: later.ownerTeamId });
    expect(onTheClock(league)!.ownerTeamId).toBe(later.ownerTeamId);
  }, 300_000);

  it("a board set by hand is followed", () => {
    const league = onDraftDay();
    const team = onTheClock(league)!.ownerTeamId;
    const sleeper = draftClass(league).at(-5)!;
    setBoard(league, team, [sleeper.id]);
    expect(bigBoardView(league, team).rows[0]!.id).toBe(sleeper.id);
    draftAction(league, { kind: "pick" });
    expect(league.players.find((p) => p.id === sleeper.id)?.drafted?.teamId).toBe(team);
    expect(() => setBoard(league, team, [999_999])).toThrow();
  });

  it("finishes: every pick used, trades at sensible prices, the class closed, next year's ready", () => {
    const league = onDraftDay();
    advance(league); // the rest of the draft, the undrafted rush
    expect(league.calendar.stage).toBe("after-draft");
    const order = draftOrder(league);
    expect(order.every((p) => p.selection !== null)).toBe(true);
    const rookies = league.players.filter((p) => p.drafted?.season === league.season);
    expect(rookies).toHaveLength(order.length);
    expect(new Set(rookies.map((p) => p.drafted!.pick)).size).toBe(order.length);
    expect(draftClass(league, league.season)).toEqual([]);
    expect(draftClass(league, league.season + 1).length).toBeGreaterThan(400);
    // Draft-day trades: a realistic number, each priced near the real 1.42 times career value.
    const trades = league.transactions.filter(
      (t) => t.type === "traded" && t.date === league.date && t.reason.includes("moved up"),
    );
    expect(trades.length).toBeGreaterThan(10);
    expect(trades.length).toBeLessThanOrEqual(DRAFT_DAY.maxTradesPerDraft);
    const T = DRAFT_DAY.tradeUp;
    for (const t of trades) {
      const ratio = Number(/worth ([\d.]+) times/.exec(t.reason)![1]);
      expect(ratio).toBeGreaterThanOrEqual(T.price - T.priceSpread - 0.01);
      expect(ratio).toBeLessThanOrEqual((T.price + T.priceSpread) * T.maxOverpay + 0.01);
    }
  }, 300_000);

  it("the draft room, offers and mock draft describe the moment", () => {
    const league = onDraftDay();
    const room = draftRoomView(league);
    expect(room.status).toBe("live");
    expect(room.onClock?.clockMinutes).toBe(league.rules.draft.pickClockMinutes[0]);
    expect(room.board.length).toBeGreaterThan(5);
    for (const o of tradeOffers(league)) {
      expect(o.priceRatio).toBeGreaterThan(1);
      expect(o.picks.reduce((s, p) => s + p.worth, 0) / careerValue(1)).toBeCloseTo(
        o.priceRatio,
        5,
      );
    }
    const mock = mockDraftView(league, { kind: "league" });
    expect(mock.picks).toHaveLength(draftOrder(league).length);
    expect(new Set(mock.picks.map((p) => p.prospect.id)).size).toBe(mock.picks.length);
  });

  it("draft history grades a class once it has played", () => {
    const league = onDraftDay();
    advanceUntil(league, (l) => l.calendar.stage === "complete");
    advance(league);
    advanceUntil(league, (l) => l.calendar.stage === "complete");
    const history = draftHistoryView(league, { kind: "league" }, league.season - 1);
    expect(history.seasons).toEqual([league.season, league.season - 1]);
    expect(history.picks.length).toBeGreaterThan(200);
    expect(history.picks.every((p) => p.grade !== "Too early")).toBe(true);
    expect(history.teams.length).toBe(league.teams.length);
  }, 600_000);

  it("a format-13 save loads with regular, unused picks and no boards set by hand", () => {
    const old = JSON.parse(serializeLeague(copy()));
    old.formatVersion = 13;
    delete old.freeAgentMoves;
    for (const p of old.draftPicks) {
      delete p.compensatory;
      delete p.selection;
    }
    for (const t of old.teams) delete t.scouting.board;
    delete old.rules.draft.pickClockMinutes;
    delete old.rules.draft.compensatory;
    const upgraded = parseLeague(JSON.stringify(old));
    expect(upgraded.freeAgentMoves).toEqual([]);
    expect(upgraded.draftPicks.every((p) => p.compensatory === null && p.selection === null)).toBe(
      true,
    );
    expect(upgraded.rules.draft.compensatory.maxPerClub).toBe(4);
  });
});
