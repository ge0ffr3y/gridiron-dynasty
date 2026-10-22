/**
 * Realism guard: simulated seasons must keep the core stats inside the real
 * NFL ranges (calibration/targets.json). If a change breaks this, run
 * `npm run sim -- --calibrate` to see the full scorecard.
 */
import { CORE_STATS, measureSeason, scorecard, type MeasuredGame } from "@fgm/game-engine";
import { advanceUntil, createLeague } from "@fgm/sim-core";
import { describe, expect, it } from "vitest";

describe("calibration", () => {
  // Two seasons per league, like the scorecard: a freshly generated league's first season runs a
  // little hot on scoring (its rosters haven't been through a draft and a League Year yet).
  it("core stats land inside the real NFL ranges (two leagues, two seasons each, averaged)", () => {
    const seasons: Record<string, number>[] = [];
    for (const seed of [42, 43]) {
      const league = createLeague({ seed, name: "Calibration" });
      for (let year = 0; year < 2; year++) {
        const games: MeasuredGame[] = [];
        advanceUntil(league, (l) => l.calendar.stage === "regular");
        advanceUntil(league, (l) => l.calendar.stage !== "regular", {
          onGame: (g, output) => games.push({ homeId: g.homeId, awayId: g.awayId, output }),
        });
        seasons.push(measureSeason(games));
      }
    }
    const averaged = Object.fromEntries(
      Object.keys(seasons[0]!).map((k) => [
        k,
        seasons.reduce((s, v) => s + (v[k] ?? 0), 0) / seasons.length,
      ]),
    );
    const misses = scorecard(averaged)
      .filter((line) => CORE_STATS.includes(line.key) && !line.pass)
      .map(
        (line) => `${line.key}: ${line.sim.toFixed(3)} (real ${line.range[0]} to ${line.range[1]})`,
      );
    expect(misses).toEqual([]);
  }, 600_000);
});
