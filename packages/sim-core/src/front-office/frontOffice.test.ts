/**
 * Front offices (Phase 13a): every team has a GM and an owner with a mix of philosophies; each GM
 * reads where his team stands; GM styles move what teams pay; trade answers come with reasons,
 * counters and memory; the AI market makes trades, and a person-run team gets offers instead.
 */
import { describe, expect, it } from "vitest";
import { addDays, ageOn } from "@fgm/foundation";
import { createLeague } from "../generate/league";
import type { League, Player } from "../league/schema";
import { parseLeague, serializeLeague } from "../serialize";
import { advance } from "../season/flow";
import { updatePlans, stanceOf } from "./evaluate";
import { archetypeOf, gmOf, ownerOf, NEUTRAL_GM } from "./executives";
import { gmLimitFactor } from "./strategy";
import { answerTrade, executeTrade, TRADE_AI } from "./tradeAI";
import { expireOffers, tradeMarket } from "./tradeMarket";
import { pickTradeValue, playerTradeValue } from "./tradeValue";
import { tradablePicks } from "../roster/trades";
import { playerValue, waivePlayer } from "../roster/moves";

// A new league on free agency day 1: plans read, trading open. Each team waives its three
// weakest players so trades that add a player are legal under the 90-man limit.
const DAY_ONE = (() => {
  const l = createLeague({ seed: 77, name: "Front offices" });
  advance(l);
  for (const t of l.teams) {
    const weakest = l.players
      .filter((p) => p.teamId === t.id && p.roster === "active")
      .sort((a, b) => playerValue(l, a) - playerValue(l, b) || a.id - b.id)
      .slice(0, 3);
    for (const p of weakest) waivePlayer(l, p.id, "Test: room under the 90-man limit.");
  }
  return serializeLeague(l);
})();
const dayOne = (): League => parseLeague(DAY_ONE);

const starters = (l: League, teamId: string) =>
  l.players.filter(
    (p) => p.teamId === teamId && p.roster === "active" && p.contract?.teamId === teamId,
  );

describe("executives", () => {
  it("every team has a GM and an owner, with a mix of philosophies", () => {
    const l = dayOne();
    for (const t of l.teams) {
      expect(gmOf(l, t.id)?.gm).toBeTruthy();
      expect(ownerOf(l, t.id)?.owner).toBeTruthy();
    }
    const kinds = new Set(l.teams.map((t) => archetypeOf(gmOf(l, t.id)!.gm!)));
    expect(kinds.size).toBeGreaterThanOrEqual(5);
    expect(archetypeOf(NEUTRAL_GM)).toBeTruthy();
  });

  it("a format-16 save loads with generated front offices and no trade memory", () => {
    const old = JSON.parse(DAY_ONE);
    old.formatVersion = 16;
    delete old.executives;
    delete old.executiveMoves;
    delete old.tradeHistory;
    delete old.tradeOffers;
    delete old.nextIds.executive;
    delete old.nextIds.tradeOffer;
    for (const t of old.teams) delete t.plan;
    const l = parseLeague(JSON.stringify(old));
    expect(l.executives.length).toBe(l.teams.length * 2);
    expect(l.teams.every((t) => t.plan === null)).toBe(true);
    expect(l.tradeHistory).toEqual([]);
  });
});

describe("team plans", () => {
  it("every team has a stance with reasons", () => {
    const l = dayOne();
    const stances = l.teams.map((t) => t.plan?.stance);
    expect(stances.every((w) => w === "contend" || w === "retool" || w === "rebuild")).toBe(true);
    expect(new Set(stances).size).toBe(3);
    expect(l.teams.every((t) => (t.plan?.reasons.length ?? 0) > 0)).toBe(true);
    expect(l.teams.every((t) => t.plan!.capRoom.length === 3)).toBe(true);
  });

  it("a win-now GM calls a borderline team a contender sooner than a patient one", () => {
    const l = dayOne();
    const t = l.teams.find((x) => x.plan?.stance === "retool")!;
    const gm = gmOf(l, t.id)!.gm!;
    gm.futureDiscount = 1;
    t.plan = null;
    updatePlans(l);
    const eager = stanceOf(l, t.id);
    gm.futureDiscount = -1;
    t.plan = null;
    updatePlans(l);
    const patient = stanceOf(l, t.id);
    const order = { rebuild: 0, retool: 1, contend: 2 };
    expect(order[eager]).toBeGreaterThanOrEqual(order[patient]);
  });
});

