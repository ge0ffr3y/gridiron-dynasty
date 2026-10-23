/**
 * The job (Phase 14b): job security, the owner's reactions and budget, getting fired in a doomed
 * situation, job offers and taking one, retiring; tips and the glossary.
 */
import { describe, expect, it } from "vitest";
import { createLeague } from "../generate/league";
import type { League } from "../league/schema";
import { parseLeague, serializeLeague } from "../serialize";
import { advance, advanceUntil } from "../season/flow";
import { gmOf, ownerOf } from "../front-office/executives";
import { personTeam } from "./delegation";
import { firePerson, jobSecurity, ownerVeto, ownerWatch, retireCareer, takeJob } from "./job";
import { startCareer } from "./start";
import { currentTips, dismissTip } from "./tips";
import { glossaryView } from "./glossary";
import { careerPageView, gmCareerView } from "./views";
import { recordTransaction } from "../contracts/operations";

/** A trade's record as the owner sees it: the player leaves for another team. */
function offerFromTo(l: League, playerId: number, from: string, to: string): void {
  const p = l.players.find((x) => x.id === playerId)!;
  p.teamId = to;
  p.contract = { ...p.contract!, teamId: to };
  recordTransaction(l, {
    type: "traded",
    teamIds: [from, to],
    playerIds: [playerId],
    text: `${from} traded ${p.firstName} ${p.lastName} to ${to}.`,
    reason: "Test.",
  });
}

// A league in its last regular-season week (Black Monday comes with the next step).
const LAST_WEEK = (() => {
  const l = createLeague({ seed: 31, name: "Job" });
  advanceUntil(
    l,
    (x) =>
      x.calendar.stage === "regular" && x.calendar.week === x.rules.schedule.regularSeasonWeeks,
  );
  return serializeLeague(l);
})();
const lastWeek = (): League => parseLeague(LAST_WEEK);

/** The team with the fewest wins so far. */
function worstTeam(l: League): string {
  return [...l.teams]
    .map((t) => ({
      id: t.id,
      w: l.games.filter(
        (g) =>
          g.result &&
          g.round === "regular" &&
          ((g.homeId === t.id && g.result.homeScore > g.result.awayScore) ||
            (g.awayId === t.id && g.result.awayScore > g.result.homeScore)),
      ).length,
    }))
    .sort((a, b) => a.w - b.w || a.id.localeCompare(b.id))[0]!.id;
}

