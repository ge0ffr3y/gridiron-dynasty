/**
 * Phase 4a: individual matchups matter. Each test plays a few hundred games
 * between synthetic teams that differ in one way, with the same seeds.
 */
import { overallAt, Rng, type Ratings } from "@fgm/foundation";
import { describe, expect, it } from "vitest";
import { simulateGame } from "./engine";
import { makeLineup, TEST_RULES } from "./testLineups";
import type { GameOutput, Lineup, LineupPlayer, Play, Side, TeamInput } from "./types";

const GAMES = 300;

function play(home: TeamInput, away: TeamInput, seed: number): GameOutput {
  return simulateGame(
    { home, away, neutral: true, playoff: false, rules: TEST_RULES },
    new Rng(seed),
  );
}

/** Plays every seed and returns the games. */
function series(home: () => TeamInput, away: () => TeamInput): GameOutput[] {
  return Array.from({ length: GAMES }, (_, i) => play(home(), away(), 5000 + i));
}

/** A copy of a player with some ratings raised. */
function boosted(p: LineupPlayer, keys: (keyof Ratings)[], by: number): LineupPlayer {
  const ratings = { ...p.ratings };
  for (const k of keys) ratings[k] = Math.min(99, ratings[k] + by);
  return { ...p, ratings, overall: overallAt(ratings, p.position) };
}

/** Totals for one side's offense across many games. */
function offense(games: GameOutput[], side: Side) {
  let points = 0;
  let dropbacks = 0;
  let sacks = 0;
  let attempts = 0;
  let completions = 0;
  let bigPlays = 0;
  for (const g of games) {
    points += side === "home" ? g.homeScore : g.awayScore;
    for (const p of g.plays as Play[]) {
      if (p.offense !== side || p.noPlay) continue;
      if (p.kind === "pass" || p.kind === "sack" || p.kind === "scramble") dropbacks += 1;
      if (p.kind === "sack") sacks += 1;
      if (p.kind === "pass" && !p.throwAway) {
        attempts += 1;
        if (p.complete) completions += 1;
      }
      if (p.kind === "pass" && p.complete && p.yards >= 20) bigPlays += 1;
    }
  }
  return {
    pointsPerGame: points / games.length,
    sackRate: sacks / dropbacks,
    completionPct: completions / attempts,
    /** Completions of 20+ yards per pass attempt (the real data's "explosive" rate). */
    explosiveRate: bigPlays / attempts,
  };
}

const team = (id: string, lineup: Lineup, extra: Partial<TeamInput> = {}): TeamInput => ({
  id,
  lineup,
  ...extra,
});

describe("matchups", () => {
  it("an elite quarterback raises a weak team's scoring", () => {
    const opponent = () => team("OPP", makeLineup(0, 100));
    const weak = () => team("WEAK", makeLineup(-8, 1));
    const withStar = () => {
      const lineup = makeLineup(-8, 1);
      lineup.qb = boosted(
        lineup.qb,
        [
          "throwAccuracyShort",
          "throwAccuracyDeep",
          "throwPower",
          "decisionMaking",
          "awareness",
          "composure",
        ],
        25,
      );
      return team("WEAK", lineup);
    };
    const before = offense(series(weak, opponent), "home");
    const after = offense(series(withStar, opponent), "home");
    expect(after.pointsPerGame - before.pointsPerGame).toBeGreaterThan(2);
    expect(after.completionPct).toBeGreaterThan(before.completionPct + 0.02);
  });

  it("a blitz-heavy defense gets more sacks and gives up more big plays", () => {
    const offenseTeam = () => team("OFF", makeLineup(0, 1));
    const normal = () => team("DEF", makeLineup(0, 100));
    const blitzing = () => team("DEF", makeLineup(0, 100), { defenseStyle: { extraBlitz: 1 } });
    const vsNormal = offense(series(offenseTeam, normal), "home");
    const vsBlitz = offense(series(offenseTeam, blitzing), "home");
    // Real NFL: sacks rise ~20% per extra rusher; this defense blitzes about two snaps in three.
    expect(vsBlitz.sackRate).toBeGreaterThan(vsNormal.sackRate * 1.05);
    expect(vsBlitz.explosiveRate).toBeGreaterThan(vsNormal.explosiveRate * 1.05);
  });

  it("better coverage lowers completion percentage", () => {
    const offenseTeam = () => team("OFF", makeLineup(0, 1));
    const normal = () => team("DEF", makeLineup(0, 100));
    const coverage = () => {
      const lineup = makeLineup(0, 100);
      const keys: (keyof Ratings)[] = ["manCoverage", "zoneCoverage", "ballSkills", "speed"];
      lineup.cb = lineup.cb.map((p) => boosted(p, keys, 15));
      lineup.s = lineup.s.map((p) => boosted(p, keys, 15));
      lineup.lb = lineup.lb.map((p) => boosted(p, keys, 15));
      return team("DEF", lineup);
    };
    const vsNormal = offense(series(offenseTeam, normal), "home");
    const vsCoverage = offense(series(offenseTeam, coverage), "home");
    expect(vsCoverage.completionPct).toBeLessThan(vsNormal.completionPct - 0.02);
  });
});

