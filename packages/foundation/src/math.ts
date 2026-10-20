/**
 * Deterministic math helpers.
 *
 * Math.exp, Math.log and Math.pow are allowed to round differently in the last
 * digit from one browser to another, which would make the same seed play out
 * differently in Chrome and Safari. These versions use only + - * / and exact
 * powers of two, which every JavaScript engine computes identically (IEEE 754).
 * They match the built-ins to about 1e-15 relative error.
 *
 * The simulation packages must use these instead of the built-ins; a guardrail
 * test enforces it.
 */

// ln(2) split into a high part (few significant bits, so k * LN2_HI is exact
// for any k we use) and the small remainder (the fdlibm constants).
const LN2_HI = 6.9314718036912381649e-1;
const LN2_LO = 1.90821492927058770002e-10;
const LN2 = 0.6931471805599453;
const SQRT2 = 1.4142135623730951;
const TWO_30 = 1073741824;
const INV_TWO_30 = 1 / TWO_30;

/** value * 2^k, done in exact power-of-two steps. */
function scaleByPowerOfTwo(value: number, k: number): number {
  let v = value;
  let n = k;
  while (n > 30) {
    v *= TWO_30;
    n -= 30;
  }
  while (n < -30) {
    v *= INV_TWO_30;
    n += 30;
  }
  // n is now in [-30, 30]: one more exact multiply.
  return n >= 0 ? v * (1 << n) : v / (1 << -n);
}

/** e^x */
export function exp(x: number): number {
  if (Number.isNaN(x)) return NaN;
  if (x > 709.782712893384) return Infinity;
  if (x < -745.1332191019411) return 0;
  // Write x = k*ln2 + r with |r| <= ln2/2, then e^x = 2^k * e^r.
  const k = Math.round(x / LN2);
  const r = x - k * LN2_HI - k * LN2_LO;
  // Taylor series for e^r (Horner form); 14 terms is plenty for |r| <= 0.35.
  let sum = 1;
  for (let n = 14; n >= 1; n--) sum = 1 + (r * sum) / n;
  return scaleByPowerOfTwo(sum, k);
}

/** Natural logarithm. */
export function log(x: number): number {
  if (Number.isNaN(x) || x < 0) return NaN;
  if (x === 0) return -Infinity;
  if (x === Infinity) return Infinity;
  // Write x = m * 2^e with m in [sqrt(2)/2, sqrt(2)).
  let m = x;
  let e = 0;
  while (m >= TWO_30) {
    m *= INV_TWO_30;
    e += 30;
  }
  while (m < INV_TWO_30) {
    m *= TWO_30;
    e -= 30;
  }
  while (m >= SQRT2) {
    m /= 2;
    e += 1;
  }
  while (m < SQRT2 / 2) {
    m *= 2;
    e -= 1;
  }
  // ln(m) = 2 * atanh(s), s = (m - 1) / (m + 1), |s| <= 0.172.
  const s = (m - 1) / (m + 1);
  const s2 = s * s;
  let series = 0;
  for (let n = 12; n >= 0; n--) series = 1 / (2 * n + 1) + s2 * series;
  return e * LN2_HI + (e * LN2_LO + 2 * s * series);
}

/** base^exponent */
export function pow(base: number, exponent: number): number {
  if (exponent === 0) return 1;
  if (Number.isInteger(exponent) && Math.abs(exponent) <= 64) {
    // Repeated squaring: exact steps, no log/exp needed.
    let result = 1;
    let b = base;
    let n = Math.abs(exponent);
    while (n > 0) {
      if (n & 1) result *= b;
      b *= b;
      n >>>= 1;
    }
    return exponent < 0 ? 1 / result : result;
  }
  if (base < 0) return NaN;
  if (base === 0) return exponent > 0 ? 0 : Infinity;
  return exp(exponent * log(base));
}

/** The S-shaped curve 1 / (1 + e^-x): turns any score into a probability. */
export function logistic(x: number): number {
  return 1 / (1 + exp(-x));
}

/** value limited to the range [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** The point a fraction t of the way from a to b. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
