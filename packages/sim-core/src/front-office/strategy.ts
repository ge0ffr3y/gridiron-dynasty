/**
 * How a GM's knobs and his team's stance move its offseason decisions (Phase 13). Each piece
 * plugs into the existing machinery instead of replacing it:
 * - free agency: what a team will pay a player (`teamLimit`) and how much it spends
 *   (`teamBudget`): contenders pay for veterans, rebuilders for youth, analytics GMs by position
 *   value, loyal GMs for their own players; cap-aggressive GMs and big-spending owners spend more;
 * - draft boards: need vs. best player available, and taste for risk;
 * - the cap: cap-aggressive GMs restructure (with void years) to buy room now, whether they
 *   need it or not, and pay later;
 * - extensions: patient and loyal GMs extend their young core a year early.
 */
import { ageOn, type Position } from "@fgm/foundation";
import type { League, Player } from "../league/schema";
import { salaryCap } from "../contracts/cap";
import { yearOf, yearsLeft } from "../contracts/contract";
import { previewRestructure, restructureContract } from "../contracts/operations";
import { capSheet } from "../contracts/team";
import { stanceOf } from "./evaluate";
import { gmStyle, ownerStyle } from "./executives";

export const STRATEGY = {
  /** Free agency: a contender pays up to this much more for a veteran (27+) in his prime... */
  contendVeteran: 0.08,
  veteranAge: 27,
  /** ...a rebuilder this much less for a player 29+, and this much more for one 25 or younger. */
  rebuildOld: 0.15,
  oldAge: 29,
  rebuildYoung: 0.05,
  youngAge: 25,
  /** Analytics GMs pay by position value (share per analytics point; judgment from the market). */
  positionValue: {
    QB: 0.03,
    RB: -0.15,
    FB: -0.1,
    WR: 0,
    TE: -0.03,
    OT: 0.04,
    OG: -0.03,
    C: -0.02,
    EDGE: 0.05,
    DT: 0,
    LB: -0.06,
    CB: 0.04,
    S: -0.03,
    K: -0.05,
    P: -0.05,
    LS: -0.05,
  } satisfies Record<Position, number>,
  /** Loyal GMs pay their own players up to this much more. */
  loyalty: 0.08,
  /** A GM's limit moves at most this far either way. */
  limitRange: [0.75, 1.25] as [number, number],
  /** Budget: cap-aggressive GMs and big-spending owners spend this share of the cap more (or less). */
  budgetCapAggression: 0.04,
  budgetOwner: 0.02,
  /** Rebuilders keep this share of the cap back. */
  budgetRebuild: 0.03,
  /** Restructures: GMs at least this cap-aggressive restructure to buy room even without needing it. */
  aggressiveFrom: 0.3,
  /** ...up to this many contracts a year (more for the most aggressive), with void years from this. */
  aggressiveMoves: 2,
  voidYearsFrom: 0.6,
  /** ...and stop once next year's commitments reach this share of next year's cap. */
  aggressiveNextYearLimit: 1.02,
  /** Early extensions: patient or loyal GMs extend starters this young with two years left. */
  earlyExtensionAge: 26,
  earlyExtensionFrom: 0.3,
} as const;

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** How much a GM's style and stance move what his team will pay a player (a multiplier). */
export function gmLimitFactor(league: League, teamId: string, p: Player): number {
  const S = STRATEGY;
  const gm = gmStyle(league, teamId);
  const stance = stanceOf(league, teamId);
  const age = ageOn(p.birthDate, league.date);
  let f = 1;
  if (stance === "contend" && age >= S.veteranAge)
    f += S.contendVeteran * (1 + 0.5 * gm.futureDiscount);
  if (stance === "rebuild") {
    if (age >= S.oldAge) f -= S.rebuildOld;
    else if (age <= S.youngAge) f += S.rebuildYoung;
  }
  f += gm.analytics * (S.positionValue[p.position] ?? 0);
  if (p.teamId === teamId) f += S.loyalty * gm.loyalty;
  return clamp(f, S.limitRange[0], S.limitRange[1]);
}

/** How much more (or less) than its plain budget a team spends this League Year (dollars). */
export function gmBudgetShift(league: League, teamId: string): number {
  const S = STRATEGY;
  const cap = salaryCap(league.rules.cap, league.season);
  const gm = gmStyle(league, teamId);
  const owner = ownerStyle(league, teamId);
  let share = S.budgetCapAggression * gm.capAggression + S.budgetOwner * owner.budget;
  if (stanceOf(league, teamId) === "rebuild") share -= S.budgetRebuild;
  return Math.round(cap * share);
}

/** A draft philosophy from the GM: need vs. talent, and taste for risk. */
export function gmDraftLeaning(league: League, teamId: string): { need: number; risk: number } {
  const gm = gmStyle(league, teamId);
  // Win-now GMs draft for need; analytics GMs take the best player available.
  const need = clamp(0.5 + 0.35 * gm.futureDiscount - 0.35 * gm.analytics, 0, 1);
  return { need, risk: gm.risk };
}

/**
 * At the new League Year: cap-aggressive GMs restructure their biggest deals to buy room now
 * (the most aggressive add void years), whether they need the room or not. Returns the moves.
 */
export function aggressiveRestructures(league: League): number {
  const S = STRATEGY;
  let n = 0;
  const season = league.season;
  const nextCap = salaryCap(league.rules.cap, season + 1);
  for (const team of [...league.teams].sort((a, b) => a.id.localeCompare(b.id))) {
    const gm = gmStyle(league, team.id);
    if (gm.capAggression < S.aggressiveFrom || stanceOf(league, team.id) === "rebuild") continue;
    const moves = Math.round(S.aggressiveMoves * gm.capAggression);
    const voidYears = gm.capAggression >= S.voidYearsFrom ? 1 : 0;
    for (let i = 0; i < moves; i++) {
      const best = league.players
        .filter(
          (p) =>
            p.teamId === team.id &&
            p.contract &&
            p.contract.teamId === team.id &&
            yearsLeft(p.contract, season) >= 2 &&
            (yearOf(p.contract, season)?.base ?? 0) > 0,
        )
        .map((p) => {
          try {
            return { p, e: previewRestructure(league, p.id, { addVoidYears: voidYears }) };
          } catch {
            return null;
          }
        })
        .filter((x): x is NonNullable<typeof x> => x !== null && x.e.savingsThisYear > 0)
        .sort((a, b) => b.e.savingsThisYear - a.e.savingsThisYear || a.p.id - b.p.id)[0];
      if (!best) break;
      const addedNext = (best.e.capHitAfter[1] ?? 0) - (best.e.capHitBefore[1] ?? 0);
      if (
        capSheet(league, team.id, season + 1).total + addedNext >
        nextCap * S.aggressiveNextYearLimit
      )
        break;
      restructureContract(
        league,
        best.p.id,
        `A cap-aggressive GM turns salary into bonus${voidYears ? " with a void year" : ""} to spend now and pay later.`,
        { addVoidYears: voidYears },
      );
      n += 1;
    }
  }
  return n;
}

/** Would this GM extend this young starter a year early (two years left)? */
export function wantsEarlyExtension(league: League, teamId: string, p: Player): boolean {
  const S = STRATEGY;
  const gm = gmStyle(league, teamId);
  if (gm.futureDiscount > -S.earlyExtensionFrom && gm.loyalty < S.earlyExtensionFrom) return false;
  return ageOn(p.birthDate, league.date) <= S.earlyExtensionAge;
}
