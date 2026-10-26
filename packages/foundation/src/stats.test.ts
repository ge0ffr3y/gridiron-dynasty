import { describe, expect, it } from "vitest";
import { Rng } from "./rng";
import {
  bootstrapInterval,
  mean,
  pairedDifference,
  quantile,
  sd,
  se,
  tCritical,
  tInterval,
  wilson,
} from "./stats";

describe("statistics", () => {
  it("mean and sample standard deviation: the classic eight numbers", () => {
    const xs = [2, 4, 4, 4, 5, 5, 7, 9];
    expect(mean(xs)).toBe(5);
    // Sum of squares is 32; divided by n - 1 = 7.
    expect(sd(xs)).toBeCloseTo(Math.sqrt(32 / 7), 10);
    expect(se(xs)).toBeCloseTo(Math.sqrt(32 / 7) / Math.sqrt(8), 10);
    expect(sd([5])).toBe(0);
  });

  it("t critical values match the standard table, and fall toward 1.96", () => {
    expect(tCritical(4)).toBeCloseTo(2.776, 3);
    expect(tCritical(10)).toBeCloseTo(2.228, 3);
    expect(tCritical(30)).toBeCloseTo(2.042, 3);
    expect(tCritical(60)).toBeCloseTo(2.0, 3);
    expect(tCritical(35)).toBeGreaterThan(2.021);
    expect(tCritical(35)).toBeLessThan(2.042);
    expect(tCritical(1_000_000)).toBeCloseTo(1.96, 2);
    for (let df = 1; df < 200; df++) expect(tCritical(df + 1)).toBeLessThanOrEqual(tCritical(df));
  });

  it("a t interval: ten to eighteen in steps of two", () => {
    // mean 14, sd = sqrt(10), se = sqrt(2), t(4) = 2.776, half-width 3.926
    const i = tInterval([10, 12, 14, 16, 18]);
    expect(i.mean).toBe(14);
    expect(i.lo).toBeCloseTo(14 - 2.776 * Math.sqrt(2), 6);
    expect(i.hi).toBeCloseTo(14 + 2.776 * Math.sqrt(2), 6);
    expect(i.n).toBe(5);
  });

  it("the Wilson interval for 8 of 10 is 0.49 to 0.94, and stays inside 0..1 at the ends", () => {
    const i = wilson(8, 10);
    expect(i.mean).toBe(0.8);
    expect(i.lo).toBeCloseTo(0.49, 2);
    expect(i.hi).toBeCloseTo(0.943, 2);
    expect(wilson(0, 20).lo).toBe(0);
    expect(wilson(0, 20).hi).toBeGreaterThan(0.1);
    expect(wilson(20, 20).hi).toBe(1);
    expect(Number.isNaN(wilson(0, 0).mean)).toBe(true);
  });

  it("quantiles are linear between neighbours", () => {
    expect(quantile([1, 2, 3, 4], 0)).toBe(1);
    expect(quantile([1, 2, 3, 4], 1)).toBe(4);
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
  });

  it("the bootstrap is repeatable from a seed and brackets the mean", () => {
    const xs = [3, 5, 4, 8, 6, 5, 7, 4, 6, 9, 5, 6];
    const a = bootstrapInterval(xs, mean, new Rng(1));
    const b = bootstrapInterval(xs, mean, new Rng(1));
    expect(a).toEqual(b);
    expect(a.lo).toBeLessThan(a.mean);
    expect(a.hi).toBeGreaterThan(a.mean);
    expect(bootstrapInterval([4, 4, 4], mean, new Rng(2))).toMatchObject({ lo: 4, hi: 4 });
  });

  it("a paired difference is the interval of the differences", () => {
    const a = [5, 7, 9, 6, 8];
    const b = [4, 6, 8, 6, 6];
    const d = pairedDifference(a, b);
    expect(d.mean).toBeCloseTo(1, 10);
    expect(d).toEqual(tInterval([1, 1, 1, 0, 2]));
    expect(() => pairedDifference([1], [1, 2])).toThrow();
  });

  it("covers the true mean about 95% of the time (a check of the t interval)", () => {
    const rng = new Rng(99);
    let covered = 0;
    const trials = 400;
    for (let t = 0; t < trials; t++) {
      // Uniform on 0..1 has mean 0.5.
      const xs = Array.from({ length: 12 }, () => rng.next());
      const i = tInterval(xs);
      if (i.lo <= 0.5 && 0.5 <= i.hi) covered++;
    }
    expect(covered / trials).toBeGreaterThan(0.91);
    expect(covered / trials).toBeLessThan(0.99);
  });
});
