/**
 * Money.
 *
 * All money in the league is a whole number of dollars. Floating-point cents
 * drift (0.1 + 0.2 is not 0.3), and cap accounting has to balance to the
 * dollar, so we never store fractions of a dollar.
 */

/** A whole number of dollars. */
export type Dollars = number;

/** Throws unless value is a whole number of dollars that JavaScript can hold exactly. */
export function assertDollars(value: number, what = "amount"): Dollars {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${what} must be a whole number of dollars, got ${value}`);
  }
  return value;
}

/**
 * Splits a total into `parts` whole-dollar pieces that add up to exactly the
 * total. Leftover dollars go to the earliest pieces (e.g. the first year of a
 * prorated signing bonus). The rounding convention gets checked against the
 * CBA when contracts are built (roadmap Phase 7).
 */
export function splitEvenly(total: Dollars, parts: number): Dollars[] {
  assertDollars(total, "total");
  if (!Number.isInteger(parts) || parts <= 0) {
    throw new Error(`parts must be a positive whole number, got ${parts}`);
  }
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const base = Math.floor(abs / parts);
  const leftover = abs - base * parts;
  const pieces: Dollars[] = [];
  for (let i = 0; i < parts; i++) pieces.push(sign * (base + (i < leftover ? 1 : 0)));
  return pieces;
}

/** amount * factor, rounded to the nearest dollar (e.g. a 120% raise). */
export function scaleDollars(amount: Dollars, factor: number): Dollars {
  return assertDollars(Math.round(amount * factor), "scaled amount");
}

/** "$12,500,000" */
export function formatDollars(amount: Dollars): string {
  const sign = amount < 0 ? "-" : "";
  const digits = Math.abs(amount).toString();
  let out = "";
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ",";
    out += digits[i];
  }
  return `${sign}$${out}`;
}

/** "$12.5M", "$950K", "$800" */
export function formatShort(amount: Dollars): string {
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);
  if (abs >= 1_000_000)
    return `${sign}$${trimZeros((abs / 1_000_000).toFixed(abs >= 100_000_000 ? 1 : 2))}M`;
  if (abs >= 1_000) return `${sign}$${trimZeros((abs / 1_000).toFixed(1))}K`;
  return `${sign}$${abs}`;
}

function trimZeros(text: string): string {
  return text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text;
}
