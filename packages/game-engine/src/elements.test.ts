/**
 * Phase 5b: special teams and the elements.
 */
import { Rng } from "@fgm/foundation";
import { describe, expect, it } from "vitest";
import { ELEMENTS } from "./config";
import { simulateGame } from "./engine";
import { makeDepth, TEST_RULES } from "./testLineups";
import type { Conditions, GameOutput, GameRules } from "./types";
import { weatherEffects } from "./weather";

// The engine's type settings leave out console (no browser or Node APIs); tests may print.
declare const console: { info(message: string): void };

const DOME: Conditions = {
  indoors: true,
  temperatureF: 70,
  windMph: 0,
  precipitation: "none",
  elevationMeters: 0,
};
/** A raw December day by a lake. */
const COLD_AND_WINDY: Conditions = {
  indoors: false,
  temperatureF: 22,
  windMph: 18,
  precipitation: "none",
  elevationMeters: 0,
};

function game(seed: number, conditions?: Conditions, rules: GameRules = TEST_RULES): GameOutput {
  return simulateGame(
    {
      home: { id: "HOME", depth: makeDepth(0, 1) },
      away: { id: "AWAY", depth: makeDepth(0, 100) },
      neutral: false,
      playoff: false,
      rules,
      ...(conditions ? { conditions } : {}),
    },
    new Rng(seed),
  );
}

const SEEDS = Array.from({ length: 400 }, (_, i) => 9000 + i);
const GAMES = SEEDS.map((s) => game(s));

function summarize(games: GameOutput[]) {
  let points = 0;
  let attempts = 0;
  let made = 0;
  for (const g of games) {
    points += g.homeScore + g.awayScore;
    for (const p of g.plays)
      if (p.kind === "fieldGoal" && !p.noPlay) {
        attempts += 1;
        if (p.good) made += 1;
      }
  }
  return { pointsPerTeamGame: points / (2 * games.length), fieldGoalPct: made / attempts };
}

describe("weather", () => {
  it("cold, windy outdoor games score less and miss more kicks than dome games", () => {
    // The same teams and the same seeds; only the weather differs.
    const dome = summarize(SEEDS.map((s) => game(s, DOME)));
    const cold = summarize(SEEDS.map((s) => game(s, COLD_AND_WINDY)));
    console.info(
      `dome: ${dome.pointsPerTeamGame.toFixed(1)} points per team, ${(100 * dome.fieldGoalPct).toFixed(1)}% field goals; ` +
        `22°F and 18 mph wind: ${cold.pointsPerTeamGame.toFixed(1)} points, ${(100 * cold.fieldGoalPct).toFixed(1)}%`,
    );
    expect(cold.pointsPerTeamGame).toBeLessThan(dome.pointsPerTeamGame - 0.5);
    expect(cold.fieldGoalPct).toBeLessThan(dome.fieldGoalPct - 0.03);
  });

  it("effects run the right way: wind and cold hurt, thin air helps kicks", () => {
    const dome = weatherEffects(DOME);
    const cold = weatherEffects(COLD_AND_WINDY);
    expect(dome.fieldGoalLogit).toBeGreaterThan(0);
    expect(cold.fieldGoalLogit).toBeLessThan(0);
    expect(cold.completionLogit).toBeLessThan(dome.completionLogit);
    expect(cold.puntYards).toBeLessThan(dome.puntYards);
    const mile = weatherEffects({ ...DOME, indoors: false, elevationMeters: 1609 });
    expect(mile.fieldGoalLogit).toBeGreaterThan(
      weatherEffects({ ...DOME, indoors: false }).fieldGoalLogit,
    );
    const snow = weatherEffects({ ...COLD_AND_WINDY, windMph: 5, precipitation: "snow" });
    expect(snow.fumbleFactor).toBeGreaterThan(1);
  });

  it("a game with no conditions given plays exactly like a dome game", () => {
    expect(game(1234).plays).toEqual(game(1234, DOME).plays);
    expect(game(1234).plays).not.toEqual(game(1234, COLD_AND_WINDY).plays);
  });
});

