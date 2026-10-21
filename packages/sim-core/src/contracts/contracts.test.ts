/**
 * Worked examples for every cap rule (Phase 7). Amounts follow the CBA's own
 * examples where it gives them; every number is checked to the dollar.
 */
import { Rng } from "@fgm/foundation";
import { describe, expect, it } from "vitest";
import { createLeague } from "../generate/league";
import type { Contract, ContractYear, League } from "../league/schema";
import { RULES_BY_SEASON, type Rules } from "../rules";
import { parseLeague, serializeLeague } from "../serialize";
import { minimumSalary, rfaTenders, rookieSlot, salaryCap } from "./cap";
import { bonusShare, capHit, cashIn, remainingProration, totalValue } from "./contract";
import { rookieContract } from "./generate";
import {
  decideFifthYearOption,
  previewRelease,
  previewRestructure,
  previewTrade,
  releasePlayer,
  restructureContract,
  tradePlayer,
} from "./operations";
import { capPercentageAverage, fifthYearOptionSalary, tagTender } from "./tags";
import { capSheet, cashSpendingShortfall } from "./team";
import { settleIncentives } from "./upkeep";

const RULES = RULES_BY_SEASON[2026] as Rules;
const CAP = RULES.cap;
const M = 1_000_000;

function year(season: number, base: number, extra: Partial<ContractYear> = {}): ContractYear {
  return {
    season,
    base,
    guaranteed: 0,
    injuryGuaranteed: 0,
    vestsOn: null,
    rosterBonus: 0,
    workoutBonus: 0,
    perGameBonus: 0,
    incentives: [],
    void: false,
    ...extra,
  };
}

/** A 5-year deal from 2026: base salaries as given, a signing bonus spread over all five. */
function fiveYearDeal(bases: number[], bonus: number, teamId = "BUF"): Contract {
  return {
    teamId,
    type: "veteran",
    signedOn: "2026-03-15",
    years: bases.map((b, i) => year(2026 + i, b)),
    bonuses: [
      { amount: bonus, kind: "signing", seasons: [2026, 2027, 2028, 2029, 2030], paidIn: 2026 },
    ],
    fifthYearOption: null,
    veteranSalaryBenefit: false,
  };
}

/** A league on its first offseason day, with one player given a hand-made contract. */
function withContract(c: Contract, experience = 8): { league: League; id: number } {
  const league = parseLeague(serializeLeague(BASE));
  const p = league.players.find((x) => x.teamId === c.teamId)!;
  p.contract = c;
  p.experience = experience;
  return { league, id: p.id };
}

const BASE = createLeague({ seed: 71, name: "Cap" });

describe("cap rules from the CBA", () => {
  it("salary caps are the announced figures; later years are projected and rounded to $100,000", () => {
    expect(salaryCap(CAP, 2026)).toBe(301_200_000);
    expect(salaryCap(CAP, 2021)).toBe(182_500_000);
    expect(salaryCap(CAP, 2027)).toBe(322_300_000); // 301.2M x 1.07 = 322.284M
  });

  it("minimum salaries follow Article 26 by credited seasons", () => {
    expect(minimumSalary(CAP, 2026, 0)).toBe(885_000);
    expect(minimumSalary(CAP, 2026, 2)).toBe(1_075_000);
    expect(minimumSalary(CAP, 2026, 5)).toBe(1_215_000); // the 4-6 column
    expect(minimumSalary(CAP, 2026, 12)).toBe(1_300_000);
    expect(minimumSalary(CAP, 2030, 0)).toBe(1_065_000);
    expect(minimumSalary(CAP, 2026, 0, "notActive")).toBe(515_000);
    // After the agreement ends the schedule keeps its last step ($45,000 a year at 0 credited seasons).
    expect(minimumSalary(CAP, 2032, 0)).toBe(1_155_000);
  });

  it("restricted free agent tenders are the official 2026 amounts, then grow with the cap", () => {
    expect(rfaTenders(CAP, 2026)).toEqual({
      firstRound: 8_107_000,
      secondRound: 5_811_000,
      originalRound: 3_674_000,
      rightOfFirstRefusal: 3_547_000,
    });
    // 2027: the cap grows 7.004% (301.2M -> 322.3M): $8,107,000 x 322.3 / 301.2 = $8,675,321 -> $8,675,000.
    expect(rfaTenders(CAP, 2027).firstRound).toBe(8_675_000);
  });
});

