/**
 * Assembling a league from real facts (Phase 6). The real data stays on the
 * owner's machine, so these tests feed in a played fictional season instead:
 * the same path the pipeline takes.
 */
import { overallAt } from "@fgm/foundation";
import { describe, expect, it } from "vitest";
import { createLeague } from "./generate/league";
import { NamePicker } from "./generate/people";
import { Rng } from "@fgm/foundation";
import type { League } from "./league/schema";
import {
  assembleRealLeague,
  startRealLeague,
  type RealCoachInput,
  type RealGameInput,
  type RealLeagueInput,
  type RealPlayerInput,
} from "./realLeague";
import { parseLeague, serializeLeague } from "./serialize";
import { advanceUntil } from "./season/flow";
import { winnerOf } from "./season/playoffs";
import { rosterProblems } from "./roster/legality";

/** A season "played for real": a fictional league's 2026 season, start to finish. */
const played = createLeague({ seed: 61, name: "Source" });
advanceUntil(played, (l) => l.calendar.stage === "complete");

function input(): RealLeagueInput {
  const players: RealPlayerInput[] = played.players.map((p, i) => ({
    key: `P${String(p.id).padStart(5, "0")}`,
    firstName: p.firstName,
    lastName: p.lastName,
    position: p.position,
    teamId: p.teamId,
    jersey: p.jersey,
    birthDate: p.birthDate,
    heightIn: p.heightIn,
    weightLb: p.weightLb,
    experience: p.experience,
    college: p.college,
    drafted: p.drafted,
    // Every tenth player has no rating source and gets ratings around a target.
    ratings: i % 10 === 0 ? { targetOverall: 64 } : p.ratings,
    contractThrough: null,
  }));
  // Real staffs for half the league; the rest of the jobs are filled with generated coaches.
  const coaches: RealCoachInput[] = played.teams.slice(0, 16).map((t) => ({
    key: `HC:${t.id}`,
    firstName: "Head",
    lastName: `Coach ${t.id}`,
    role: "HC",
    teamId: t.id,
    birthDate: "1970-05-01",
    experience: 20,
  }));
  const games: RealGameInput[] = played.games.map((g) => ({
    round: g.round,
    week: g.week,
    date: g.date,
    homeId: g.homeId,
    awayId: g.awayId,
    neutral: g.neutral,
    homeScore: g.result!.homeScore,
    awayScore: g.result!.awayScore,
    homeTouchdowns: g.result!.homeTouchdowns,
    awayTouchdowns: g.result!.awayTouchdowns,
    overtime: g.result!.overtime,
  }));
  return {
    name: "Real",
    seed: 7,
    source: "test",
    season: played.season,
    players,
    coaches,
    games,
    names: new NamePicker(new Rng(1)),
  };
}

describe("assembling a real league", () => {
  const league: League = assembleRealLeague(input());

  it("starts the league year after the real season, with that season in History", () => {
    expect(league.season).toBe(played.season + 1);
    expect(league.calendar.stage).toBe("offseason");
    const real = played.history.at(-1)!;
    const ours = league.history.at(-1)!;
    expect(ours.season).toBe(played.season);
    const final = played.games.find((g) => g.round === "championship")!;
    expect(ours.championId).toBe(winnerOf(final));
    expect(ours.standings.map((s) => [s.teamId, s.wins, s.losses, s.seed])).toEqual(
      real.standings.map((s) => [s.teamId, s.wins, s.losses, s.seed]),
    );
    expect(ours.draftOrder).toEqual(real.draftOrder);
    expect(league.games.filter((g) => g.round === "regular")).toHaveLength(272);
  });

  it("keeps given ratings exactly and generates the rest near their target", () => {
    // Players are assembled in key order (the source's id order); generated fill-ins come after.
    played.players.forEach((source, i) => {
      const p = league.players[i]!;
      expect(p.lastName).toBe(source.lastName);
      if (i % 10 === 0) expect(Math.abs(overallAt(p.ratings, p.position) - 64)).toBeLessThan(8);
      else expect(p.ratings).toEqual(source.ratings);
    });
  });

  it("every team has a full staff: real coaches where known, generated ones elsewhere", () => {
    for (const team of league.teams)
      for (const role of ["HC", "OC", "DC", "STC"] as const)
        expect(league.coaches.filter((c) => c.teamId === team.id && c.role === role)).toHaveLength(
          1,
        );
    const real = league.coaches.find((c) => c.lastName === `Coach ${league.teams[0]!.id}`)!;
    expect(real.experience).toBe(20);
    expect(real.birthDate).toBe("1970-05-01");
  });

  it("is the same every time, and saves and loads identically", () => {
    const text = serializeLeague(league);
    expect(serializeLeague(assembleRealLeague(input()))).toBe(text);
    expect(serializeLeague(parseLeague(text))).toBe(text);
    expect(league.meta.kind).toBe("real");
  });

  it("each new game from the file gets its own name and seed, and plays out differently", () => {
    const a = startRealLeague(league, { name: "A", seed: 1 });
    const b = startRealLeague(league, { name: "B", seed: 2 });
    expect(a.meta).toMatchObject({ name: "A", seed: 1, kind: "real" });
    advanceUntil(a, (l) => l.calendar.stage === "regular" && l.calendar.week === 2);
    advanceUntil(b, (l) => l.calendar.stage === "regular" && l.calendar.week === 2);
    const scores = (l: League) =>
      l.games
        .filter((g) => g.week === 1)
        .map((g) => `${g.result?.homeScore}-${g.result?.awayScore}`);
    expect(scores(a)).not.toEqual(scores(b));
    expect(() => startRealLeague(played, { name: "X", seed: 1 })).toThrow(/real-league/);
    // Two offseasons (free agency, the draft, camp) and a week each: longer than the default.
  }, 180_000);
});

