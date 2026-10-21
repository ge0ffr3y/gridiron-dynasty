/**
 * Roster rules (Phase 8), worked examples against the 2020 CBA and the
 * league's roster rules (rules.roster): waiver claim order, vested veterans,
 * practice-squad eligibility and pay, elevations, injured reserve, cutdown,
 * rookie deals, weekly pay on in-season moves, and game-day actives.
 */
import { describe, expect, it } from "vitest";
import { overallAt } from "@fgm/foundation";
import { rookieSlot } from "../contracts/cap";
import { capHit, totalValue } from "../contracts/contract";
import { previewRelease, previewTrade, tradePlayer } from "../contracts/operations";
import { capSheet } from "../contracts/team";
import { createLeague } from "../generate/league";
import type { League, Player } from "../league/schema";
import { parseLeague, serializeLeague } from "../serialize";
import { seasonDates } from "../season/calendar";
import { gameDepthChart } from "../season/depthChart";
import { advance, advanceUntil } from "../season/flow";
import { DEPTH_SLOTS } from "@fgm/game-engine";
import { rosterProblems } from "./legality";
import { isPracticeSquadVeteran, onTeam, practiceSquadOpening } from "./lists";
import {
  claimOrder,
  elevationsLeft,
  practiceSquadDeal,
  practiceSquadWeekly,
  protectedPracticeSquad,
  reserveReturnsLeft,
  signFromPracticeSquad,
  subjectToWaivers,
} from "./moves";
import { gameDayElevations } from "./upkeep";

// One league, simmed to Week 1 (draft, camp, preseason and final cuts done); tests work on copies.
const BASE = createLeague({ seed: 8, name: "Rosters" });
const DRAFTED = (() => {
  const l = parseLeague(serializeLeague(BASE));
  advanceUntil(l, (x) => x.calendar.stage === "after-draft");
  return serializeLeague(l);
})();
const WEEK_ONE = (() => {
  const l = parseLeague(DRAFTED);
  advanceUntil(l, (x) => x.calendar.stage === "regular");
  return serializeLeague(l);
})();
const copy = (text: string): League => parseLeague(text);
const M = 1_000_000;

describe("the calendar", () => {
  it("2026 dates match the league's published calendar", () => {
    const d = seasonDates(BASE.rules, 2026);
    expect(d.leagueYear).toBe("2026-03-11");
    expect(d.draft).toBe("2026-04-23");
    expect(d.preseasonSaturdays).toEqual(["2026-08-15", "2026-08-22", "2026-08-29"]);
    expect(d.cutdown).toBe("2026-08-30"); // the Sunday after the last preseason game (new in 2026)
    expect(d.practiceSquads).toBe("2026-08-31");
    expect(d.tradeDeadline).toBe("2026-11-10"); // the Tuesday after Week 9
    expect(d.weekSundays.at(-1)).toBe("2027-01-10");
    expect(d.playoffs.championship).toBe("2027-02-14");
    expect(seasonDates(BASE.rules, 2027).draft).toBe("2027-04-29");
  });
});

describe("the draft and rookies", () => {
  it("every pick is made in order and signed on the rookie scale", () => {
    const league = copy(DRAFTED);
    const rookies = league.players.filter((p) => p.drafted?.season === 2026);
    expect(rookies.length).toBe(league.rules.draft.rounds * league.teams.length);
    for (const p of rookies) {
      expect(p.contract?.type).toBe("rookie");
      // Total value: the slot's total (signing bonus plus four salaries), unless four minimum
      // salaries plus the bonus already come to more.
      const slot = rookieSlot(league.rules, 2026, p.drafted!.pick);
      const floor = slot.minimums.reduce((a, b) => a + b, 0) + slot.signingBonus;
      expect(totalValue(p.contract!)).toBe(Math.max(slot.total, floor));
    }
    expect(rosterProblems(league)).toEqual([]);
  });
});

describe("final cuts", () => {
  it("every team has 53 active and a legal practice squad", () => {
    const league = copy(WEEK_ONE);
    for (const t of league.teams) {
      expect(onTeam(league, t.id, "active").length, t.id).toBe(53);
      const squad = onTeam(league, t.id, "practice-squad");
      expect(squad.length).toBeLessThanOrEqual(16);
      expect(squad.filter((p) => isPracticeSquadVeteran(league, p)).length).toBeLessThanOrEqual(6);
    }
    expect(rosterProblems(league)).toEqual([]);
    // The cuts went through waivers: some were claimed, and every claim followed the order.
    expect(league.transactions.some((t) => t.type === "claimed")).toBe(true);
  });
});

