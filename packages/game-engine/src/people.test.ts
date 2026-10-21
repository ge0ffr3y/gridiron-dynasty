/**
 * Phase 4b in the engine: players tire and rotate, get hurt and leave, and
 * every scrimmage play carries its expected points added.
 */
import { Rng } from "@fgm/foundation";
import { describe, expect, it } from "vitest";
import { simulateGame } from "./engine";
import { addExpectedPoints, smoothExpectedPoints } from "./epa";
import { makeDepth, TEST_RULES } from "./testLineups";
import type { GameOutput, Play } from "./types";

function game(seed: number): GameOutput {
  return simulateGame(
    {
      home: { id: "HOME", depth: makeDepth(0, 1) },
      away: { id: "AWAY", depth: makeDepth(0, 100) },
      neutral: false,
      playoff: false,
      rules: TEST_RULES,
    },
    new Rng(seed),
  );
}

const GAMES = Array.from({ length: 120 }, (_, i) => game(3000 + i));
const HOME = makeDepth(0, 1);

/** Everyone a play credits. */
function involved(p: Play): number[] {
  return [
    p.passer,
    p.rusher,
    p.receiver,
    p.defender,
    p.pressure,
    p.returner,
    ...(p.tacklers ?? []),
    ...(p.missedTackles ?? []),
  ].filter((id): id is number => id !== undefined);
}

describe("fatigue and rotation", () => {
  it("running backs share the load the way real committees do", () => {
    let rb1 = 0;
    let rb2 = 0;
    let snaps = 0;
    const first = HOME.RB[0]!;
    const second = HOME.RB[1]!;
    for (const g of GAMES) {
      const line = (id: number) => g.box.players.find((e) => e.id === id)?.line.offSnaps ?? 0;
      const qb = line(HOME.QB[0]!.id);
      if (qb === 0) continue;
      rb1 += line(first.id);
      rb2 += line(second.id);
      snaps += qb;
    }
    // Real NFL: the top back plays about 65% of snaps, the second about 29%.
    expect(rb1 / snaps).toBeGreaterThan(0.5);
    expect(rb1 / snaps).toBeLessThan(0.8);
    expect(rb2 / snaps).toBeGreaterThan(0.15);
  });

  it("linemen rarely come off the field", () => {
    for (const g of GAMES.slice(0, 20)) {
      const lt = g.box.players.find((e) => e.id === HOME.LT[0]!.id)?.line.offSnaps ?? 0;
      const qb = g.box.players.find((e) => e.id === HOME.QB[0]!.id)?.line.offSnaps ?? 0;
      const hurt = g.injuries.some((i) => i.playerId === HOME.LT[0]!.id);
      if (!hurt && qb > 0) expect(lt / qb).toBeGreaterThan(0.95);
    }
  });
});

describe("in-game injuries", () => {
  it("happen about as often as in real games (about 1.7 per team a game)", () => {
    const perTeamGame = GAMES.reduce((s, g) => s + g.injuries.length, 0) / (GAMES.length * 2);
    expect(perTeamGame).toBeGreaterThan(1.2);
    expect(perTeamGame).toBeLessThan(2.2);
  });

  it("a player who doesn't return isn't credited with anything after he's hurt", () => {
    let checked = 0;
    for (const g of GAMES) {
      for (const injury of g.injuries.filter((i) => !i.returned)) {
        // A player can be hurt more than once (back from a knock, then out): check from the last time.
        let at = -1;
        g.plays.forEach((p, i) => {
          if (p.injured?.includes(injury.playerId)) at = i;
        });
        expect(at).toBeGreaterThanOrEqual(0);
        for (const p of g.plays.slice(at + 1)) expect(involved(p)).not.toContain(injury.playerId);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  it("some injured players come back later in the same game", () => {
    const all = GAMES.flatMap((g) => g.injuries);
    const back = all.filter((i) => i.returned).length / all.length;
    expect(back).toBeGreaterThan(0.4);
    expect(back).toBeLessThan(0.75);
  });
});

describe("expected points added", () => {
  const base = { quarter: 1, clock: 600, score: [0, 0] as [number, number] };

  it("a touchdown is worth 7 minus where the offense started", () => {
    const plays: Play[] = [
      {
        ...base,
        offense: "home",
        down: 1,
        toGo: 10,
        yardsToGoal: 25,
        kind: "pass",
        yards: 25,
        touchdown: "home",
      },
    ];
    addExpectedPoints(plays);
    expect(plays[0]!.epa).toBeCloseTo(7 - smoothExpectedPoints(1, 10, 25), 2);
  });

  it("a first down gains expected points; a turnover gives them to the other team", () => {
    const plays: Play[] = [
      {
        ...base,
        offense: "home",
        down: 1,
        toGo: 10,
        yardsToGoal: 60,
        kind: "run",
        yards: 12,
        firstDown: true,
      },
      {
        ...base,
        offense: "home",
        down: 1,
        toGo: 10,
        yardsToGoal: 48,
        kind: "pass",
        yards: 0,
        intercepted: true,
      },
      { ...base, offense: "away", down: 1, toGo: 10, yardsToGoal: 50, kind: "run", yards: 3 },
    ];
    addExpectedPoints(plays);
    expect(plays[0]!.epa).toBeGreaterThan(0);
    expect(plays[1]!.epa).toBeCloseTo(
      -smoothExpectedPoints(1, 10, 50) - smoothExpectedPoints(1, 10, 48),
      2,
    );
  });

  it("every run and dropback in a game gets an EPA, and team totals add up", () => {
    const g = GAMES[0]!;
    for (const p of g.plays) {
      if (["run", "pass", "sack", "scramble"].includes(p.kind)) expect(p.epa).toBeDefined();
    }
    for (const side of ["home", "away"] as const) {
      const sum = g.plays
        .filter(
          (p) =>
            p.offense === side && !p.noPlay && ["run", "pass", "sack", "scramble"].includes(p.kind),
        )
        .reduce((s, p) => s + (p.epa ?? 0), 0);
      expect(g.box[side].epa).toBeCloseTo(sum, 1);
    }
  });
});
