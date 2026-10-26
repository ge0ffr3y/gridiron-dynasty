/**
 * Statistics for experiments (Phase 17): means, spreads and 95% intervals. Plain functions, so the
 * runner and the web app use the same ones. Only exact arithmetic and `Math.sqrt` are used (rule 2:
 * no `Math.exp`/`log`), so the t table below stands in for the t distribution.
 */
import type { Rng } from "./rng";

export interface Interval {
  /** The estimate: a mean, or a proportion. */
  mean: number;
  lo: number;
  hi: number;
  n: number;
  /** Sample standard deviation (not for proportions). */
  sd: number;
}

export const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

export function mean(xs: readonly number[]): number {
  return xs.length === 0 ? NaN : sum(xs) / xs.length;
}

/** Sample standard deviation (divides by n - 1). */
export function sd(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(sum(xs.map((x) => (x - m) * (x - m))) / (xs.length - 1));
}

/** Standard error of the mean. */
export function se(xs: readonly number[]): number {
  return xs.length < 2 ? 0 : sd(xs) / Math.sqrt(xs.length);
}

/** Two-sided 95% critical values of Student's t by degrees of freedom (standard tables). */
const T95: [number, number][] = [
  [1, 12.706],
  [2, 4.303],
  [3, 3.182],
  [4, 2.776],
  [5, 2.571],
  [6, 2.447],
  [7, 2.365],
  [8, 2.306],
  [9, 2.262],
  [10, 2.228],
  [11, 2.201],
  [12, 2.179],
  [13, 2.16],
  [14, 2.145],
  [15, 2.131],
  [16, 2.12],
  [17, 2.11],
  [18, 2.101],
  [19, 2.093],
  [20, 2.086],
  [21, 2.08],
  [22, 2.074],
  [23, 2.069],
  [24, 2.064],
  [25, 2.06],
  [26, 2.056],
  [27, 2.052],
  [28, 2.048],
  [29, 2.045],
  [30, 2.042],
  [40, 2.021],
  [60, 2.0],
  [120, 1.98],
];
const Z95 = 1.96;

/** The 95% critical value for `df` degrees of freedom (interpolated on 1/df between table rows). */
export function tCritical(df: number): number {
  if (df < 1) return Infinity;
  const last = T95[T95.length - 1]!;
  if (df >= last[0]) {
    // Between the last row and the normal value, again on 1/df.
    const w = last[0] / df;
    return Z95 + (last[1] - Z95) * w;
  }
  for (let i = 1; i < T95.length; i++) {
    const [d1, t1] = T95[i]!;
    if (df <= d1) {
      const [d0, t0] = T95[i - 1]!;
      if (df === d1) return t1;
      const w = (1 / df - 1 / d1) / (1 / d0 - 1 / d1);
      return t1 + (t0 - t1) * w;
    }
  }
  return last[1];
}

/** The mean with a 95% t interval. */
export function tInterval(xs: readonly number[]): Interval {
  const m = mean(xs);
  const half = xs.length < 2 ? 0 : tCritical(xs.length - 1) * se(xs);
  return { mean: m, lo: m - half, hi: m + half, n: xs.length, sd: sd(xs) };
}

/** Wilson 95% interval for a proportion (behaves at 0 and 1, unlike the textbook one). */
export function wilson(successes: number, n: number): Interval {
  if (n === 0) return { mean: NaN, lo: NaN, hi: NaN, n, sd: 0 };
  const p = successes / n;
  const z2 = Z95 * Z95;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (Z95 * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { mean: p, lo: Math.max(0, center - half), hi: Math.min(1, center + half), n, sd: 0 };
}

/** The p-quantile of values already sorted ascending (linear between neighbours). */
export function quantile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const at = p * (sorted.length - 1);
  const i = Math.floor(at);
  const frac = at - i;
  const a = sorted[i]!;
  const b = sorted[Math.min(i + 1, sorted.length - 1)]!;
  return a + (b - a) * frac;
}

/** A percentile-bootstrap 95% interval for any statistic of a sample, from a seeded generator. */
export function bootstrapInterval(
  xs: readonly number[],
  statistic: (sample: readonly number[]) => number,
  rng: Rng,
  reps = 2000,
): Interval {
  const estimates: number[] = [];
  for (let r = 0; r < reps; r++) {
    const sample = xs.map(() => xs[rng.intBetween(0, xs.length - 1)]!);
    estimates.push(statistic(sample));
  }
  estimates.sort((a, b) => a - b);
  return {
    mean: statistic(xs),
    lo: quantile(estimates, 0.025),
    hi: quantile(estimates, 0.975),
    n: xs.length,
    sd: sd(xs),
  };
}

/** The mean difference a - b over matched pairs, with a 95% t interval. */
export function pairedDifference(a: readonly number[], b: readonly number[]): Interval {
  if (a.length !== b.length) throw new Error("paired samples must be the same length");
  return tInterval(a.map((x, i) => x - b[i]!));
}
