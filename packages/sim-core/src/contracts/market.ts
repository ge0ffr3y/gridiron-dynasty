/**
 * Market value (Phase 12): what a veteran is worth on the open market,
 * anchored to comparable contracts.
 *
 * 1. Rank: where he stands among the veterans at his position (players on
 *    rookie deals don't set the market), by the league's consensus read
 *    (perception.ts, the league office's view) adjusted for age: the market
 *    pays for the next few years, so a player past his peak is worth less
 *    than his rating today.
 * 2. Pay: the real pay at that rank (calibration/market.json `payByRank`,
 *    a share of the cap), blended with what the league itself pays at that
 *    rank today (its current deals), so big signings move the market and it
 *    grows with the cap.
 * 3. Shape: the years his age usually gets and the guarantees his pay usually
 *    carries (`yearsByAge`, `guaranteesByPay`).
 *
 * No random draws: values are the same however often a screen asks.
 */
import { ageOn, POSITIONS, type Dollars, type Position } from "@fgm/foundation";
import marketData from "../../../../calibration/market.json";
import type { Contract, League, Player } from "../league/schema";
import { ageCurve } from "../lifecycle/curves";
import { DEVELOPMENT } from "../lifecycle/config";
import { readOverall } from "../perception";
import { minimumSalary, salaryCap } from "./cap";
import { totalValue } from "./contract";

export const MARKET_MODEL = {
  /** Years of expected change (by the real age curve) the market prices in. */
  horizonYears: 2,
  /** Weight of the league's own current pay at a rank, against the real curve (0-1). */
  compsWeight: 0.35,
  /** The league's comps move a value at most this share away from the real curve. */
  compsBand: 0.15,
  /** Below this many veteran deals at a position, the league's comps aren't used. */
  minComps: 12,
  /** Past the last measured rank, a player is depth: the minimum plus this share of the cap at most. */
  depthPremiumOfCap: 0.002,
  /** How many ranks past the last measured one a depth premium fades over. */
  depthFade: 64,
};

const RANKS = marketData.ranks;
const PAY = marketData.payByRank as Record<string, number[]>;

/** The real pay (share of the cap) at a rank, interpolated between the measured ranks. */
export function realPayAtRank(position: Position, rank: number): number | null {
  const curve = PAY[position];
  if (!curve) return null;
  if (rank <= RANKS[0]!) return curve[0]!;
  for (let i = 0; i < RANKS.length - 1; i++) {
    const r0 = RANKS[i]!;
    const r1 = RANKS[i + 1]!;
    if (rank <= r1) return curve[i]! + ((curve[i + 1]! - curve[i]!) * (rank - r0)) / (r1 - r0);
  }
  return null; // past the measured ranks: depth
}

/** On a rookie contract still (rookies don't set the market). */
export function onRookieDeal(p: Player): boolean {
  return p.contract?.type === "rookie";
}

/** Average yearly value of a contract, and its share of the cap the year it was signed. */
export function contractShare(league: League, c: Contract): number {
  const realYears = c.years.length;
  const apy = totalValue(c) / Math.max(1, realYears);
  const signed = Number(c.signedOn.slice(0, 4));
  return apy / salaryCap(league.rules.cap, signed);
}

/** The market's view of a player: his consensus overall, adjusted for where his age is heading. */
export function marketQuality(league: League, p: Player): number {
  const overall = readOverall(league, p, { kind: "league" });
  const age = ageOn(p.birthDate, league.date);
  let change = 0;
  for (let k = 1; k <= MARKET_MODEL.horizonYears; k++) change += ageCurve(p.position, age + k);
  // Average change a year over the horizon, in rating points (growth counts, but less: it's a hope).
  const perYear = (change / MARKET_MODEL.horizonYears) * DEVELOPMENT.declinePointsPerSd;
  return overall + (perYear > 0 ? perYear / 2 : perYear);
}

interface Snapshot {
  /** Veterans' market quality at each position, best first (player ids). */
  order: Map<Position, number[]>;
  quality: Map<number, number>;
  /** The league's current veteran pay at each position, highest first (shares of the cap). */
  pay: Map<Position, number[]>;
}

const SNAPSHOTS = new WeakMap<League, { key: string; snapshot: Snapshot }>();

