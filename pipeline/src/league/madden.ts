/**
 * The private Madden ratings file: matched to real players, and its ~50
 * attributes combined into our 28 (raw, still on Madden's scale; ratings.ts
 * puts them on ours). The file never leaves pipeline/private/.
 */
import type { AttributeKey } from "@fgm/sim-core";
import type { Row } from "../matchups";
import { num } from "../matchups";
import type { RealPerson } from "./roster";

export interface MaddenPlayer {
  row: number;
  first: string;
  last: string;
  team: string;
  position: string;
  archetype: string;
  birthDate: string;
  overall: number;
  /** Madden attribute name -> value. */
  values: Record<string, number>;
}

/** Each of our attributes as a weighted mix of Madden's (the weights are relative). */
export const MADDEN_MAP: Record<AttributeKey, Record<string, number>> = {
  speed: { speed: 1 },
  acceleration: { acceleration: 1 },
  agility: { agility: 1, changeOfDirection: 1 },
  strength: { strength: 1 },
  jumping: { jumping: 1 },
  stamina: { stamina: 1 },
  throwPower: { throwPower: 1 },
  throwAccuracyShort: { throwAccuracyShort: 1, throwAccuracyMid: 1 },
  throwAccuracyDeep: { throwAccuracyDeep: 1 },
  vision: { bCVision: 1 },
  ballSecurity: { carrying: 1 },
  catching: { catching: 2, catchInTraffic: 1 },
  routeRunning: { shortRouteRunning: 1, mediumRouteRunning: 1, deepRouteRunning: 1 },
  release: { release: 1 },
  runBlocking: {
    runBlock: 2,
    runBlockPower: 1,
    runBlockFinesse: 1,
    impactBlocking: 1,
    leadBlock: 0.5,
  },
  passBlocking: { passBlock: 2, passBlockPower: 1, passBlockFinesse: 1 },
  // A rusher wins with his best move: see BEST_OF below.
  passRush: { powerMoves: 1, finesseMoves: 1 },
  blockShedding: { blockShedding: 1 },
  tackling: { tackle: 3, pursuit: 1 },
  manCoverage: { manCoverage: 3, press: 1 },
  zoneCoverage: { zoneCoverage: 1 },
  ballSkills: { catching: 1, spectacularCatch: 1, playRecognition: 1 },
  kickPower: { kickPower: 1 },
  kickAccuracy: { kickAccuracy: 1 },
  // Madden has no long-snapping rating; snappers get ratings from public data instead.
  snapping: { awareness: 1 },
  awareness: { awareness: 1 },
  decisionMaking: { awareness: 1, playRecognition: 1 },
  composure: { throwUnderPressure: 1, awareness: 1 },
};

/** Attributes where the better of the inputs counts more than the average. */
const BEST_OF: Partial<Record<AttributeKey, number>> = { passRush: 0.7 };

/** The first of these columns that exists (exports label columns differently). */
function pick(r: Row, names: string[]): string {
  for (const n of names) if (r[n] !== undefined && r[n] !== "") return r[n]!;
  return "";
}

const KNOWN = new Set(["lastName", "Team", "Position", "birthdate", "Archetype"]);

export function parseMadden(rows: Row[]): MaddenPlayer[] {
  return rows.map((raw, i) => {
    // Spreadsheet exports may start with a byte-order mark on the first header.
    const r: Row = {};
    for (const [k, v] of Object.entries(raw)) r[k.replace(/^\uFEFF/, "")] = v;
    const values: Record<string, number> = {};
    for (const [k, v] of Object.entries(r)) {
      const m = /^stats\/([A-Za-z]+)\/value$/.exec(k);
      if (m && v !== "") values[m[1]!] = num(v);
    }
    // Some exports mislabel the first-name column; it's always the first one.
    const firstColumn = Object.keys(r)[0] ?? "";
    return {
      row: i + 2,
      first: pick(r, ["firstName", "First Name", ...(KNOWN.has(firstColumn) ? [] : [firstColumn])]),
      last: pick(r, ["lastName", "Last Name"]),
      team: pick(r, ["Team"]),
      position: pick(r, ["Position"]),
      archetype: pick(r, ["Archetype"]),
      birthDate: maddenDate(pick(r, ["birthdate", "Birthdate"])),
      overall: num(pick(r, ["Overall", "overallRating", "stats/overall/value"])),
      values,
    };
  });
}