describe("contract math (Article 13, Section 6)", () => {
  it("a signing bonus spreads equally over at most five years; leftover dollars go to the first years", () => {
    const bonus = {
      amount: 10_000_001,
      kind: "signing" as const,
      seasons: [2026, 2027, 2028],
      paidIn: 2026,
    };
    expect([2026, 2027, 2028].map((s) => bonusShare(bonus, s))).toEqual([
      3_333_334, 3_333_334, 3_333_333,
    ]);
  });

  it("cap hit = salary + roster and workout bonuses + likely incentives + proration", () => {
    const c = fiveYearDeal([1 * M, 5 * M, 8 * M, 10 * M, 12 * M], 10 * M);
    c.years[1] = year(2027, 5 * M, {
      rosterBonus: 1 * M,
      workoutBonus: 250_000,
      incentives: [
        { amount: 500_000, games: 12, likely: true },
        { amount: 2 * M, games: 16, likely: false },
      ],
    });
    // 5M + 1M + 0.25M + 0.5M (likely only) + 2M proration
    expect(capHit(c, 2027, CAP)).toBe(8_750_000);
    expect(totalValue(c)).toBe(10 * M + 36 * M + 1 * M + 250_000 + 2_500_000);
  });

  it("a veteran salary benefit deal counts at the two-credited-season minimum", () => {
    // A reported 2026 deal: $1.3M base for a 4+ year veteran plus $187,500 in bonuses counts $1,262,500.
    const c: Contract = {
      teamId: "BUF",
      type: "minimum",
      signedOn: "2026-03-20",
      years: [year(2026, 1_300_000, { rosterBonus: 87_500 })],
      bonuses: [{ amount: 100_000, kind: "signing", seasons: [2026], paidIn: 2026 }],
      fifthYearOption: null,
      veteranSalaryBenefit: true,
    };
    expect(capHit(c, 2026, CAP)).toBe(1_262_500);
  });

  it("void years spread a bonus and accelerate when the deal ends", () => {
    const c: Contract = {
      ...fiveYearDeal([2 * M, 6 * M, 8 * M, 0, 0], 15 * M),
    };
    c.years[3] = { ...year(2029, 0), void: true };
    c.years[4] = { ...year(2030, 0), void: true };
    expect(capHit(c, 2026, CAP)).toBe(5 * M); // 2M + 3M proration
    // When the three real years are done, 2029 and 2030's proration ($6M) is left to accelerate.
    expect(remainingProration(c, 2029)).toBe(6 * M);
  });
});

