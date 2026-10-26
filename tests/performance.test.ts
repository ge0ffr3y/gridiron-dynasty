/**
 * Speed guard. The goal is a full season (272 games and the playoffs) in under
 * 5 seconds in the browser, saving included: Phase 5b measured 1.5 s there and
 * 1.4 s headless. `npm test` runs it on its own after the rest (Phase 14's
 * multi-season GM Mode tests made it flaky side by side); CI machines are
 * slower, so the guard still allows more and only catches a big slowdown.
 * The time is printed.
 */
import { advance, advanceUntil, createLeague, serializeLeague } from "@fgm/sim-core";
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

  // Save size budget (docs/performance.md): old logs are pruned, so a long league stops growing
  // fast. Measured with this seed: about 17 MB after 5 seasons and 21 MB after 10, against 21 and
  // 32 MB before pruning. The ceilings leave room for normal change and catch a log that stops
  // being pruned.
  it("a save stays inside its size budget after six seasons", () => {
    const league = createLeague({ seed: 18, name: "Size" });
    for (let i = 0; i < 6; i++) {
      advanceUntil(league, (l) => l.calendar.stage === "complete");
      advance(league);
    }
    const rawMB = serializeLeague(league).length / 1e6;
    const logsMB = JSON.stringify(league.transactions).length / 1e6;
    console.info(`six seasons: save ${rawMB.toFixed(1)} MB, transactions ${logsMB.toFixed(1)} MB`);
    expect(rawMB).toBeLessThan(23);
    expect(logsMB).toBeLessThan(4.5);
  }, 300_000);
});
