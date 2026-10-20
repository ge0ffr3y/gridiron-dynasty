import { Rng } from "@fgm/foundation";
import { describe, expect, it } from "vitest";
import { simulateGame } from "./engine";
import { makeLineup, TEST_RULES } from "./testLineups";
import type { GameInput, GameOutput, Play, Side } from "./types";

function game(
  seed: number,
  opts: { playoff?: boolean; homeLevel?: number; awayLevel?: number } = {},
): GameOutput {
  const input: GameInput = {
    home: { id: "HOME", lineup: makeLineup(opts.homeLevel ?? 0, 1) },
    away: { id: "AWAY", lineup: makeLineup(opts.awayLevel ?? 0, 100) },
    neutral: false,
    playoff: opts.playoff ?? false,
    rules: TEST_RULES,
  };
  return simulateGame(input, new Rng(seed));
}

const GAMES = Array.from({ length: 150 }, (_, i) => game(1000 + i));
const SCRIMMAGE = new Set(["run", "pass", "sack", "scramble", "kneel", "spike"]);

/** Points from the plays themselves. */
function pointsFromPlays(plays: Play[]): Record<Side, number> {
  const pts: Record<Side, number> = { home: 0, away: 0 };
  for (const p of plays) {
    if (p.touchdown) pts[p.touchdown] += 6;
    if (p.kind === "extraPoint" && p.good) pts[p.offense] += 1;
    if (p.kind === "twoPoint" && p.good) pts[p.offense] += 2;
    if (p.kind === "fieldGoal" && p.good) pts[p.offense] += 3;
    if (p.safety) pts[p.offense === "home" ? "away" : "home"] += 2;
  }
  return pts;
}

describe("game engine", () => {
  it("same seed -> the identical game, play for play", () => {
    expect(JSON.stringify(game(7))).toBe(JSON.stringify(game(7)));
    expect(JSON.stringify(game(7))).not.toBe(JSON.stringify(game(8)));
  });

  it("the final score equals the sum of the scoring plays", () => {
    for (const g of GAMES) {
      const pts = pointsFromPlays(g.plays);
      expect(pts).toEqual({ home: g.homeScore, away: g.awayScore });
      expect(g.plays.at(-1)!.score).toEqual([g.homeScore, g.awayScore]);
    }
  });

  it("keeps the clock, downs, distance, and field position valid on every play", () => {
    for (const g of GAMES) {
      let lastQuarter = 1;
      for (const p of g.plays) {
        expect(p.clock).toBeGreaterThanOrEqual(0);
        expect(p.clock).toBeLessThanOrEqual(15 * 60);
        expect(p.quarter).toBeGreaterThanOrEqual(lastQuarter);
        lastQuarter = p.quarter;
        if (SCRIMMAGE.has(p.kind)) {
          expect(p.down).toBeGreaterThanOrEqual(1);
          expect(p.down).toBeLessThanOrEqual(4);
          expect(p.toGo).toBeGreaterThanOrEqual(1);
          expect(p.toGo).toBeLessThanOrEqual(p.yardsToGoal);
          expect(p.yardsToGoal).toBeGreaterThanOrEqual(1);
          expect(p.yardsToGoal).toBeLessThanOrEqual(99);
        }
      }
    }
  });

  it("credits the right players on every play", () => {
    for (const g of GAMES) {
      for (const p of g.plays) {
        if (p.kind === "run" || p.kind === "scramble" || p.kind === "kneel")
          expect(p.rusher).toBeDefined();
        if (p.kind === "pass") {
          expect(p.passer).toBeDefined();
          expect(p.receiver).toBeDefined();
        }
        if (p.kind === "sack") expect(p.defender).toBeDefined();
        if (p.intercepted) expect(p.defender).toBeDefined();
        if (p.kind === "punt" || p.kind === "fieldGoal" || p.kind === "extraPoint")
          expect(p.kicker).toBeDefined();
      }
    }
  });

  it("box score totals agree with the plays and the players", () => {
    for (const g of GAMES) {
      for (const side of ["home", "away"] as Side[]) {
        const team = g.box[side];
        const mine = g.box.players.filter((p) => p.side === side);
        const sum = (key: string) =>
          mine.reduce((s, p) => s + ((p.line as Record<string, number>)[key] ?? 0), 0);
        expect(team.points).toBe(side === "home" ? g.homeScore : g.awayScore);
        expect(sum("passYds") - sum("sackedYds")).toBe(team.passYards);
        expect(sum("rushYds")).toBe(team.rushYards);
        expect(sum("passCmp")).toBe(team.passCmp);
        expect(sum("recYds")).toBe(sum("passYds"));
        expect(team.totalYards).toBe(team.passYards + team.rushYards);
      }
      if (!g.overtime)
        expect(g.box.home.possessionSeconds + g.box.away.possessionSeconds).toBe(3600);
    }
  });

  it("playoff games always have a winner", () => {
    for (let i = 0; i < 150; i++) {
      const g = game(5000 + i, { playoff: true });
      expect(g.homeScore).not.toBe(g.awayScore);
    }
  });

  it("overtime: a first-possession touchdown doesn't end the game (both teams possess)", () => {
    let checked = 0;
    for (let i = 0; i < 2000 && checked < 5; i++) {
      const g = game(9000 + i);
      if (!g.overtime) continue;
      const ot = g.plays.filter((p) => p.quarter >= 5 && SCRIMMAGE.has(p.kind));
      const first = ot[0]?.offense;
      const firstTd = ot.find((p) => p.touchdown === first && p.offense === first);
      const firstPossession = ot.findIndex((p) => p.offense !== first);
      if (!firstTd || (firstPossession !== -1 && ot.indexOf(firstTd) > firstPossession)) continue;
      // The other team must have had the ball afterwards.
      expect(ot.some((p) => p.offense !== first)).toBe(true);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("better teams win more", () => {
    let strongWins = 0;
    for (let i = 0; i < 200; i++) {
      const g = game(20000 + i, { homeLevel: 8, awayLevel: 0 });
      if (g.homeScore > g.awayScore) strongWins++;
    }
    expect(strongWins / 200).toBeGreaterThan(0.75);
  });
});
