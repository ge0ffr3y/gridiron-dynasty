/**
 * How a League Year's market went (Phase 12), measured the way the real
 * targets were (calibration/market.json): free agents who changed teams (and
 * those paid 1%+ of the cap), re-signings, big extensions, tags, offer
 * sheets, and the top free agents' pay by position and tier against the real
 * range. `npm run sim -- --market N` prints it season by season.
 */
import { daysBetween } from "@fgm/foundation";
import marketData from "../../../../calibration/market.json";
import type { League } from "../league/schema";
import { salaryCap } from "./cap";
import { seasonDates } from "../season/calendar";

/** Free agents' tiers within a position's class (by pay), as in market.json. */
const TIERS: [string, number, number][] = [
  ["1", 1, 1],
  ["2-3", 2, 3],
  ["4-8", 4, 8],
  ["9-16", 9, 16],
  ["17-32", 17, 32],
];

export interface MarketSeason {
  season: number;
  freeAgentsNewTeam: number;
  freeAgentsNewTeamPaid1Pct: number;
  reSigned: number;
  reSignedPaid1Pct: number;
  extensionsPaid5Pct: number;
  franchiseTags: number;
  tenders: number;
  offerSheets: number;
  /** Signings with a new team in the first 3 days, the first week, and later (shares). */
  timing: { first3Days: number; firstWeek: number; later: number };
  /** Top-tier free agents (tiers 1 and 2-3 at each position) inside the real p10-p90 range. */
  topTierInRange: { inRange: number; deals: number };
  /** By position: the top free agent's share of the cap and the real p10-p90 for that tier. */
  topByPosition: { position: string; share: number; real: [number, number] }[];
}

const REAL_FA = marketData.freeAgents as Record<
  string,
  Record<string, { p10: number; p50: number; p90: number }>
>;

/** One League Year's market, from its transactions and free-agent records. */
export function marketSeason(league: League, season: number): MarketSeason {
  const cap = salaryCap(league.rules.cap, season);
  const leagueYear = seasonDates(league.rules, season).leagueYear;
  const inYear = league.transactions.filter(
    (t) => t.date.startsWith(`${season}-`) || t.date.startsWith(`${season + 1}-0`),
  );
  const moneyIn = (text: string) => {
    const m = /\$([\d.]+)M a year/.exec(text);
    return m ? Number(m[1]) * 1_000_000 : 0;
  };
  const resigns = inYear.filter((t) => t.type === "signed" && / re-signed /.test(t.text));
  const moves = league.freeAgentMoves.filter((m) => m.season === season);
  // Days into free agency (from the League Year).
  const dayOf = (date: string) => daysBetween(leagueYear, date);
  const timing = { first3Days: 0, firstWeek: 0, later: 0 };
  for (const m of moves) {
    const d = dayOf(m.date);
    if (d < 3) timing.first3Days += 1;
    else if (d < 7) timing.firstWeek += 1;
    else timing.later += 1;
  }
  const n = Math.max(1, moves.length);
  // Top tiers by position.
  let inRange = 0;
  let deals = 0;
  const topByPosition: MarketSeason["topByPosition"] = [];
  const byPos = new Map<string, number[]>();
  for (const m of moves)
    byPos.set(m.position, [...(byPos.get(m.position) ?? []), m.averagePerYear / cap]);
  for (const [position, shares] of [...byPos].sort()) {
    shares.sort((a, b) => b - a);
    const real = REAL_FA[position];
    if (!real) continue;
    shares.forEach((share, i) => {
      const tier = TIERS.find(([, lo, hi]) => i + 1 >= lo && i + 1 <= hi);
      if (!tier || (tier[0] !== "1" && tier[0] !== "2-3")) return;
      const r = real[tier[0]]!;
      deals += 1;
      if (share >= r.p10 && share <= r.p90) inRange += 1;
    });
    topByPosition.push({ position, share: shares[0]!, real: [real["1"]!.p10, real["1"]!.p90] });
  }
  return {
    season,
    freeAgentsNewTeam: moves.length,
    freeAgentsNewTeamPaid1Pct: moves.filter((m) => m.averagePerYear >= cap * 0.01).length,
    reSigned: resigns.length,
    reSignedPaid1Pct: resigns.filter((t) => moneyIn(t.text) >= cap * 0.01).length,
    // Extensions over the season before this League Year (they happen during the season).
    extensionsPaid5Pct: league.transactions.filter(
      (t) => t.type === "extended" && t.date >= `${season - 1}-03-11` && t.date < leagueYear,
    ).length,
    franchiseTags: inYear.filter((t) => t.type === "tagged" && t.text.includes("franchise tag"))
      .length,
    tenders: inYear.filter((t) => t.type === "tagged" && t.text.includes("tender")).length,
    offerSheets: inYear.filter((t) => t.type === "signed" && t.text.includes("offer sheet with"))
      .length,
    timing: {
      first3Days: timing.first3Days / n,
      firstWeek: timing.firstWeek / n,
      later: timing.later / n,
    },
    topTierInRange: { inRange, deals },
    topByPosition,
  };
}

export const REAL_MOVEMENT = marketData.movement;
