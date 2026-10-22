/**
 * The league stays legal (CLAUDE.md rule 9; Phase 8's "Done when"): ten full
 * League Years (draft, camp, preseason, final cuts, the season and playoffs)
 * with every roster and cap rule checked after every move, every rostered
 * player under contract with his own team, and every move carrying a reason.
 * The same years check the player lifecycle (Phase 9): age mix, starter quality,
 * stars and career arcs stay in their bands. Old saves upgrade with contracts.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createLeague } from "../generate/league";
import { lifecycleSnapshot, realAgeMix, type LifecycleSnapshot } from "../lifecycle/report";
import { LEAGUE_FORMAT_VERSION } from "../league/schema";
import { checkLegal, rosterProblems } from "../roster/legality";
import { onTeam } from "../roster/lists";
import { parseLeague, serializeLeague } from "../serialize";
import { advance } from "../season/flow";
import { validateSchedule } from "../season/validate";
import { setTransactionAudit } from "./operations";
import { capSheet } from "./team";

afterEach(() => setTransactionAudit(null));

/** How far a 10-season league may drift (Phase 9's "Done when"; 30 seasons: npm run sim -- --lifecycle 30). */
const LIFECYCLE_BANDS = {
  /** Mean age of players who played, vs. the real league's (years). */
  ageMean: 0.75,
  /** Average starter overall, vs. the first season (points). */
  starterDrift: 2.5,
  /** Players rated 80 or better on rosters, at least. */
  minEighties: 120,
};

describe("a league stays legal year after year", () => {
  it("10 League Years: every roster and cap rule holds after every move", () => {
    const league = createLeague({ seed: 81, name: "Legal" });
    expect(rosterProblems(league)).toEqual([]);
    setTransactionAudit(checkLegal);
    const rooms: number[] = [];
    const snapshots: LifecycleSnapshot[] = [];
    let lastHeads: Map<string, number> | null = null;
    const headChanges: number[] = [];
    let seasons = 0;
    for (let step = 0; step < 800 && seasons < 10; step++) {
      advance(league);
      // The audit already ran after every move; also check between steps.
      expect(rosterProblems(league), `${league.date}`).toEqual([]);
      if (league.calendar.stage === "free-agency")
        for (const t of league.teams)
          rooms.push(
            capSheet(league, t.id, league.season).room / capSheet(league, t.id, league.season).cap,
          );
      // Phase 10b: each season opens with one head coach per team; count changes from last year.
      if (league.calendar.stage === "regular" && league.calendar.week === 1) {
        const heads = new Map(
          league.coaches.filter((c) => c.role === "HC" && c.teamId).map((c) => [c.teamId!, c.id]),
        );
        expect(heads.size).toBe(league.teams.length);
        if (lastHeads)
          headChanges.push([...heads].filter(([t, id]) => lastHeads!.get(t) !== id).length);
        lastHeads = heads;
      }
      if (league.calendar.stage === "regular" && league.calendar.week === 1)
      // Final cuts left every team with 53, and nearly every one with a practice squad (a team in
      // cap trouble may not afford one: legal, and real).
      {
        for (const t of league.teams) expect(onTeam(league, t.id, "active").length, t.id).toBe(53);
        const squads = league.teams.filter(
          (t) => onTeam(league, t.id, "practice-squad").length > 0,
        );
        expect(squads.length, `${league.season}`).toBeGreaterThanOrEqual(league.teams.length - 2);
      }
      if (league.calendar.stage === "complete") {
        seasons += 1;
        snapshots.push(lifecycleSnapshot(league));
      }
      // Each new season's schedule follows every scheduling rule.
      if (league.calendar.stage === "offseason" && league.games.every((g) => !g.result)) {
        const last = league.history.at(-1)!;
        expect(
          validateSchedule(
            league.rules,
            league.season,
            league.teams,
            league.games,
            new Map(last.standings.map((s) => [s.teamId, s.divisionRank])),
          ),
        ).toEqual([]);
      }
    }
    expect(seasons).toBe(10);
    // Teams use their cap: typical room stays a modest share of it.
    rooms.sort((a, b) => a - b);
    expect(rooms[Math.floor(rooms.length / 2)]!).toBeLessThan(0.35);
    // Every move recorded a reason, and rookies arrived every year.
    expect(league.transactions.every((t) => t.reason.length > 0)).toBe(true);
    expect(
      new Set(league.players.filter((p) => p.drafted).map((p) => p.drafted!.season)).size,
    ).toBeGreaterThanOrEqual(10);

    // Phase 10b: head-coach turnover near the real 7.2 a year (a band for nine changeovers).
    const meanChanges = headChanges.reduce((a, b) => a + b, 0) / headChanges.length;
    expect(headChanges.length).toBeGreaterThanOrEqual(8);
    expect(meanChanges).toBeGreaterThan(3);
    expect(meanChanges).toBeLessThan(12);

    // Phase 9: players develop, age and retire, and the league keeps its shape. The age mix
    // stays near the real league's, starters neither inflate nor collapse, and stars remain.
    const real = realAgeMix();
    const first = snapshots[0]!;
    for (const snap of snapshots) {
      expect(Math.abs(snap.age.mean - real.mean), `${snap.season} age`).toBeLessThan(
        LIFECYCLE_BANDS.ageMean,
      );
      expect(
        Math.abs(snap.starterOverall - first.starterOverall),
        `${snap.season} starters`,
      ).toBeLessThan(LIFECYCLE_BANDS.starterDrift);
      expect(snap.stars.eighty, `${snap.season} stars`).toBeGreaterThan(
        LIFECYCLE_BANDS.minEighties,
      );
    }
    // Careers have arcs: players with long careers had their best season in their prime.
    const bestAges = league.players
      .filter((p) => p.ratingHistory.length >= 6)
      .map((p) => p.ratingHistory.reduce((a, b) => (b.overall > a.overall ? b : a)).age)
      .sort((a, b) => a - b);
    expect(bestAges.length).toBeGreaterThan(300);
    const median = bestAges[Math.floor(bestAges.length / 2)]!;
    expect(median).toBeGreaterThanOrEqual(25);
    expect(median).toBeLessThanOrEqual(29);
  }, 1_200_000);

  it("a format-6 save loads with contracts for everyone on a roster, the same every time", () => {
    const league = createLeague({ seed: 82, name: "Old" });
    const old = JSON.parse(serializeLeague(league));
    old.formatVersion = 6;
    for (const t of old.teams) delete t.cap;
    for (const p of old.players)
      p.contract = p.teamId ? { teamId: p.teamId, expiresAfterSeason: 2027 } : null;
    delete old.salaryHistory;
    delete old.rules.cap;
    const text = JSON.stringify(old);
    const upgraded = parseLeague(text);
    expect(upgraded.formatVersion).toBe(LEAGUE_FORMAT_VERSION);
    expect(rosterProblems(upgraded)).toEqual([]);
    expect(upgraded.salaryHistory.length).toBeGreaterThan(0);
    expect(serializeLeague(parseLeague(text))).toBe(serializeLeague(upgraded));
  });
});
