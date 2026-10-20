import { describe, expect, it } from "vitest";
import { clamp, exp, lerp, log, logistic, pow } from "./math";

// The tests (not the simulation) may use the built-in Math functions as a reference.
function expectRelClose(actual: number, expected: number, tolerance = 1e-14): void {
  const scale = Math.max(Math.abs(expected), Number.MIN_VALUE);
  expect(Math.abs(actual - expected) / scale).toBeLessThan(tolerance);
}

describe("deterministic math", () => {
  it("exp matches Math.exp", () => {
    for (let x = -700; x <= 700; x += 0.731) expectRelClose(exp(x), Math.exp(x));
    for (let x = -5; x <= 5; x += 0.0137) expectRelClose(exp(x), Math.exp(x));
    expect(exp(0)).toBe(1);
    expect(exp(1000)).toBe(Infinity);
    expect(exp(-1000)).toBe(0);
  });

  it("log matches Math.log", () => {
    for (let x = 1e-300; x < 1e300; x *= 7.3) expectRelClose(log(x), Math.log(x));
    for (let x = 0.01; x <= 10; x += 0.0071) {
      // Near x = 1 the answer is near zero, so compare absolute error there.
      expect(Math.abs(log(x) - Math.log(x))).toBeLessThan(
        1e-15 * Math.max(1, Math.abs(Math.log(x))) + 1e-16,
      );
    }
    expect(log(1)).toBe(0);
    expect(log(0)).toBe(-Infinity);
    expect(log(-1)).toBeNaN();
  });

  it("pow matches Math.pow", () => {
    expect(pow(2, 10)).toBe(1024);
    expect(pow(3, -2)).toBeCloseTo(1 / 9, 15);
    expect(pow(-2, 3)).toBe(-8);
    for (let b = 0.1; b < 50; b += 0.37) {
      for (const e of [0.5, 0.75, 1.3, -0.4, 2.5]) expectRelClose(pow(b, e), Math.pow(b, e), 1e-13);
    }
  });

  it("logistic, clamp and lerp behave", () => {
    expect(logistic(0)).toBe(0.5);
    expect(logistic(10)).toBeGreaterThan(0.9999);
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(lerp(10, 20, 0.25)).toBe(12.5);
  });
});
