/**
 * League calendar dates as "YYYY-MM-DD" strings, with exact integer arithmetic.
 * The simulation never asks the real clock what day it is (CLAUDE.md, rule 3).
 */

export type LeagueDate = string;

function parts(date: LeagueDate): [number, number, number] {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`not a YYYY-MM-DD date: ${date}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Days since 1970-01-01 (Howard Hinnant's days_from_civil). */
export function toDayNumber(date: LeagueDate): number {
  const [y0, m, d] = parts(date);
  const y = m <= 2 ? y0 - 1 : y0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** The date for a day number (inverse of toDayNumber). */
export function fromDayNumber(dayNumber: number): LeagueDate {
  const z = dayNumber + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  );
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0);
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function addDays(date: LeagueDate, days: number): LeagueDate {
  return fromDayNumber(toDayNumber(date) + days);
}

export function daysBetween(from: LeagueDate, to: LeagueDate): number {
  return toDayNumber(to) - toDayNumber(from);
}

/** Whole years of age on a given date. */
export function ageOn(birthDate: LeagueDate, on: LeagueDate): number {
  const [by, bm, bd] = parts(birthDate);
  const [y, m, d] = parts(on);
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

export function yearOf(date: LeagueDate): number {
  return parts(date)[0];
}

/** Day of the week: 0 = Monday ... 6 = Sunday. */
export function weekdayOf(date: LeagueDate): number {
  // 1970-01-01 (day 0) was a Thursday.
  return (((toDayNumber(date) + 3) % 7) + 7) % 7;
}