describe("the first day of a real league (Phase 16)", () => {
  const base: League = assembleRealLeague(input());

  it("the file keeps the real season's games; a new game plays its own carousel and drops them", () => {
    expect(base.priorSeason?.season).toBe(played.season);
    expect(base.priorSeason?.games).toHaveLength(played.games.length);
    const game = startRealLeague(base, { name: "G", seed: 3 });
    expect(game.priorSeason).toBeNull();
    // The carousel borrowed the calendar and gave it back.
    expect(game.season).toBe(base.season);
    expect(game.calendar).toEqual(base.calendar);
    expect(game.date).toBe(base.date);
    expect(game.games).toEqual(base.games);
  });

  it("the starting carousel is the same for a seed and differs across seeds", () => {
    const moves = (seed: number) => {
      const g = startRealLeague(base, { name: "G", seed });
      return JSON.stringify([g.coachingMoves, g.executiveMoves]);
    };
    expect(moves(5)).toBe(moves(5));
    const runs = [1, 2, 3, 4, 5, 6].map(moves);
    expect(new Set(runs).size).toBeGreaterThan(1);
    // Real leagues change about seven head coaches a year; across six games something happens.
    expect(runs.some((r) => JSON.parse(r)[0].length > 0)).toBe(true);
  });

  it("every team has a head coach after the carousel, and the league stays legal", () => {
    for (const seed of [11, 12, 13]) {
      const g = startRealLeague(base, { name: "G", seed });
      for (const t of g.teams)
        expect(
          g.coaches.filter((c) => c.teamId === t.id && c.role === "HC"),
          t.id,
        ).toHaveLength(1);
      expect(rosterProblems(g)).toEqual([]);
    }
  });

  it("uses the real schedule and moves later picks that were traded before the start", () => {
    const generated = createLeague({ seed: 62, name: "Sched" });
    const real = generated.games.map((g) => ({
      week: g.week,
      date: g.date.replace("2026", "2027"),
      homeId: g.awayId, // flipped, so it can't be the league's own schedule by accident
      awayId: g.homeId,
      neutral: g.neutral,
    }));
    const [a, b] = base.teams.map((t) => t.id) as [string, string];
    const league = assembleRealLeague({
      ...input(),
      schedule: real,
      pickTrades: [
        { id: 1, date: "2026-01-20", season: base.season + 1, round: 1, from: a, to: b },
      ],
    });
    const ours = league.games.filter((g) => g.round === "regular");
    expect(ours.map((g) => [g.week, g.homeId, g.awayId])).toEqual(
      real.map((g) => [g.week, g.homeId, g.awayId]),
    );
    const firsts = (team: string) =>
      league.draftPicks.filter(
        (p) => p.season === base.season + 1 && p.round === 1 && p.ownerTeamId === team,
      ).length;
    expect(firsts(a)).toBe(0);
    expect(firsts(b)).toBe(2);
    expect(() => assembleRealLeague({ ...input(), schedule: real.slice(1) })).toThrow(/schedule/);
  });
});