describe("releases, trades and restructures", () => {
  const deal = () => fiveYearDeal([2 * M, 10 * M, 12 * M, 14 * M, 16 * M], 20 * M);

  it("cut before June 1: all remaining bonus counts now", () => {
    // Released in 2026 (Feb, before June 1): $20M of proration left, all dead this year.
    const { league, id } = withContract(deal());
    const effects = previewRelease(league, id);
    expect(effects).toMatchObject({
      afterJuneFirst: false,
      capHitNow: 6 * M,
      deadThisYear: 20 * M,
      deadNextYear: 0,
    });
    expect(effects.savingsThisYear).toBe(-14 * M);
  });

  it("June 1 designation: this year's proration stays, the rest moves to next year", () => {
    const { league, id } = withContract(deal());
    const effects = releasePlayer(league, id, "test", { juneFirstDesignation: true });
    expect(effects).toMatchObject({
      afterJuneFirst: true,
      deadThisYear: 4 * M,
      deadNextYear: 16 * M,
      savingsThisYear: 2 * M,
    });
    const team = league.teams.find((t) => t.id === "BUF")!;
    expect(
      team.cap.deadMoney.filter((d) => d.playerId === id).map((d) => [d.season, d.amount]),
    ).toEqual([
      [2026, 4 * M],
      [2027, 16 * M],
    ]);
    expect(league.players.find((p) => p.id === id)!.teamId).toBeNull();
  });

  it("a cut after June 1 by date works the same way, and only two designations are allowed", () => {
    const { league, id } = withContract(deal());
    league.date = "2026-07-20";
    expect(previewRelease(league, id)).toMatchObject({ deadThisYear: 4 * M, deadNextYear: 16 * M });
    const fresh = withContract(deal());
    const team = fresh.league.teams.find((t) => t.id === "BUF")!;
    team.cap.juneFirstDesignations.push(
      { season: 2026, playerId: -1 },
      { season: 2026, playerId: -2 },
    );
    expect(() =>
      releasePlayer(fresh.league, fresh.id, "test", { juneFirstDesignation: true }),
    ).toThrow(/designations/);
  });

  it("guaranteed salary still owed counts at release, designation or not", () => {
    const c = deal();
    c.years[0]!.guaranteed = 2 * M;
    c.years[1]!.guaranteed = 10 * M;
    const { league, id } = withContract(c);
    expect(previewRelease(league, id).deadThisYear).toBe(20 * M + 12 * M);
    expect(previewRelease(league, id, { juneFirstDesignation: true }).deadThisYear).toBe(
      4 * M + 12 * M,
    );
  });

  it("a trade leaves the bonus with the old team; the new team takes only the salary", () => {
    const { league, id } = withContract(deal());
    const effects = tradePlayer(league, id, "MIA", "test");
    expect(effects).toMatchObject({ deadThisYear: 20 * M, deadNextYear: 0, newTeamCapHit: 2 * M });
    const p = league.players.find((x) => x.id === id)!;
    expect(p.teamId).toBe("MIA");
    expect(capHit(p.contract!, 2027, CAP)).toBe(10 * M);
    expect(previewTrade).toBeTypeOf("function");
  });

  it("a restructure frees room now and adds the same amount to later years", () => {
    // 2027 view: salary $10M, a 7+ year veteran's minimum is $1.345M, so $8.655M converts,
    // spread over 2027-2030 (4 years): $2,163,750 a year.
    const { league, id } = withContract(deal());
    league.season = 2027;
    league.date = "2027-03-20";
    const before = [2027, 2028, 2029, 2030].map((s) =>
      capHit(league.players.find((p) => p.id === id)!.contract!, s, CAP),
    );
    const effects = restructureContract(league, id, "test");
    expect(effects.converted).toBe(8_655_000);
    expect(effects.seasons).toEqual([2027, 2028, 2029, 2030]);
    const after = [2027, 2028, 2029, 2030].map((s) =>
      capHit(league.players.find((p) => p.id === id)!.contract!, s, CAP),
    );
    expect(before[0]! - after[0]!).toBe(8_655_000 - 2_163_750);
    expect(after[1]! - before[1]!).toBe(2_163_750);
    expect(after.reduce((a, b) => a + b, 0)).toBe(before.reduce((a, b) => a + b, 0));
  });

  it("void years let a restructure spread over five years", () => {
    const c = fiveYearDeal([2 * M, 10 * M, 0, 0, 0], 0);
    c.years = c.years.slice(0, 2);
    c.bonuses = [];
    const { league, id } = withContract(c);
    league.season = 2027;
    const effects = previewRestructure(league, id, { addVoidYears: 4 });
    expect(effects.voidYearsAdded).toBe(4);
    expect(effects.seasons).toEqual([2027, 2028, 2029, 2030, 2031]);
    expect(effects.savingsThisYear).toBe(8_655_000 - 1_731_000);
  });
});