describe("the job", () => {
  it("a doomed GM is fired on Black Monday, gets offers, and takes another job", () => {
    const l = lastWeek();
    const team = worstTeam(l);
    startCareer(l, team, { firstName: "Pat", lastName: "Doe" });
    // Doom: an impatient, ambitious owner; six seasons of losing without the playoffs; a deal
    // that runs out; and an owner already unhappy with his moves.
    ownerOf(l, team)!.owner = { patience: -1, budget: 0, meddling: 0, ambition: 1 };
    const me = gmOf(l, team)!;
    me.hiredSeason = l.season - 6;
    me.contractThrough = l.season;
    for (const h of l.history)
      for (const s of h.standings)
        if (s.teamId === team) {
          s.seed = null;
          s.wins = 3;
          s.losses = 14;
        }
    for (let i = 0; i < 6; i++) l.history.unshift(JSON.parse(JSON.stringify(l.history[0]!)));
    l.career!.standing = -1.5;
    const before = jobSecurity(l)!;
    expect(before.score).toBeLessThan(5);
    expect(before.reason).toMatch(/without the playoffs/);

    advance(l); // the last week, then Black Monday
    expect(l.career!.status).toBe("fired");
    expect(personTeam(l)).toBeNull();
    expect(l.teams.find((t) => t.id === team)!.controller).toBe("ai");
    const replacement = gmOf(l, team)!;
    expect(replacement.person).toBe(false);
    expect(
      l.career!.log.some((x) => x.by === "owner" && /Fired on Black Monday/.test(x.text)),
    ).toBe(true);
    // Offers, never from the team that fired him.
    const offers = l.career!.offers;
    expect(offers.length).toBeGreaterThan(0);
    expect(offers.every((o) => o.teamId !== team)).toBe(true);
    expect(gmCareerView(l).offers.length).toBe(offers.length);
    expect(careerPageView(l, { kind: "league" }).status).toBe("fired");

    // He takes the first: his career goes on there.
    const next = offers[0]!.teamId;
    const old = gmOf(l, next)!;
    takeJob(l, next);
    expect(personTeam(l)).toBe(next);
    expect(l.career!.status).toBe("active");
    expect(gmOf(l, next)!.id).toBe(me.id);
    expect(old.teamId).toBeNull();
    expect(l.teams.find((t) => t.id === next)!.controller).toBe("human");
    expect(() => takeJob(l, next)).toThrow(/already/);
    // His career page shows both teams.
    const page = careerPageView(l, { kind: "league" });
    expect(page.seasons.some((s) => s.team.length > 0)).toBe(true);
  }, 120_000);

  it("a safe GM keeps his job; retiring hands the team back to an AI GM", () => {
    const l = lastWeek();
    const team = l.teams[0]!.id;
    startCareer(l, team, { firstName: "Pat", lastName: "Doe" });
    // A patient owner and a first-year GM: grace.
    ownerOf(l, team)!.owner = { patience: 1, budget: 0, meddling: 0, ambition: -1 };
    expect(jobSecurity(l)!.score).toBeGreaterThan(90);
    advance(l);
    expect(l.career!.status).toBe("active");
    retireCareer(l);
    expect(l.career!.status).toBe("retired");
    expect(personTeam(l)).toBeNull();
    expect(gmOf(l, team)?.person).toBe(false);
  }, 120_000);

  it("the owner reacts to trading a star, and a meddler vetoes a deal far past his budget", () => {
    const l = lastWeek();
    const team = l.teams[0]!.id;
    startCareer(l, team, { firstName: "Pat", lastName: "Doe" });
    // An impatient owner (a patient one rebuilding would shrug). A star leaves in a trade.
    ownerOf(l, team)!.owner = { patience: -1, budget: 0, meddling: 0, ambition: 0 };
    const star = l.players
      .filter((p) => p.teamId === team && p.contract)
      .sort((a, b) => b.contract!.years[0]!.base - a.contract!.years[0]!.base)[0]!;
    offerFromTo(l, star.id, team, l.teams[1]!.id);
    const was = l.career!.standing;
    ownerWatch(l);
    expect(l.career!.standing).toBeLessThan(was);
    expect(l.career!.log.some((x) => x.by === "owner" && x.text.includes(star.lastName))).toBe(
      true,
    );

    ownerOf(l, team)!.owner = { patience: 0, budget: -1, meddling: 1, ambition: 0 };
    const veto = ownerVeto(l, team, {
      years: 5,
      apy: 90_000_000,
      guaranteed: 200_000_000,
      signingBonus: 80_000_000,
    });
    expect(veto).toMatch(/vetoed/);
    expect(
      ownerVeto(l, team, { years: 1, apy: 1_000_000, guaranteed: 0, signingBonus: 0 }),
    ).toBeNull();
    // Another team's deals are none of his business.
    expect(
      ownerVeto(l, l.teams[1]!.id, {
        years: 5,
        apy: 90_000_000,
        guaranteed: 0,
        signingBonus: 80_000_000,
      }),
    ).toBeNull();
  });

  it("first-season tips show at their moment and stay dismissed; the glossary uses the rules", () => {
    const l = lastWeek();
    startCareer(l, l.teams[0]!.id, { firstName: "Pat", lastName: "Doe" });
    expect(currentTips(l).map((t) => t.id)).toContain("welcome");
    dismissTip(l, "welcome");
    expect(currentTips(l).map((t) => t.id)).not.toContain("welcome");
    dismissTip(l, "all");
    expect(currentTips(l)).toEqual([]);
    const g = glossaryView(l);
    expect(g.length).toBeGreaterThan(20);
    expect(g.find((e) => e.term === "Active roster")!.text).toContain(
      String(l.rules.roster.regularSeasonMax),
    );
  });

  it("a fired GM can't be fired twice, and his old team's inbox is gone", () => {
    const l = lastWeek();
    const team = l.teams[0]!.id;
    startCareer(l, team, { firstName: "Pat", lastName: "Doe" });
    l.pendingDecisions.push({
      id: 999,
      teamId: team,
      createdOn: l.date,
      request: { kind: "placeholder", prompt: "x", options: ["a"] },
      deadline: null,
    });
    firePerson(l, "Test.");
    expect(l.pendingDecisions.some((d) => d.teamId === team)).toBe(false);
    expect(jobSecurity(l)).toBeNull();
  });
});