describe("penalties", () => {
  const games = Array.from({ length: 200 }, (_, i) =>
    play(team("HOME", makeLineup(0, 1)), team("AWAY", makeLineup(0, 100)), 9000 + i),
  );
  const fouls = games.flatMap((g) =>
    g.plays.map((p, i) => ({ p, next: g.plays.slice(i + 1).find((n) => n.kind !== "timeout") })),
  );
  const withPenalty = fouls.filter(({ p }) => p.penalty);

  it("happen at a realistic rate, and both teams get flagged", () => {
    const accepted = withPenalty.filter(({ p }) => p.penalty!.accepted);
    const perTeamGame = accepted.length / (games.length * 2);
    expect(perTeamGame).toBeGreaterThan(4.5);
    expect(perTeamGame).toBeLessThan(7.5);
    expect(accepted.some(({ p }) => p.penalty!.team === p.offense)).toBe(true);
    expect(accepted.some(({ p }) => p.penalty!.team !== p.offense)).toBe(true);
  });

  it("the defense never declines an offensive foul on a play that gained a first down", () => {
    const declined = withPenalty.filter(
      ({ p }) => !p.penalty!.accepted && p.penalty!.team === p.offense,
    );
    expect(declined.length).toBeGreaterThan(0);
    for (const { p } of declined) {
      expect(p.firstDown ?? false).toBe(false);
      expect(p.touchdown === p.offense).toBe(false);
    }
  });

  it("the offense never declines a defensive foul that would wipe out its own turnover", () => {
    const declined = withPenalty.filter(
      ({ p }) => !p.penalty!.accepted && p.penalty!.team !== p.offense,
    );
    expect(declined.length).toBeGreaterThan(0);
    for (const { p } of declined) {
      expect(p.intercepted ?? false).toBe(false);
      expect(p.fumble?.lost ?? false).toBe(false);
    }
  });

  it("an accepted foul that wipes out the play moves the ball by the penalty yards", () => {
    const wiped = withPenalty.filter(
      ({ p, next }) =>
        p.penalty!.accepted &&
        p.noPlay &&
        next !== undefined &&
        next.offense === p.offense &&
        next.quarter === p.quarter &&
        (next.kind === "run" || next.kind === "pass" || next.kind === "penalty"),
    );
    expect(wiped.length).toBeGreaterThan(100);
    for (const { p, next } of wiped) {
      const moved = p.yardsToGoal - next!.yardsToGoal;
      const expected = p.penalty!.team === p.offense ? -p.penalty!.yards : p.penalty!.yards;
      expect(moved === expected).toBe(true);
    }
  });

  it("a defensive foul that gives a first down is marked as one", () => {
    const firstDowns = withPenalty.filter(
      ({ p, next }) =>
        p.penalty!.accepted &&
        p.noPlay &&
        p.penalty!.team !== p.offense &&
        next !== undefined &&
        next.offense === p.offense &&
        next.down === 1 &&
        p.down > 1,
    );
    expect(firstDowns.length).toBeGreaterThan(0);
    for (const { p } of firstDowns) expect(p.firstDown).toBe(true);
  });
});
