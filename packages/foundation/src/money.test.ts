import { describe, expect, it } from "vitest";
import { assertDollars, formatDollars, formatShort, scaleDollars, splitEvenly } from "./money";

describe("money", () => {
  it("rejects fractions of a dollar", () => {
    expect(() => assertDollars(10.5)).toThrow();
    expect(assertDollars(10)).toBe(10);
  });

  it("splits a total into pieces that add back to exactly the total", () => {
    // A $10,000,001 signing bonus spread over 3 years.
    const pieces = splitEvenly(10_000_001, 3);
    expect(pieces).toEqual([3_333_334, 3_333_334, 3_333_333]);
    expect(pieces.reduce((a, b) => a + b, 0)).toBe(10_000_001);
    for (let total = -50; total <= 50; total++) {
      for (let parts = 1; parts <= 5; parts++) {
        expect(splitEvenly(total, parts).reduce((a, b) => a + b, 0)).toBe(total);
      }
    }
  });

  it("scales to the nearest dollar", () => {
    expect(scaleDollars(1_000_001, 1.2)).toBe(1_200_001);
  });

  it("formats amounts", () => {
    expect(formatDollars(12_500_000)).toBe("$12,500,000");
    expect(formatDollars(-950)).toBe("-$950");
    expect(formatShort(12_500_000)).toBe("$12.5M");
    expect(formatShort(255_400_000)).toBe("$255.4M");
    expect(formatShort(950_000)).toBe("$950K");
    expect(formatShort(800)).toBe("$800");
  });
});