describe("tags, tenders and rookies", () => {
  it("2026 tags are the published values; 120% of prior salary if that's more; 144% for a third tag", () => {
    expect(tagTender(BASE, "franchise", "QB", 2026, 30 * M)).toBe(43_895_000);
    expect(tagTender(BASE, "transition", "QB", 2026, 0)).toBe(37_833_000);
    expect(tagTender(BASE, "franchise", "OT", 2026, 0)).toBe(25_773_000); // offensive line category
    expect(tagTender(BASE, "franchise", "K", 2026, 6 * M)).toBe(7_200_000); // 120% beats $6.649M
    expect(tagTender(BASE, "franchise", "K", 2026, 6 * M, 2)).toBe(8_640_000); // third tag: 144%
  });

  it("later tags use the Cap Percentage Average of the five previous years", () => {
    const league = parseLeague(serializeLeague(BASE));
    league.salaryHistory = [2022, 2023, 2024, 2025, 2026].map((season) => ({
      season,
      category: "QB",
      top: [50, 45, 40, 35, 30, 25, 20].map((x) => x * M),
    }));
    const caps = [2022, 2023, 2024, 2025, 2026].reduce((a, s) => a + salaryCap(CAP, s), 0);
    // Top-5 average is $40M every year: 5 x 40M / (sum of caps) x 2027 cap.
    expect(capPercentageAverage(league, "QB", 2027, [1, 5])).toBe(
      Math.round(((5 * 40 * M) / caps) * salaryCap(CAP, 2027)),
    );
    expect(tagTender(league, "franchise", "QB", 2027, 0)).toBe(
      capPercentageAverage(league, "QB", 2027, [1, 5]),
    );
  });

  it("a first-round rookie deal: year one at the minimum, rising salaries, a 4-year bonus and a fifth-year option", () => {
    const league = parseLeague(serializeLeague(BASE));
    const p = league.players.find((x) => x.teamId === "BUF")!;
    const c = rookieContract(league, p, "BUF", 2026, 1);
    const slot = rookieSlot(RULES, 2026, 1);
    expect(c.years.map((y) => y.season)).toEqual([2026, 2027, 2028, 2029]);
    expect(c.years[0]!.base).toBe(885_000);
    expect(c.years[1]!.base).toBeGreaterThan(c.years[0]!.base);
    expect(c.bonuses[0]!.seasons).toHaveLength(4);
    expect(totalValue(c)).toBeGreaterThanOrEqual(slot.total - 3); // rounding of equal raises
    expect(c.fifthYearOption).toEqual({ season: 2030, exercised: null });
    // Later picks earn less, and the 224th pick is close to four minimum salaries.
    expect(rookieSlot(RULES, 2026, 33).total).toBeLessThan(slot.total);
    expect(rookieSlot(RULES, 2026, 224).total).toBeLessThan(5 * M);
  });

  it("fifth-year option: playing-time tier averages ranks 3-20, otherwise 3-25; exercising guarantees it", () => {
    const league = parseLeague(serializeLeague(BASE));
    league.salaryHistory = [2025, 2026, 2027, 2028, 2029].map((season) => ({
      season,
      category: "WR",
      top: Array.from({ length: 25 }, (_, i) => (40 - i) * M),
    }));
    const full = fifthYearOptionSalary(league, "WR", 2030, [0.8, 0.9, 0.6]);
    const basic = fifthYearOptionSalary(league, "WR", 2030, [0.3, 0.4, 0.2]);
    expect(full).toBe(capPercentageAverage(league, "WR", 2029, [3, 20]));
    expect(basic).toBe(capPercentageAverage(league, "WR", 2029, [3, 25]));
    expect(full).toBeGreaterThan(basic);
    const p = league.players.find((x) => x.teamId === "BUF")!;
    p.contract = rookieContract(league, p, "BUF", 2026, 5);
    decideFifthYearOption(league, p.id, true, full, "test");
    expect(p.contract.years.at(-1)).toMatchObject({ season: 2030, base: full, guaranteed: full });
  });
});

describe("the team's cap", () => {
  it("in the offseason only the top 51 contracts count in full", () => {
    const sheet = capSheet(BASE, "BUF", 2026);
    expect(sheet.topContractsRule).toBe(true);
    expect(sheet.lines.slice(0, 51).every((l) => l.counted === l.capHit)).toBe(true);
    expect(sheet.lines.slice(51).every((l) => l.counted <= l.capHit)).toBe(true);
    expect(sheet.room).toBe(sheet.cap + sheet.carryover - sheet.contracts - sheet.deadMoney);
  });

  it("carried-over room raises the team's cap for the next year", () => {
    const league = parseLeague(serializeLeague(BASE));
    const team = league.teams.find((t) => t.id === "BUF")!;
    const before = capSheet(league, "BUF", 2026).room;
    team.cap.carryover.push({ season: 2026, amount: 4 * M });
    expect(capSheet(league, "BUF", 2026).room).toBe(before + 4 * M);
  });

  it("minimum cash spending: a shortfall against 90% of the period's caps is owed", () => {
    const league = parseLeague(serializeLeague(BASE));
    const team = league.teams.find((t) => t.id === "BUF")!;
    team.cap.cashPaid = [2024, 2025, 2026].map((season) => ({ season, amount: 200 * M }));
    const caps = salaryCap(CAP, 2024) + salaryCap(CAP, 2025) + salaryCap(CAP, 2026);
    expect(cashSpendingShortfall(league, "BUF", 2026)).toBe(Math.round(caps * 0.9) - 600 * M);
    expect(cashSpendingShortfall(league, "BUF", 2025)).toBe(0); // not the end of a period
  });

  it("a new fictional league starts with every team under the cap, with realistic room", () => {
    for (const t of BASE.teams) {
      const sheet = capSheet(BASE, t.id, 2026);
      expect(sheet.room, t.id).toBeGreaterThanOrEqual(0);
      expect(sheet.room, t.id).toBeLessThan(0.2 * sheet.cap);
    }
  });
});