describe("GM styles move prices", () => {
  it("a contender pays more for a veteran than a rebuilder; analytics GMs pay less for running backs", () => {
    const l = dayOne();
    const vet = l.players.find(
      (p) => p.teamId && p.contract && ageOn(p.birthDate, l.date) >= 30 && p.position === "WR",
    )!;
    const contender = l.teams.find((t) => t.plan?.stance === "contend" && t.id !== vet.teamId)!;
    const rebuilder = l.teams.find((t) => t.plan?.stance === "rebuild" && t.id !== vet.teamId)!;
    expect(gmLimitFactor(l, contender.id, vet)).toBeGreaterThan(
      gmLimitFactor(l, rebuilder.id, vet),
    );
    const rb = l.players.find((p) => p.teamId && p.position === "RB" && p.teamId !== contender.id)!;
    const gm = gmOf(l, contender.id)!.gm!;
    gm.analytics = 1;
    const modern = gmLimitFactor(l, contender.id, rb);
    gm.analytics = -1;
    expect(modern).toBeLessThan(gmLimitFactor(l, contender.id, rb));
  });
});

describe("trade answers", () => {
  /** A team's backup worth little, and a pick from another team worth much more. */
  function lopsidedForResponder(l: League) {
    const responder = l.teams[3]!.id;
    const proposer = l.teams[9]!.id;
    const backup = starters(l, responder)
      .map((p) => ({ p, v: playerTradeValue(l, p, { teamId: responder }, false).value }))
      .filter((x) => x.v > 0.5 && x.v < 4)
      .sort((a, b) => a.v - b.v)[0]!.p;
    const pick = tradablePicks(l, proposer)
      .filter((d) => d.round <= 3)
      .sort((a, b) => a.round - b.round)[0]!;
    return { responder, proposer, backup, pick };
  }

  it("a deal clearly in the responder's favor is accepted, with reasons", () => {
    const l = dayOne();
    const { responder, proposer, backup, pick } = lopsidedForResponder(l);
    const a = answerTrade(
      l,
      { teamId: proposer, players: [], picks: [pick.id] },
      { teamId: responder, players: [backup.id], picks: [] },
    );
    expect(a.accept).toBe(true);
    expect(a.reason).toMatch(/accepts/);
    expect(a.view.gets[0]!.why.length).toBeGreaterThan(5);
  });

  it("a lowball gets a no with a counter, and the counter works; the same question gets the same answer", () => {
    const l = dayOne();
    const responder = l.teams[5]!.id;
    const proposer = l.teams[12]!.id;
    const star = starters(l, responder)
      .map((p) => ({ p, v: playerTradeValue(l, p, { teamId: responder }, false).value }))
      .filter((x) => x.v >= 15 && x.v <= 40)
      .sort((a, b) => b.v - a.v)[0]!.p;
    const late = tradablePicks(l, proposer).sort((a, b) => b.round - a.round)[0]!;
    const ask = () =>
      answerTrade(
        l,
        { teamId: proposer, players: [], picks: [late.id] },
        { teamId: responder, players: [star.id], picks: [] },
      );
    const no = ask();
    expect(no.accept).toBe(false);
    expect(no.reason).toMatch(/says no/);
    expect(ask()).toEqual(no);
    if (no.counter) {
      const yes = answerTrade(
        l,
        { teamId: proposer, players: no.counter.players, picks: [late.id, ...no.counter.picks] },
        { teamId: responder, players: [star.id], picks: [] },
      );
      expect(yes.accept || yes.problems.length > 0).toBe(true);
    } else expect(no.counterText).toMatch(/Nothing more/);
  });

  it("remembers: a run of trades with the same partner is refused", () => {
    const l = dayOne();
    const { responder, proposer, backup, pick } = lopsidedForResponder(l);
    for (let i = 0; i < TRADE_AI.memoryMax; i++)
      l.tradeHistory.push({
        season: l.season,
        date: l.date,
        teams: [proposer, responder],
        gave: [1, 1],
        got: [1, 1],
        neutral: [1, 1],
        source: "office",
      });
    const a = answerTrade(
      l,
      { teamId: proposer, players: [], picks: [pick.id] },
      { teamId: responder, players: [backup.id], picks: [] },
    );
    expect(a.accept).toBe(false);
    expect(a.reason).toMatch(/lately/);
  });

  it("an executed trade records both teams' views and a neutral judge's", () => {
    const l = dayOne();
    const { responder, proposer, backup, pick } = lopsidedForResponder(l);
    executeTrade(
      l,
      { teamId: proposer, players: [], picks: [pick.id] },
      { teamId: responder, players: [backup.id], picks: [] },
      "office",
      "Test.",
    );
    const h = l.tradeHistory.at(-1)!;
    expect(h.teams).toEqual([proposer, responder]);
    expect(h.neutral[0]).toBeGreaterThan(0);
    expect(l.transactions.at(-1)!.reason).toMatch(/saw/);
    expect((backup as Player).teamId).toBe(proposer);
  });

  it("future picks are worth less than the same pick this year, and more to a rebuilder", () => {
    const l = dayOne();
    const now = l.draftPicks.find(
      (d) => d.season === l.season && d.round === 2 && d.selection === null,
    )!;
    const later = l.draftPicks.find(
      (d) => d.season === l.season + 1 && d.round === 2 && d.originalTeamId === now.originalTeamId,
    )!;
    expect(pickTradeValue(l, later, { neutral: true }).value).toBeLessThan(
      pickTradeValue(l, now, { neutral: true }).value,
    );
    const rebuilder = l.teams.find((t) => t.plan?.stance === "rebuild")!.id;
    const contender = l.teams.find((t) => t.plan?.stance === "contend")!.id;
    expect(pickTradeValue(l, now, { teamId: rebuilder }).value).toBeGreaterThan(
      pickTradeValue(l, now, { teamId: contender }).value,
    );
  });
});

