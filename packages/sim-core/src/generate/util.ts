import type { Rng } from "@fgm/foundation";

/** Limited to [min, max], then rounded to a whole number. */
export function bounded(value: number, min: number, max: number): number {
  return Math.round(Math.min(max, Math.max(min, value)));
}

/** A 0-100 score from a bell curve. */
export function score(rng: Rng, mean: number, spread: number): number {
  return bounded(rng.gaussian(mean, spread), 1, 99);
}

/** Splits 100 points across n shares in proportion to random weights (largest remainder). */
export function randomShares(rng: Rng, n: number): number[] {
  const weights = Array.from({ length: n }, () => rng.range(0.4, 1.6));
  const total = weights.reduce((a, b) => a + b, 0);
  const exact = weights.map((w) => (w / total) * 100);
  const shares = exact.map((x) => Math.floor(x));
  let left = 100 - shares.reduce((a, b) => a + b, 0);
  const byRemainder = exact
    .map((x, i) => ({ i, r: x - Math.floor(x) }))
    .sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of byRemainder) {
    if (left === 0) break;
    shares[i] = (shares[i] as number) + 1;
    left--;
  }
  return shares;
}
