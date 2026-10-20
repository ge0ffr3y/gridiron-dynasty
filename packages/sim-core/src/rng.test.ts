import { describe, expect, it } from "vitest";
import { Rng, RngStreams, RNG_STREAMS, streamSeed } from "./rng";

function draw(rng: Rng, count: number): number[] {
  return Array.from({ length: count }, () => rng.nextUint32());
}

describe("Rng", () => {
  it("gives the same sequence for the same seed", () => {
    expect(draw(new Rng(42), 1000)).toEqual(draw(new Rng(42), 1000));
  });

  it("gives different sequences for different seeds", () => {
    expect(draw(new Rng(42), 10)).not.toEqual(draw(new Rng(43), 10));
  });

  it("matches the recorded sequence for seed 42 (catches accidental changes)", () => {
    // If this fails, every saved league would replay differently. Only update
    // the numbers on purpose, and say so in the commit message.
    expect(draw(new Rng(42), 5)).toMatchInlineSnapshot(`
      [
        660444221,
        3652823732,
        77672526,
        910233633,
        2297337756,
      ]
    `);
  });

  it("resumes exactly from a saved state", () => {
    const a = new Rng(7);
    draw(a, 100);
    const b = new Rng(1);
    b.setState(a.getState());
    expect(draw(b, 50)).toEqual(draw(a, 50));
  });

  it("keeps numbers in range", () => {
    const rng = new Rng(3);
    for (let i = 0; i < 10_000; i++) {
      const x = rng.next();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      const n = rng.intBetween(-2, 2);
      expect(n).toBeGreaterThanOrEqual(-2);
      expect(n).toBeLessThanOrEqual(2);
    }
  });

  it("produces a bell curve with the right mean and spread", () => {
    const rng = new Rng(11);
    let sum = 0;
    let sumSq = 0;
    const n = 50_000;
    for (let i = 0; i < n; i++) {
      const x = rng.gaussian(10, 2);
      sum += x;
      sumSq += x * x;
    }
    const mean = sum / n;
    const sd = Math.sqrt(sumSq / n - mean * mean);
    expect(mean).toBeCloseTo(10, 1);
    expect(sd).toBeCloseTo(2, 1);
  });

  it("shuffles into a permutation of the same items", () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const shuffled = new Rng(5).shuffle([...items]);
    expect([...shuffled].sort((a, b) => a - b)).toEqual(items);
  });
});

describe("RngStreams", () => {
  it("gives each named stream its own independent sequence", () => {
    const streams = new RngStreams(42);
    const seeds = new Set(RNG_STREAMS.map((name) => streamSeed(42, name)));
    expect(seeds.size).toBe(RNG_STREAMS.length);
    expect(draw(streams.get("game"), 5)).not.toEqual(draw(streams.get("injury"), 5));
  });

  it("drawing from one stream never changes another", () => {
    const quiet = new RngStreams(42);
    const busy = new RngStreams(42);
    draw(busy.get("injury"), 500);
    expect(draw(busy.get("schedule"), 20)).toEqual(draw(quiet.get("schedule"), 20));
  });

  it("saves and restores every stream", () => {
    const a = new RngStreams(9);
    draw(a.get("game"), 30);
    draw(a.get("draft"), 3);
    const b = new RngStreams(9);
    b.setState(JSON.parse(JSON.stringify(a.getState())));
    expect(draw(b.get("game"), 10)).toEqual(draw(a.get("game"), 10));
    expect(draw(b.get("draft"), 10)).toEqual(draw(a.get("draft"), 10));
  });
});