/**
 * "6/7/96" -> "1996-06-07". Some rows arrive already turned into a wrong ISO
 * date by the spreadsheet ("7/12/01" read as 2012-07-01): those are read back
 * as day-month-year.
 */
function maddenDate(v: string): string {
  const us = /^(\d+)\/(\d+)\/(\d+)$/.exec(v.trim());
  if (us) {
    let year = Number(us[3]);
    if (year < 100) year += year <= 30 ? 2000 : 1900;
    return `${year}-${us[1]!.padStart(2, "0")}-${us[2]!.padStart(2, "0")}`;
  }
  const iso = /^20(\d\d)-(\d\d)-(\d\d)$/.exec(v.trim());
  if (iso) {
    const yy = Number(iso[3]);
    return `${yy <= 30 ? 2000 + yy : 1900 + yy}-${iso[2]}-${iso[1]}`;
  }
  return "";
}

/** Lower case, no punctuation, no suffixes: "A.B. Example Jr." -> "ab example". */
export function normName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, "")
    .replace(/[^a-z ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export interface MaddenMatch {
  byGsis: Map<string, MaddenPlayer>;
  /** Madden entries no real player matched (cut, retired, or a name we couldn't link). */
  unmatchedMadden: MaddenPlayer[];
}

/**
 * Links Madden entries to real players: same last name and birth date first
 * (unique almost always), then the same full name with only one candidate.
 * `overrides` maps a Madden row number to a player id for anything left over.
 */
export function matchMadden(
  madden: MaddenPlayer[],
  people: RealPerson[],
  overrides: Map<number, string>,
): MaddenMatch {
  const byLastBirth = new Map<string, RealPerson[]>();
  const byFull = new Map<string, RealPerson[]>();
  for (const p of people) {
    const lb = `${normName(p.realLast)}|${p.birthDate}`;
    byLastBirth.set(lb, [...(byLastBirth.get(lb) ?? []), p]);
    for (const first of new Set(
      [p.realFirst, ...p.otherFirst].map((f) => normName(`${f} ${p.realLast}`)),
    )) {
      byFull.set(first, [...(byFull.get(first) ?? []), p]);
    }
  }
  const byGsis = new Map<string, MaddenPlayer>();
  const unmatchedMadden: MaddenPlayer[] = [];
  for (const m of madden) {
    const forced = overrides.get(m.row);
    let person: RealPerson | undefined = forced ? people.find((p) => p.gsis === forced) : undefined;
    if (!person) {
      const lb = byLastBirth.get(`${normName(m.last)}|${m.birthDate}`) ?? [];
      if (lb.length === 1) person = lb[0];
    }
    if (!person) {
      const full = byFull.get(normName(`${m.first} ${m.last}`)) ?? [];
      if (full.length === 1) person = full[0];
    }
    if (!person || byGsis.has(person.gsis)) {
      unmatchedMadden.push(m);
      continue;
    }
    byGsis.set(person.gsis, m);
  }
  return { byGsis, unmatchedMadden };
}

/** Our 28 attributes from a Madden entry, still on Madden's scale. */
export function rawAttributes(m: MaddenPlayer): Record<AttributeKey, number> {
  const out = {} as Record<AttributeKey, number>;
  for (const [key, mix] of Object.entries(MADDEN_MAP) as [AttributeKey, Record<string, number>][]) {
    let sum = 0;
    let weight = 0;
    const values: number[] = [];
    for (const [name, w] of Object.entries(mix)) {
      const v = m.values[name];
      if (v === undefined || Number.isNaN(v)) continue;
      sum += v * w;
      weight += w;
      values.push(v);
    }
    const average = weight > 0 ? sum / weight : 50;
    const best = BEST_OF[key];
    out[key] =
      best !== undefined && values.length > 0
        ? best * Math.max(...values) + (1 - best) * average
        : average;
  }
  return out;
}