/** The market's standings, computed once per league date and roster size. */
function snapshot(league: League): Snapshot {
  // Once per date: signings within a step move the comps from the next step on.
  const key = `${league.date}:${league.players.length}`;
  const hit = SNAPSHOTS.get(league);
  if (hit && hit.key === key) return hit.snapshot;
  const order = new Map<Position, number[]>();
  const quality = new Map<number, number>();
  const pay = new Map<Position, number[]>();
  for (const pos of POSITIONS) {
    order.set(pos, []);
    pay.set(pos, []);
  }
  for (const p of league.players) {
    if (p.retiredAfter !== null || onRookieDeal(p)) continue;
    // Veterans: under a veteran deal, or free agents with NFL seasons behind them.
    if (p.teamId === null && p.experience === 0) continue;
    const q = marketQuality(league, p);
    quality.set(p.id, q);
    order.get(p.position)!.push(p.id);
    if (p.contract && p.teamId !== null && p.contract.type !== "minimum")
      pay.get(p.position)!.push(contractShare(league, p.contract));
  }
  for (const pos of POSITIONS) {
    order.get(pos)!.sort((a, b) => quality.get(b)! - quality.get(a)! || a - b);
    pay.get(pos)!.sort((a, b) => b - a);
  }
  const snap = { order, quality, pay };
  SNAPSHOTS.set(league, { key, snapshot: snap });
  return snap;
}

export interface MarketValue {
  /** Rank among veterans at his position by the market's view (1 = best). */
  rank: number;
  /** Average yearly value, and as a share of this League Year's cap. */
  apy: Dollars;
  share: number;
  /** Years and guaranteed share a deal like his usually has. */
  years: number;
  guaranteedShare: number;
  reason: string;
}

/** Years a veteran of this age usually signs for (deals paid 1%+ of the cap). */
export function typicalYears(age: number): number {
  const row =
    marketData.yearsByAge.find((r) => age >= r.ages[0]! && age <= r.ages[1]!) ??
    marketData.yearsByAge.at(-1)!;
  return Math.max(1, Math.round(row.years));
}

/** The guaranteed share of total value that deals at this pay usually carry. */
export function typicalGuarantee(share: number): number {
  const row =
    marketData.guaranteesByPay.find((r) => share >= r.share[0]! && share < r.share[1]!) ??
    marketData.guaranteesByPay.at(-1)!;
  return row.guaranteed;
}

/** A veteran's value on the market this League Year (or `season`). */
export function marketValue(league: League, p: Player, season = league.season): MarketValue {
  const snap = snapshot(league);
  const order = snap.order.get(p.position)!;
  // Where he'd slot in (he may be a prospect or a rookie being valued for an extension).
  const q = snap.quality.get(p.id) ?? marketQuality(league, p);
  let rank = order.findIndex((id) => id !== p.id && snap.quality.get(id)! < q) + 1;
  if (rank === 0) rank = order.filter((id) => id !== p.id).length + 1;
  const cap = salaryCap(league.rules.cap, season);
  const minimum = minimumSalary(league.rules.cap, season, p.experience);
  const real = realPayAtRank(p.position, rank);
  const age = ageOn(p.birthDate, league.date);
  if (real === null) {
    // Depth: the minimum, a little more for the first ones past the market's ranks.
    const last = RANKS.at(-1)!;
    const fade = Math.max(0, 1 - (rank - last) / MARKET_MODEL.depthFade);
    const apy = minimum + Math.round(cap * MARKET_MODEL.depthPremiumOfCap * fade);
    return {
      rank,
      apy,
      share: apy / cap,
      years: Math.min(2, typicalYears(age)),
      guaranteedShare: 0,
      reason: `Depth at ${p.position} (#${rank} among veterans): near the minimum.`,
    };
  }
  const league_ = snap.pay.get(p.position)!;
  const comp =
    league_.length >= MARKET_MODEL.minComps
      ? league_[Math.min(league_.length, rank) - 1]
      : undefined;
  // The league's own deals move the market, but only so far from the real curve (bidding wars
  // would otherwise feed on themselves year after year).
  const blended =
    comp === undefined
      ? real
      : (1 - MARKET_MODEL.compsWeight) * real + MARKET_MODEL.compsWeight * comp;
  const share = Math.max(
    real * (1 - MARKET_MODEL.compsBand),
    Math.min(real * (1 + MARKET_MODEL.compsBand), blended),
  );
  const apy = Math.max(minimum, Math.round(share * cap));
  return {
    rank,
    apy,
    share: apy / cap,
    years: typicalYears(age),
    guaranteedShare: typicalGuarantee(share),
    reason: `#${rank} among veterans at ${p.position} in the market's eyes: about ${(share * 100).toFixed(1)}% of the cap, where comparable deals sit.`,
  };
}
