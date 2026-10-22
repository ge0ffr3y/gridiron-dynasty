/**
 * Moods, the locker room and contract disputes (Phase 12b): moods come with reasons and stay
 * in range, their effects are small, unhappy players ask more to stay, an underpaid star can
 * hold out, hold in or ask out and his team answers with a reason, and camp fines follow the CBA.
 */
import { describe, expect, it } from "vitest";
import { addDays } from "@fgm/foundation";
import { createLeague } from "../generate/league";
import type { League, Player } from "../league/schema";
import { parseLeague, serializeLeague } from "../serialize";
import { advance } from "../season/flow";
import { minimumSalary } from "../contracts/cap";
import { marketValue } from "../contracts/market";
import { demandFor } from "../contracts/negotiation";
import { campCandidates, endCampDisputes, startDispute } from "./disputes";
import {
  MORALE,
  moodTarget,
  moraleDevelopment,
  moraleGamePoints,
  teamChemistry,
  updateMoods,
} from "./morale";
import { disputesView, lockerRoomView } from "./views";

// A new league on free agency day 1 (trading is open), with moods filled in.
const DAY_ONE = (() => {
  const l = createLeague({ seed: 53, name: "Moods" });
  advance(l);
  updateMoods(l, 1);
  return serializeLeague(l);
})();
const dayOne = (): League => parseLeague(DAY_ONE);

const onTeams = (l: League) =>
  l.players.filter((p) => p.teamId !== null && p.retiredAfter === null);

/** The best-paid-by-market starter on a team, made into an underpaid, unhappy star. */
function underpaidStar(l: League): Player {
  const p = onTeams(l)
    .filter((x) => x.contract && x.contract.type !== "rookie" && x.position === "QB")
    .sort((a, b) => marketValue(l, b).apy - marketValue(l, a).apy || a.id - b.id)[0]!;
  const year = { ...p.contract!.years[0]!, season: l.season };
  const minimum = minimumSalary(l.rules.cap, l.season, p.experience);
  p.contract = {
    ...p.contract!,
    type: "veteran",
    signedOn: l.date,
    bonuses: [],
    years: [
      {
        ...year,
        base: minimum * 2,
        guaranteed: 0,
        injuryGuaranteed: 0,
        rosterBonus: 0,
        workoutBonus: 0,
        perGameBonus: 0,
        incentives: [],
        void: false,
      },
    ],
  };
  p.personality = {
    ...p.personality,
    ego: 90,
    temperament: 30,
    loyalty: 20,
    priorities: { money: 55, winning: 15, role: 15, location: 15 },
  };
  updateMoods(l, 1);
  return p;
}

describe("moods", () => {
  it("every player on a team has a mood in range, with reasons", () => {
    const l = dayOne();
    const players = onTeams(l);
    expect(players.every((p) => p.mood !== null)).toBe(true);
    const scores = players.map((p) => p.mood!.score);
    expect(Math.min(...scores)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...scores)).toBeLessThanOrEqual(100);
    const mean = scores.reduce((s, x) => s + x, 0) / scores.length;
    // Centered near content, so its effects net out across the league.
    expect(mean).toBeGreaterThan(42);
    expect(mean).toBeLessThan(58);
    expect(players.some((p) => p.mood!.factors.some((f) => f.key === "pay"))).toBe(true);
    // Free agents have none.
    expect(l.players.filter((p) => p.teamId === null).every((p) => p.mood === null)).toBe(true);
  });

  it("are the same however many times they're computed (no random draws)", () => {
    const l = dayOne();
    const p = onTeams(l)[10]!;
    expect(moodTarget(l, p)).toEqual(moodTarget(l, p));
  });

  it("an underpaid star with a big ego is unhappy, mostly about pay", () => {
    const l = dayOne();
    const p = underpaidStar(l);
    expect(p.mood!.score).toBeLessThan(40);
    const worst = [...p.mood!.factors].sort((a, b) => a.points - b.points)[0]!;
    expect(worst.key).toBe("pay");
  });

  it("have small effects: at most about a point on game day, a few percent on development", () => {
    const l = dayOne();
    for (const p of onTeams(l).slice(0, 200)) {
      expect(Math.abs(moraleGamePoints(p, 100))).toBeLessThanOrEqual(1.0001);
      expect(Math.abs(moraleGamePoints(p, 0))).toBeLessThanOrEqual(1.0001);
      expect(Math.abs(moraleDevelopment(p) - 1)).toBeLessThanOrEqual(MORALE.development + 1e-9);
    }
  });

  it("an unhappy player asks his own team for more", () => {
    const l = dayOne();
    const p = onTeams(l).find((x) => x.contract && marketValue(l, x).share > 0.02)!;
    p.mood = { score: 80, factors: [] };
    const happy = demandFor(l, p, p.teamId).apy;
    p.mood = { score: 10, factors: [] };
    const unhappy = demandFor(l, p, p.teamId).apy;
    expect(unhappy).toBeGreaterThan(happy);
    expect(demandFor(l, p, p.teamId).reasons.join(" ")).toMatch(/Unhappy where he is/);
  });
});

