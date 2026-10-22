/**
 * Free agency and negotiation (Phase 12a): market values anchored to real
 * contracts, demands, lowballs rejected with reasons, overpaying always
 * working, the league office's offers, the re-signing window (tags and
 * tenders), multi-day free agency, offer sheets and their compensation.
 */
import { describe, expect, it } from "vitest";
import marketData from "../../../../calibration/market.json";
import { createLeague } from "../generate/league";
import type { League, Player } from "../league/schema";
import { checkLegal, rosterProblems } from "../roster/legality";
import { parseLeague, serializeLeague } from "../serialize";
import { advance, advanceUntil } from "../season/flow";
import { salaryCap } from "./cap";
import { closeFreeAgency, teamLimit } from "./freeAgency";
import { marketSeason } from "./marketReport";
import { makeOffer, negotiationView } from "./marketViews";
import { marketQuality, marketValue, MARKET_MODEL, realPayAtRank } from "./market";
import { answerOffer, askAsOffer, demandFor } from "./negotiation";
import { setTransactionAudit } from "./operations";
import { capSheet } from "./team";

// A new league in its first offseason, with a third of the veterans' deals ending with last
// season (as a real League Year has), so the re-signing window and free agency have work to do.
// Built directly rather than by simulating a season, to keep the test quick.
const OFFSEASON = (() => {
  const l = createLeague({ seed: 91, name: "Market" });
  const vets = l.players
    .filter((p) => p.teamId !== null && p.contract && p.contract.type !== "rookie")
    .sort((a, b) => a.id - b.id);
  vets.forEach((p, i) => {
    if (i % 3 !== 0) return;
    const first = p.contract!.years[0]!;
    p.contract = { ...p.contract!, years: [{ ...first, season: l.season - 1 }], bonuses: [] };
  });
  return serializeLeague(l);
})();
const offseason = (): League => parseLeague(OFFSEASON);
// The same league just after the League Year opens (free agency day 1).
const FREE_AGENCY_DAY_1 = (() => {
  const l = offseason();
  advance(l);
  return serializeLeague(l);
})();
const dayOne = (): League => parseLeague(FREE_AGENCY_DAY_1);

const veterans = (l: League) =>
  l.players.filter((p) => p.teamId !== null && p.contract && p.contract.type !== "rookie");

describe("market value", () => {
  it("is anchored to the real pay curve at the player's rank", () => {
    const l = offseason();
    const qbs = veterans(l).filter((p) => p.position === "QB");
    const best = qbs.map((p) => marketValue(l, p)).sort((a, b) => a.rank - b.rank)[0]!;
    const real = realPayAtRank("QB", best.rank)!;
    expect(best.share).toBeGreaterThanOrEqual(real * (1 - MARKET_MODEL.compsBand) - 0.001);
    expect(best.share).toBeLessThanOrEqual(real * (1 + MARKET_MODEL.compsBand) + 0.001);
    // Past the measured ranks: depth, near the minimum.
    const depth = qbs.map((p) => marketValue(l, p)).find((v) => v.rank > marketData.ranks.at(-1)!);
    if (depth) expect(depth.share).toBeLessThan(0.01);
  });

  it("prices in age: the same player is worth less a few years older", () => {
    const l = offseason();
    const p = veterans(l).find((x) => x.position === "WR")!;
    const older: Player = {
      ...p,
      birthDate: `${Number(p.birthDate.slice(0, 4)) - 6}${p.birthDate.slice(4)}`,
    };
    expect(marketQuality(l, older)).toBeLessThan(marketQuality(l, p));
  });
});