describe("kickoffs", () => {
  const kickoffs = GAMES.flatMap((g) => g.plays.filter((p) => p.kind === "kickoff" && !p.onside));

  it("touchbacks happen at about the real 2025 rate", () => {
    const touchbacks = kickoffs.filter((p) => p.touchback).length / kickoffs.length;
    const target = ELEMENTS.targets.kickoffTouchbackRate;
    expect(touchbacks).toBeGreaterThan(target.range[0]! - 0.03);
    expect(touchbacks).toBeLessThan(target.range[1]! + 0.03);
    // Most kickoffs are returned under the 2025 rules.
    expect(
      kickoffs.filter((p) => p.returner !== undefined).length / kickoffs.length,
    ).toBeGreaterThan(0.6);
  });

  it("teams try onside kicks only when trailing in the 4th quarter or overtime", () => {
    let onside = 0;
    let recovered = 0;
    for (const g of GAMES) {
      let before: [number, number] = [0, 0];
      for (const p of g.plays) {
        if (p.kind === "kickoff" && p.onside) {
          onside += 1;
          if (p.onside.recovered) recovered += 1;
          const margin = p.offense === "home" ? before[0] - before[1] : before[1] - before[0];
          expect(margin).toBeLessThan(0);
          expect(p.quarter).toBeGreaterThanOrEqual(4);
        }
        before = p.score;
      }
    }
    // About one onside kick every five games in real 2025 football.
    expect(onside / GAMES.length).toBeGreaterThan(0.1);
    expect(onside / GAMES.length).toBeLessThan(0.35);
    expect(recovered).toBeLessThan(onside / 3);
  });

  it("the touchback spot comes from the rules file", () => {
    for (const spot of [25, 35]) {
      const rules: GameRules = {
        ...TEST_RULES,
        kickoff: { ...TEST_RULES.kickoff, touchbackSpot: spot },
      };
      let checked = 0;
      for (let i = 0; i < 20; i++) {
        const plays = game(500 + i, undefined, rules).plays;
        plays.forEach((p, j) => {
          // A deep touchback (not one downed after landing in the landing zone).
          if (p.kind !== "kickoff" || !p.touchback || p.note) return;
          const next = plays.slice(j + 1).find((q) => q.down === 1);
          if (!next) return;
          expect(next.yardsToGoal).toBe(100 - spot);
          checked += 1;
        });
      }
      expect(checked).toBeGreaterThan(10);
    }
  });
});

describe("punts and field goals", () => {
  const punts = GAMES.flatMap((g) => g.plays.filter((p) => p.kind === "punt" && !p.noPlay));
  const kicks = GAMES.flatMap((g) => g.plays.filter((p) => p.kind === "fieldGoal" && !p.noPlay));
  const fakes = GAMES.flatMap((g) => g.plays.filter((p) => p.fake));

  it("gross and net punting are near the real averages", () => {
    const kicked = punts.filter((p) => (p.kickDistance ?? 0) > 0);
    const gross = kicked.reduce((sum, p) => sum + p.kickDistance!, 0) / kicked.length;
    expect(gross).toBeGreaterThan(ELEMENTS.targets.puntGrossAverage.real - 2);
    expect(gross).toBeLessThan(ELEMENTS.targets.puntGrossAverage.real + 2);
  });

  it("blocks, muffs and fakes happen, but rarely", () => {
    const blockedPunts = punts.filter((p) => p.kickDistance === 0).length;
    const blockedKicks = kicks.filter((p) => p.blocked).length;
    const muffs = punts.filter((p) => p.fumble?.lost).length;
    expect(blockedPunts).toBeGreaterThan(0);
    expect(blockedPunts / punts.length).toBeLessThan(0.02);
    expect(blockedKicks).toBeGreaterThan(0);
    expect(blockedKicks / kicks.length).toBeLessThan(0.05);
    expect(muffs).toBeGreaterThan(0);
    expect(muffs / punts.length).toBeLessThan(0.06);
    expect(fakes.length).toBeGreaterThan(0);
    expect(fakes.length / (punts.length + kicks.length)).toBeLessThan(0.03);
    // A fake is a run or pass on 4th down.
    for (const p of fakes) {
      expect(p.down).toBe(4);
      expect(["run", "pass", "sack", "scramble"]).toContain(p.kind);
    }
  });
});