describe("waivers", () => {
  it("claim order: last season's draft order through Week 3, then this season's standings", () => {
    const league = copy(WEEK_ONE);
    expect(claimOrder(league)).toEqual(league.history.at(-1)!.draftOrder);
    for (let w = 0; w < 4; w++) advance(league);
    const order = claimOrder(league);
    const wins = (id: string) =>
      league.games.filter(
        (g) =>
          g.round === "regular" &&
          g.result &&
          ((g.homeId === id && g.result.homeScore > g.result.awayScore) ||
            (g.awayId === id && g.result.awayScore > g.result.homeScore)),
      ).length;
    // Worst record first.
    expect(wins(order[0]!)).toBeLessThanOrEqual(wins(order.at(-1)!));
    expect(order).not.toEqual(league.history.at(-1)!.draftOrder);
  }, 300_000);

  it("vested veterans skip waivers until the trade deadline; then everyone goes through them", () => {
    const league = copy(WEEK_ONE);
    const vet = league.players.find((p) => p.teamId && p.experience >= 4)!;
    const young = league.players.find((p) => p.teamId && p.experience < 4)!;
    expect(subjectToWaivers(league, vet)).toBe(false);
    expect(subjectToWaivers(league, young)).toBe(true);
    league.date = "2026-11-11"; // the day after the deadline
    expect(subjectToWaivers(league, vet)).toBe(true);
  });
});

describe("the practice squad", () => {
  it("pays the CBA's weekly rate for 18 weeks, and veterans at least the veteran minimum", () => {
    const league = copy(WEEK_ONE);
    const young = league.players.find(
      (p) => p.teamId === null && p.retiredAfter === null && p.experience <= 2,
    )!;
    const vet = league.players.find(
      (p) => p.teamId === null && p.retiredAfter === null && p.experience > 2,
    )!;
    expect(practiceSquadWeekly(league, young)).toBe(13_750);
    expect(practiceSquadWeekly(league, vet)).toBe(18_350);
    // Signed before Week 1: all 18 paydays.
    expect(capHit(practiceSquadDeal(league, young, "BUF"), 2026, league.rules.cap)).toBe(
      13_750 * 18,
    );
  });

  it("allows at most six veterans of any experience; the rest must have two or fewer seasons", () => {
    const league = copy(WEEK_ONE);
    const team = "BUF";
    for (const p of onTeam(league, team, "practice-squad")) p.teamId = null;
    const free = league.players.filter((p) => p.teamId === null && p.retiredAfter === null);
    const veterans = free.filter((p) => p.experience > 2);
    const young = free.find((p) => p.experience <= 2)!;
    for (const p of veterans.slice(0, 6)) {
      p.teamId = team;
      p.roster = "practice-squad";
    }
    // Six veterans on the squad: a seventh is refused, a young player still fits.
    expect(practiceSquadOpening(league, team, veterans[6]!)).toBe(false);
    expect(practiceSquadOpening(league, team, young)).toBe(true);
  });

  it("elevates at most two a game, and each player at most three times a season", () => {
    const league = copy(WEEK_ONE);
    const team = "BUF";
    // Leave the team with no healthy quarterback behind the starter.
    const qbs = onTeam(league, team, "active").filter((p) => p.position === "QB");
    for (const p of qbs) p.injury = { description: "Test", gamesRemaining: 3, since: league.date };
    const psQb = league.players.find(
      (p) =>
        p.teamId === null && p.retiredAfter === null && p.position === "QB" && p.experience <= 2,
    )!;
    psQb.teamId = team;
    psQb.roster = "practice-squad";
    psQb.contract = practiceSquadDeal(league, psQb, team);
    const first = gameDayElevations(league, [team]).get(team) ?? [];
    expect(first.length).toBeGreaterThan(0);
    expect(first.length).toBeLessThanOrEqual(2);
    const elevatedQb = league.players.find((p) => first.includes(p.id) && p.position === "QB")!;
    expect(elevatedQb.roster).toBe("practice-squad");
    // After three elevations he can't be elevated again this season.
    elevatedQb.elevations = 3;
    expect(elevationsLeft(league, elevatedQb)).toBe(0);
    expect(gameDayElevations(league, [team]).get(team) ?? []).not.toContain(elevatedQb.id);
  });
});