describe("negotiation", () => {
  it("a lowball is rejected with an understandable reason", () => {
    const l = offseason();
    for (const p of veterans(l).slice(0, 30)) {
      const team = l.teams.find((t) => t.id !== p.teamId)!.id;
      const ask = askAsOffer(demandFor(l, p, team));
      const lowball = {
        ...ask,
        apy: Math.round(ask.apy * 0.55),
        guaranteed: Math.round(ask.guaranteed * 0.55),
      };
      const answer = answerOffer(l, p, team, lowball, 1, null);
      expect(answer.decision).toBe("reject");
      expect(answer.reason).toMatch(/% of his asking price.*ended talks/);
    }
  });

  it("overpaying always works: meeting or beating the ask in every part is accepted", () => {
    const l = offseason();
    for (const p of veterans(l).slice(0, 40))
      for (const team of l.teams.slice(0, 4)) {
        const ask = askAsOffer(demandFor(l, p, team.id));
        for (const f of [1, 1.15]) {
          const offer = {
            ...ask,
            apy: Math.round(ask.apy * f),
            guaranteed: Math.round(ask.guaranteed * f),
          };
          expect(answerOffer(l, p, team.id, offer, 1, null).decision, `${p.id} ${team.id}`).toBe(
            "accept",
          );
        }
      }
  });

  it("a near miss gets a counter between the offer and his ask", () => {
    const l = offseason();
    let countered = 0;
    for (const p of veterans(l).slice(0, 60)) {
      const team = l.teams.find((t) => t.id !== p.teamId)!.id;
      const ask = askAsOffer(demandFor(l, p, team));
      const offer = {
        ...ask,
        apy: Math.round(ask.apy * 0.9),
        guaranteed: Math.round(ask.guaranteed * 0.9),
      };
      const answer = answerOffer(l, p, team, offer, 1, null);
      if (answer.decision !== "counter") continue;
      countered += 1;
      expect(answer.counter!.apy).toBeGreaterThan(offer.apy);
      expect(answer.counter!.apy).toBeLessThanOrEqual(ask.apy);
      expect(answer.reason).toMatch(/Countered at/);
    }
    expect(countered).toBeGreaterThan(5);
  });
});

describe("the re-signing window and free agency", () => {
  it("teams keep, tag or tender their players before the League Year; the rest become free agents", () => {
    const l = dayOne();
    const year = l.transactions.filter((t) => t.date >= `${l.season}-02-01`);
    const tags = year.filter((t) => t.type === "tagged" && t.text.includes("franchise tag"));
    expect(new Set(tags.map((t) => t.teamIds[0])).size).toBe(tags.length); // one a team
    for (const t of tags) {
      const p = l.players.find((x) => x.id === t.playerIds[0])!;
      expect(p.contract?.type === "franchise" || p.rights === null).toBe(true);
    }
    expect(
      year.filter((t) => t.type === "signed" && t.text.includes("re-signed")).length,
    ).toBeGreaterThan(50);
    const expired = year.filter((t) => t.type === "expired");
    expect(expired.length).toBeGreaterThan(50);
    for (const t of expired) expect(t.reason.length).toBeGreaterThan(10);
    expect(l.freeAgency?.day).toBe(1);
  });

  it("free agency runs to the draft: real volume, signings with reasons, rosters legal", () => {
    const l = dayOne();
    setTransactionAudit(checkLegal);
    try {
      advanceUntil(l, (x) => x.calendar.stage === "draft");
    } finally {
      setTransactionAudit(null);
    }
    expect(rosterProblems(l)).toEqual([]);
    const s = marketSeason(l, l.season);
    // About the real number of well-paid free agents changing teams (140 a year), give or take.
    expect(s.freeAgentsNewTeamPaid1Pct).toBeGreaterThan(60);
    expect(s.freeAgentsNewTeamPaid1Pct).toBeLessThan(260);
    // Most top free agents' pay lands inside the real range for their position and tier.
    expect(s.topTierInRange.inRange / Math.max(1, s.topTierInRange.deals)).toBeGreaterThan(0.45);
    const signings = l.transactions.filter(
      (t) => t.type === "signed" && t.text.includes("signed free agent"),
    );
    for (const t of signings) expect(t.reason.length).toBeGreaterThan(10);
    expect(l.freeAgency).toBeNull();
  }, 600_000);
});