describe("the locker room", () => {
  it("chemistry is a 0-100 score with leaders, and the screen explains it", () => {
    const l = dayOne();
    const scores = l.teams.map((t) => teamChemistry(l, t.id).score);
    expect(Math.min(...scores)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...scores)).toBeLessThanOrEqual(100);
    const view = lockerRoomView(l, l.teams[0]!.id, { kind: "league" });
    expect(view.leaders.length).toBe(5);
    expect(view.rank).toBeGreaterThanOrEqual(1);
    expect(Math.abs(view.gamePoints)).toBeLessThanOrEqual(MORALE.gameChemistry);
  });
});

describe("contract disputes", () => {
  it("an underpaid star in a bad mood is a camp candidate", () => {
    const l = dayOne();
    const p = underpaidStar(l);
    expect(campCandidates(l).map((x) => x.id)).toContain(p.id);
  });

  it("when he holds out, his team answers with a reason: extend, trade or wait", () => {
    const l = dayOne();
    const p = underpaidStar(l);
    const team = p.teamId;
    const d = startDispute(l, p, "holdout", "Wants a new deal.");
    expect(d.response.length).toBeGreaterThan(10);
    if (d.outcome === "extended") {
      expect(p.contract!.type).toBe("extension");
      expect(marketValue(l, p).apy).toBeGreaterThan(0);
    } else if (d.outcome === "traded") {
      expect(p.teamId).not.toBe(team);
    } else {
      expect(d.end).toBeNull();
      expect(d.response).toMatch(/Waiting him out/);
    }
    expect(l.transactions.some((t) => t.type === "dispute" && t.playerIds.includes(p.id))).toBe(
      true,
    );
    // Shown on the league's disputes screen.
    const view = disputesView(l);
    expect([...view.open, ...view.recent].some((r) => r.playerId === p.id)).toBe(true);
  });

  it("a trade request from a star the team won't pay ends in a trade or a wait, never silence", () => {
    const l = dayOne();
    const p = underpaidStar(l);
    const d = startDispute(l, p, "trade-request", "Unhappy with his pay.");
    expect(["extended", "traded", null]).toContain(d.outcome);
    expect(d.response).not.toBe("");
  });

  it("a holdout who reports is fined for each day he missed (CBA Article 42)", () => {
    const l = dayOne();
    const p = onTeams(l).find((x) => x.contract && x.contract.type === "veteran")!;
    l.disputes.push({
      playerId: p.id,
      teamId: p.teamId!,
      season: l.season,
      kind: "holdout",
      start: l.date,
      reason: "Wants a new deal.",
      fines: 0,
      end: null,
      outcome: null,
      response: "",
    });
    l.date = addDays(l.date, 10);
    endCampDisputes(l);
    const d = l.disputes.at(-1)!;
    expect(d.outcome).toBe("reported");
    expect(d.fines).toBe(10 * l.rules.freeAgency.campFinePerDay.veteran);
  });
});

describe("saves", () => {
  it("a format-15 save loads with no moods yet and no disputes", () => {
    const old = JSON.parse(DAY_ONE);
    old.formatVersion = 15;
    delete old.disputes;
    for (const p of old.players) delete p.mood;
    const upgraded = parseLeague(JSON.stringify(old));
    expect(upgraded.disputes).toEqual([]);
    expect(upgraded.players.every((p) => p.mood === null)).toBe(true);
  });
});