describe("the trade market", () => {
  it("AI teams make trades with reasons, and a person-run team gets offers that expire", () => {
    const l = dayOne();
    let made = 0;
    for (let d = 0; d < 6; d++) {
      made += tradeMarket(l, "camp", 7, 3);
      l.date = addDays(l.date, 1);
    }
    expect(made).toBeGreaterThan(0);
    const trade = l.transactions.filter((t) => t.type === "traded").at(-1)!;
    expect(trade.reason).toMatch(/saw .* for /);

    const human = parseLeague(DAY_ONE);
    for (const t of human.teams) t.controller = "human";
    human.teams[0]!.controller = "ai";
    human.teams[1]!.controller = "ai";
    for (let d = 0; d < 10; d++) {
      tradeMarket(human, "camp", 7, 3);
      human.date = addDays(human.date, 1);
    }
    expect(human.tradeOffers.length).toBeGreaterThan(0);
    expect(human.pendingDecisions.some((x) => x.request.kind === "trade-offer")).toBe(true);
    human.date = addDays(human.date, 30);
    expireOffers(human);
    expect(human.tradeOffers.every((o) => o.status !== "open")).toBe(true);
    expect(human.pendingDecisions.some((x) => x.request.kind === "trade-offer")).toBe(false);
  });
});
