/**
 * Speed guard. The goal is a full season (272 games and the playoffs) in under
 * 5 seconds in the browser, saving included: Phase 5b measured 1.5 s there and
 * 1.4 s headless. Tests run side by side (and CI machines are slower), so this
 * guard allows more and only catches a big slowdown; the time is printed.
 */
import { advanceUntil, createLeague } from "@fgm/sim-core";
import { describe, expect, it } from "vitest";

const GUARD_SECONDS = 15;

describe("performance", () => {
  it(`a full season sims in under ${GUARD_SECONDS} seconds even on a busy machine`, () => {
    const league = createLeague({ seed: 12, name: "Speed" });
    advanceUntil(league, (l) => l.calendar.stage === "regular");
    const start = performance.now();
    advanceUntil(league, (l) => l.calendar.stage === "complete");
    const seconds = (performance.now() - start) / 1000;
    console.info(`one season: ${seconds.toFixed(2)} s`);
    expect(league.games.filter((g) => g.result).length).toBe(285);
    expect(seconds).toBeLessThan(GUARD_SECONDS);
  }, 60_000);
});