describe("the league office at the table", () => {
  it("signs a free agent at his ask, and the cap sheet shows the cost", () => {
    const l = dayOne();
    const fa = l.players
      .filter((p) => p.teamId === null && p.retiredAfter === null && p.experience > 3)
      .sort((a, b) => marketValue(l, b).apy - marketValue(l, a).apy)[0]!;
    const team = l.teams
      .map((t) => t.id)
      .sort((a, b) => capSheet(l, b, l.season).room - capSheet(l, a, l.season).room)[0]!;
    const view = negotiationView(l, fa.id, team, { kind: "league" });
    expect(view.kind).toBe("free-agent");
    const before = capSheet(l, team, l.season).room;
    const answer = makeOffer(l, fa.id, team, view.ask);
    expect(answer.decision).toBe("accept");
    expect(fa.teamId).toBe(team);
    expect(capSheet(l, team, l.season).room).toBeLessThan(before);
    expect(l.transactions.at(-1)!.reason).toMatch(/league office/);
  });

  it("a lowball ends talks, and the team can't come back this League Year", () => {
    const l = dayOne();
    const fa = l.players.filter(
      (p) => p.teamId === null && p.retiredAfter === null && p.experience > 3,
    )[0]!;
    const team = l.teams[0]!.id;
    const ask = negotiationView(l, fa.id, team, { kind: "league" }).ask;
    const answer = makeOffer(l, fa.id, team, {
      ...ask,
      apy: Math.round(ask.apy * 0.5),
      guaranteed: 0,
    });
    expect(answer.decision).toBe("reject");
    expect(() => makeOffer(l, fa.id, team, ask)).toThrow(/Talks have ended/);
  });

  it("an accepted offer the team can't fit under the cap is refused, saying by how much", () => {
    const l = dayOne();
    const fa = l.players.filter(
      (p) => p.teamId === null && p.retiredAfter === null && p.experience > 3,
    )[0]!;
    const team = l.teams
      .map((t) => t.id)
      .sort((a, b) => capSheet(l, a, l.season).room - capSheet(l, b, l.season).room)[0]!;
    const room = capSheet(l, team, l.season).room;
    const ask = negotiationView(l, fa.id, team, { kind: "league" }).ask;
    const huge = {
      ...ask,
      years: ask.years,
      apy: Math.max(ask.apy, room + 50_000_000) * 2,
      signingBonus: 0,
    };
    expect(() => makeOffer(l, fa.id, team, huge)).toThrow(/over the cap/);
  });
});

describe("offer sheets", () => {
  it("unmatched, the player moves and his old team gets the tender's compensation pick", () => {
    const l = dayOne();
    const holder = l.teams[0]!.id;
    // The bidder: the team with the most room.
    const bidder = l.teams
      .map((t) => t.id)
      .filter((id) => id !== holder)
      .sort((a, b) => capSheet(l, b, l.season).room - capSheet(l, a, l.season).room)[0]!;
    const p = l.players.find(
      (x) => x.teamId === holder && x.contract && x.contract.type !== "rookie",
    )!;
    p.rights = { kind: "rfa-first", teamId: holder, season: l.season };
    // More than the old team would pay, and within the bidder's room.
    const limit = teamLimit(l, holder, p);
    const apy = Math.min(Math.round(limit * 1.3), capSheet(l, bidder, l.season).room - 1_000_000);
    expect(apy).toBeGreaterThan(limit);
    const offer = { years: 3, apy, guaranteed: 0, signingBonus: 0 };
    l.freeAgency!.offerSheets.push({
      playerId: p.id,
      teamId: bidder,
      priorTeamId: holder,
      offer,
      date: l.date,
      matchBy: l.date,
    });
    const firstRounder = l.draftPicks.find(
      (d) =>
        d.ownerTeamId === bidder && d.round === 1 && d.season === l.season && d.selection === null,
    )!;
    closeFreeAgency(l);
    expect(p.teamId).toBe(bidder);
    expect(firstRounder.ownerTeamId).toBe(holder);
    expect(l.transactions.at(-1)!.reason).toMatch(/declined to match/);
  });
});

describe("saves", () => {
  it("a format-14 save loads with agents, no talks and no rights held", () => {
    const old = JSON.parse(OFFSEASON);
    old.formatVersion = 14;
    delete old.agents;
    delete old.negotiations;
    delete old.freeAgency;
    delete old.rules.freeAgency;
    for (const p of old.players) delete p.rights;
    const upgraded = parseLeague(JSON.stringify(old));
    expect(upgraded.agents.length).toBeGreaterThan(20);
    expect(upgraded.negotiations).toEqual([]);
    expect(upgraded.freeAgency).toBeNull();
    expect(upgraded.rules.freeAgency.offerSheet.matchDays).toBe(5);
    expect(salaryCap(upgraded.rules.cap, upgraded.season)).toBeGreaterThan(0);
  });
});
