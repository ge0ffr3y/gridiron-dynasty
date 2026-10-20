/** Drawing from fitted distributions, using exact (browser-proof) math. */
import { dmath, type Rng } from "@fgm/foundation";

/**
 * A value from a distribution described by its quantiles (e.g. "10% of runs
 * gain 0 or less, 50% gain 3 or less..."). `u` is a number in [0, 1), already
 * nudged up or down by the matchup. Past the last listed quantile an
 * exponential tail allows rare big gains.
 */
export function fromQuantiles(
  points: readonly number[],
  values: readonly number[],
  u: number,
  tailMean = 0,
): number {
  const first = points[0] as number;
  const last = points[points.length - 1] as number;
  if (u <= first) return values[0] as number;
  if (u >= last) {
    const lastValue = values[values.length - 1] as number;
    if (tailMean <= 0) return lastValue;
    const v = (u - last) / (1 - last);
    return lastValue - tailMean * dmath.log(1 - Math.min(v, 0.999999));
  }
  for (let i = 1; i < points.length; i++) {
    const p = points[i] as number;
    if (u <= p) {
      const p0 = points[i - 1] as number;
      const v0 = values[i - 1] as number;
      const v1 = values[i] as number;
      return v0 + ((u - p0) / (p - p0)) * (v1 - v0);
    }
  }
  return values[values.length - 1] as number;
}

/**
 * A uniform draw nudged up (positive `shift`) or down. The nudge happens on
 * the log-odds scale: near the middle it moves the draw by about `shift`,
 * but it can never push draws past the ends. (Adding and clamping would pile
 * them up at the extreme and turn a small edge into absurd 200-yard plays.)
 */
export function shiftedUniform(rng: Rng, shift: number): number {
  const u = Math.min(1 - 1e-9, Math.max(1e-9, rng.next()));
  if (shift === 0) return u;
  return dmath.logistic(dmath.log(u / (1 - u)) + 4 * shift);
}

/** Probability moved on the log-odds scale: positive `logitShift` makes it likelier. */
export function adjustProbability(p: number, logitShift: number): number {
  const clamped = Math.min(0.9999, Math.max(0.0001, p));
  return dmath.logistic(dmath.log(clamped / (1 - clamped)) + logitShift);
}

/** One item, chosen with probability proportional to its weight. */
export function weightedPick<T>(rng: Rng, items: readonly T[], weight: (item: T) => number): T {
  const weights = items.map((i) => Math.max(0, weight(i)));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng.next() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i] as number;
    if (r < 0) return items[i] as T;
  }
  return items[items.length - 1] as T;
}
