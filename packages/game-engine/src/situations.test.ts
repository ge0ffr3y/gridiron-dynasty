/**
 * Phase 5a: win probability, 4th-down and 2-point decisions, clock
 * management and replay review.
 */
import { Rng } from "@fgm/foundation";
import { describe, expect, it } from "vitest";
import { CALIBRATION_TARGETS } from "./config";
import { fourthDownOptions, type Evaluator } from "./decisions";
import { simulateGame } from "./engine";
import { makeDepth, TEST_RULES } from "./testLineups";
import type { GameOutput, TeamInput } from "./types";
import { winProbability, type WinState } from "./winprob";

const base: WinState = {
  margin: 0,
  minutesLeft: 30,
  down: 1,
  toGo: 10,
  yardsToGoal: 75,
  timeoutEdge: 0,
  home: 0,
  receivesSecondHalf: 0,
};

function game(
  seed: number,
  home: Partial<TeamInput> = {},
  away: Partial<TeamInput> = {},
): GameOutput {
  return simulateGame(
    {
      home: { id: "HOME", depth: makeDepth(0, 1), ...home },
      away: { id: "AWAY", depth: makeDepth(0, 100), ...away },
      neutral: false,
      playoff: false,
      rules: TEST_RULES,
    },
    new Rng(seed),
  );
}

const GAMES = Array.from({ length: 200 }, (_, i) => game(7000 + i));

describe("win probability", () => {
  it("a two-touchdown lead with a minute left is all but won", () => {
    expect(winProbability({ ...base, margin: 14, minutesLeft: 1 })).toBeGreaterThan(0.97);
    expect(winProbability({ ...base, margin: -14, minutesLeft: 1 })).toBeLessThan(0.03);
  });

  it("a lead counts for more as time runs out", () => {
    const early = winProbability({ ...base, margin: 7, minutesLeft: 55 });
    const late = winProbability({ ...base, margin: 7, minutesLeft: 5 });
    expect(late).toBeGreaterThan(early);
  });

  it("home field helps, and better field position helps", () => {
    const home = winProbability({ ...base, home: 1 });
    const neutral = winProbability(base);
    const road = winProbability({ ...base, home: -1 });
    expect(home).toBeGreaterThan(neutral);
    expect(neutral).toBeGreaterThan(road);
    expect(winProbability({ ...base, yardsToGoal: 20 })).toBeGreaterThan(neutral);
  });

  it("with no time left the score decides it", () => {
    expect(winProbability({ ...base, margin: 1, minutesLeft: 0 })).toBe(1);
    expect(winProbability({ ...base, margin: -1, minutesLeft: 0 })).toBe(0);
  });

  it("every snap carries the home team's chance, between 0 and 1", () => {
    for (const g of GAMES.slice(0, 20))
      for (const p of g.plays)
        if (p.kind === "run" || p.kind === "pass") {
          expect(p.wp).toBeGreaterThanOrEqual(0);
          expect(p.wp).toBeLessThanOrEqual(1);
        }
  });
});

describe("4th-down decisions", () => {
  // A neutral evaluator: win chance from the score and field position only.
  const evaluator: Evaluator = {
    winChance: (n) => {
      const p = winProbability({
        ...base,
        margin: n.ourBall ? n.margin : -n.margin,
        down: n.down,
        toGo: n.toGo,
        yardsToGoal: n.yardsToGoal,
      });
      return n.ourBall ? p : 1 - p;
    },
    makeChance: () => 0.85,
    aggressiveness: 0.5,
    twoPointAggressiveness: 0.5,
  };

  it("the numbers say go on 4th & 1 near midfield, and punt on 4th & 15 deep in your own end", () => {
    const short = fourthDownOptions(
      { margin: 0, toGo: 1, yardsToGoal: 45, fieldGoalRange: 55 },
      evaluator,
    );
    expect(short.go).toBeGreaterThan(short.punt!);
    const long = fourthDownOptions(
      { margin: 0, toGo: 15, yardsToGoal: 85, fieldGoalRange: 55 },
      evaluator,
    );
    expect(long.punt!).toBeGreaterThan(long.go);
  });

  it("an aggressive coach goes for it more than a cautious one", () => {
    const goRate = (aggressiveness: number) => {
      let fourth = 0;
      let go = 0;
      for (let i = 0; i < 150; i++) {
        const g = game(8000 + i, { gameStyle: { aggressiveness } });
        for (const p of g.plays) {
          if (p.offense !== "home" || p.down !== 4 || p.noPlay) continue;
          if (!["run", "pass", "sack", "scramble", "punt", "fieldGoal"].includes(p.kind)) continue;
          fourth += 1;
          if (p.kind !== "punt" && p.kind !== "fieldGoal") go += 1;
        }
      }
      return go / fourth;
    };
    expect(goRate(1)).toBeGreaterThan(goRate(0) + 0.05);
  });
});

describe("clock management", () => {
  it("kneel-downs come from the team that's ahead", () => {
    let kneels = 0;
    for (const g of GAMES) {
      let before: [number, number] = [0, 0];
      for (const p of g.plays) {
        if (p.kind === "kneel" && p.quarter >= 4) {
          kneels += 1;
          const lead = p.offense === "home" ? before[0] - before[1] : before[1] - before[0];
          expect(lead).toBeGreaterThan(0);
        }
        before = p.score;
      }
    }
    expect(kneels).toBeGreaterThan(20);
  });

  it("in the last two minutes, the team that needs time spends its timeouts", () => {
    let late = 0;
    for (const g of GAMES) {
      let before: [number, number] = [0, 0];
      for (const p of g.plays) {
        if (p.kind === "timeout" && p.quarter === 4 && p.clock <= 120 && p.team) {
          late += 1;
          const margin = p.team === "home" ? before[0] - before[1] : before[1] - before[0];
          expect(margin).toBeLessThanOrEqual(0);
        }
        before = p.score;
      }
    }
    expect(late).toBeGreaterThan(20);
  });
});

describe("replay review", () => {
  it("challenges and booth reviews are reversed at about the real rates", () => {
    const count = { challenge: [0, 0], booth: [0, 0] };
    for (const g of GAMES)
      for (const p of g.plays)
        if (p.review) {
          count[p.review.by][0]! += 1;
          if (p.review.reversed) count[p.review.by][1]! += 1;
        }
    expect(count.challenge[0]).toBeGreaterThan(40);
    expect(count.booth[0]).toBeGreaterThan(40);
    const rate = (c: number[]) => c[1]! / c[0]!;
    expect(
      Math.abs(rate(count.challenge) - CALIBRATION_TARGETS.challengeReversalRate.real),
    ).toBeLessThan(0.15);
    expect(Math.abs(rate(count.booth) - CALIBRATION_TARGETS.boothReversalRate.real)).toBeLessThan(
      0.15,
    );
  });

  it("a lost challenge costs a timeout", () => {
    // Every team ends a half with no more timeouts used than it had.
    for (const g of GAMES)
      for (const half of [1, 2]) {
        for (const side of ["home", "away"] as const) {
          const used = g.plays.filter(
            (p) =>
              (half === 1 ? p.quarter <= 2 : p.quarter >= 3 && p.quarter <= 4) &&
              ((p.kind === "timeout" && p.team === side) ||
                (p.review?.by === "challenge" && p.review.team === side && !p.review.reversed)),
          ).length;
          expect(used).toBeLessThanOrEqual(TEST_RULES.timeoutsPerHalf);
        }
      }
  });
});