describe("year-end incentive accounting (Article 13, Section 6(c))", () => {
  function teamWithIncentive(likely: boolean, gamesPlayed: number) {
    const league = parseLeague(serializeLeague(BASE));
    league.season = 2026;
    const c = fiveYearDeal([5 * M, 5 * M, 5 * M, 5 * M, 5 * M], 0);
    for (const y of c.years) y.incentives = [{ amount: 3 * M, games: 12, likely }];
    // Only this player's incentive is in play.
    for (const x of league.players)
      if (x.contract) for (const y of x.contract.years) y.incentives = [];
    const p = league.players.find((x) => x.teamId === "BUF")!;
    p.contract = c;
    p.stats = [{ season: 2026, teamId: "BUF", line: { gp: gamesPlayed } }];
    return { league, p };
  }

  it("an unexpected incentive earned beyond the team's room is charged to next year", () => {
    const { league, p } = teamWithIncentive(false, 16);
    // $3M earned but not counted; with $1M of room, $2M lands on 2027's cap.
    expect(settleIncentives(league, "BUF", 1 * M)).toBe(2 * M);
    expect(league.teams.find((t) => t.id === "BUF")!.cap.deadMoney.at(-1)).toMatchObject({
      season: 2027,
      amount: 2 * M,
    });
    // He reached it, so next year's is now likely to be earned.
    expect(p.contract!.years[1]!.incentives[0]!.likely).toBe(true);
  });

  it("a likely incentive he missed comes back as a credit beyond the team's room", () => {
    const { league, p } = teamWithIncentive(true, 5);
    // $3M counted but not earned; with no room left (all carried over), the whole $3M is credited.
    expect(settleIncentives(league, "BUF", 0)).toBe(-3 * M);
    expect(league.teams.find((t) => t.id === "BUF")!.cap.carryover.at(-1)).toEqual({
      season: 2027,
      amount: 3 * M,
    });
    expect(p.contract!.years[1]!.incentives[0]!.likely).toBe(false);
  });
});

describe("cash equals cap over a contract's life", () => {
  it("for contracts played out, cut early, or restructured (random contracts, seeded)", () => {
    const rng = new Rng(9);
    for (let n = 0; n < 60; n++) {
      const years = rng.intBetween(1, 5);
      const bases = Array.from({ length: years }, () => rng.intBetween(1, 20) * 500_000);
      const bonus = rng.intBetween(0, 40) * 250_000;
      const c = fiveYearDeal(bases, bonus);
      c.bonuses[0]!.seasons = c.bonuses[0]!.seasons.slice(0, years);
      c.years.forEach((y, i) => (y.guaranteed = i === 0 ? y.base : 0));
      const { league, id } = withContract(c);
      const cutAfter = rng.intBetween(0, years); // seasons played out before a cut (years = never cut)
      const restructure = rng.chance(0.4) && years >= 2;
      let cash = 0;
      let charged = 0;
      for (let i = 0; i < years; i++) {
        const season = 2026 + i;
        league.season = season;
        league.date = `${season}-03-20`;
        const p = league.players.find((x) => x.id === id)!;
        if (i === 0 && restructure) {
          try {
            restructureContract(league, id, "test");
          } catch {
            // nothing above the minimum to convert
          }
        }
        if (i === cutAfter) {
          const team = league.teams.find((t) => t.id === "BUF")!;
          const deadBefore = team.cap.deadMoney.reduce((a, d) => a + d.amount, 0);
          // Cash at the cut: bonuses already paid this year, plus guaranteed salary still owed.
          const c = p.contract!;
          cash += c.bonuses.filter((b) => b.paidIn === season).reduce((a, b) => a + b.amount, 0);
          cash += c.years.filter((y) => y.season >= season).reduce((a, y) => a + y.guaranteed, 0);
          releasePlayer(league, id, "test");
          charged += team.cap.deadMoney.reduce((a, d) => a + d.amount, 0) - deadBefore;
          break;
        }
        cash += cashIn(p.contract!, season);
        charged += capHit(p.contract!, season, CAP);
      }
      expect(cash, `contract ${n}`).toBe(charged);
    }
  });
});