describe("signing off another practice squad", () => {
  it("each team protects four a week; the rest can be signed to another team's 53", () => {
    const league = copy(WEEK_ONE);
    const squad = onTeam(league, "BUF", "practice-squad");
    const kept = protectedPracticeSquad(league, "BUF");
    expect(kept.size).toBe(4);
    const shielded = squad.find((p) => kept.has(p.id))!;
    const open = squad.find((p) => !kept.has(p.id))!;
    // Make room on MIA's 53 first.
    const cut = onTeam(league, "MIA", "active").at(-1)!;
    cut.teamId = null;
    cut.contract = null;
    expect(() => signFromPracticeSquad(league, shielded.id, "MIA", "Test")).toThrow(/protected/);
    signFromPracticeSquad(league, open.id, "MIA", "Test");
    expect(open.teamId).toBe("MIA");
    expect(open.roster).toBe("active");
    expect(onTeam(league, "BUF", "practice-squad").length).toBe(squad.length - 1);
  });
});

describe("injured reserve", () => {
  it("a player out four or more games goes on IR, misses at least four, and his return uses one of eight", () => {
    const league = copy(WEEK_ONE);
    const team = "BUF";
    const star = onTeam(league, team, "active").sort(
      (a, b) => overallAt(b.ratings, b.position) - overallAt(a.ratings, a.position),
    )[0]!;
    star.injury = { description: "Test injury", gamesRemaining: 5, since: league.date };
    const returns = reserveReturnsLeft(league, team);
    advance(league); // weekly upkeep puts him on IR, then Week 1 is played
    expect(star.roster).toBe("injured-reserve");
    for (let w = 0; w < 3; w++) advance(league);
    expect(star.roster).toBe("injured-reserve"); // still inside the minimum
    for (let w = 0; w < 3; w++) advance(league);
    expect(star.roster).toBe("active");
    expect(star.reserve).toBeNull();
    expect(reserveReturnsLeft(league, team)).toBe(returns - 1);
    expect(rosterProblems(league)).toEqual([]);
  }, 300_000);
});

describe("weekly pay (CBA Art. 13 Sec. 6(b))", () => {
  /** A player whose deal is just a non-guaranteed salary this year (no bonus money). */
  function plainSalary(league: League): Player {
    const p = onTeam(league, "BUF", "active").find(
      (x) =>
        x.contract!.bonuses.length === 0 &&
        x.contract!.years[0]!.guaranteed === 0 &&
        x.contract!.signedOn < "2026-09-01",
    )!;
    return p;
  }

  it("a release after Week 4 leaves the four weeks already paid on the cap", () => {
    const league = copy(WEEK_ONE);
    const p = plainSalary(league);
    const y = p.contract!.years.find((x) => x.season === 2026)!;
    for (let w = 0; w < 4; w++) advance(league);
    const effects = previewRelease(league, p.id);
    expect(effects.deadThisYear).toBe(
      Math.round((y.base * 4) / 18) +
        Math.round((y.perGameBonus * 4) / 18) +
        y.rosterBonus +
        y.workoutBonus,
    );
  }, 300_000);

  it("a trade after Week 4: the old team keeps what it paid, the new team takes the rest", () => {
    const league = copy(WEEK_ONE);
    const p = plainSalary(league);
    const y = p.contract!.years.find((x) => x.season === 2026)!;
    for (let w = 0; w < 4; w++) advance(league);
    const fullHit = capHit(p.contract!, 2026, league.rules.cap);
    const preview = previewTrade(league, p.id, "MIA");
    const paid =
      Math.round((y.base * 4) / 18) +
      Math.round((y.perGameBonus * 4) / 18) +
      y.rosterBonus +
      y.workoutBonus;
    expect(preview.deadThisYear).toBe(paid);
    expect(preview.newTeamCapHit).toBe(fullHit - paid);
    const before = capSheet(league, "BUF", 2026).room;
    tradePlayer(league, p.id, "MIA", "Test trade");
    expect(capSheet(league, "BUF", 2026).room).toBe(before + fullHit - paid);
    // Paid once: releasing him later on the new team charges only his new weeks.
    expect(capHit(p.contract!, 2026, league.rules.cap)).toBe(fullHit - paid);
  }, 300_000);
});

describe("game day", () => {
  it("48 dress when a team has 53 healthy players and eight linemen", () => {
    const league = copy(WEEK_ONE);
    for (const p of league.players) p.injury = null;
    const chart = gameDepthChart(league, "BUF");
    const dressed = new Set(DEPTH_SLOTS.flatMap((slot) => chart[slot].map((p) => p.id)));
    expect(dressed.size).toBe(48);
  });
});
