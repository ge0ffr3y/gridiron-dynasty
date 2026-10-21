/**
 * A team's cap position (Phase 7): what its contracts, dead money and
 * carried-over room add up to against a League Year's salary cap.
 */
import type { Dollars } from "@fgm/foundation";
import type { League, Player, Team } from "../league/schema";
import { salaryCap } from "./cap";
import { capHit, proration, yearOf } from "./contract";

export function emptyTeamCap(): Team["cap"] {
  return { deadMoney: [], carryover: [], cashPaid: [], juneFirstDesignations: [] };
}

/** Between the start of the League Year and the first regular-season game, only the top 51 count in full. */
export function offseasonRuleApplies(league: League, season: number): boolean {
  return (
    season === league.season &&
    (league.calendar.stage === "offseason" || league.calendar.stage === "preseason")
  );
}

export interface CapSheetLine {
  playerId: number;
  capHit: Dollars;
  /** What counts now (outside the top 51 in the offseason, only bonus money counts). */
  counted: Dollars;
}

export interface CapSheet {
  season: number;
  cap: Dollars;
  carryover: Dollars;
  /** The cap plus carried-over room. */
  adjustedCap: Dollars;
  lines: CapSheetLine[];
  contracts: Dollars;
  deadMoney: Dollars;
  total: Dollars;
  room: Dollars;
  topContractsRule: boolean;
}

export function playersOn(league: League, teamId: string): Player[] {
  return league.players.filter((p) => p.teamId === teamId && p.contract?.teamId === teamId);
}

/** A team's cap sheet for a League Year (contracts as they stand now). */
export function capSheet(league: League, teamId: string, season: number): CapSheet {
  const team = league.teams.find((t) => t.id === teamId);
  if (!team) throw new Error(`no team ${teamId}`);
  const capRules = league.rules.cap;
  const topRule = offseasonRuleApplies(league, season);
  const lines: CapSheetLine[] = playersOn(league, teamId)
    .map((p) => ({ playerId: p.id, capHit: capHit(p.contract!, season, capRules) }))
    .filter((l) => l.capHit > 0)
    .sort((a, b) => b.capHit - a.capHit || a.playerId - b.playerId)
    .map((l, i) => {
      if (!topRule || i < capRules.offseasonTopContracts) return { ...l, counted: l.capHit };
      // Article 13, Section 6(a)(i): outside the top 51, salary doesn't count in the offseason; bonuses still do.
      const p = league.players.find((x) => x.id === l.playerId)!;
      const y = yearOf(p.contract!, season);
      const bonuses = y ? y.rosterBonus + y.workoutBonus : 0;
      return { ...l, counted: proration(p.contract!, season) + bonuses };
    });
  const contracts = lines.reduce((a, l) => a + l.counted, 0);
  const deadMoney = team.cap.deadMoney
    .filter((d) => d.season === season)
    .reduce((a, d) => a + d.amount, 0);
  const carryover = team.cap.carryover
    .filter((c) => c.season === season)
    .reduce((a, c) => a + c.amount, 0);
  const cap = salaryCap(capRules, season);
  const total = contracts + deadMoney;
  return {
    season,
    cap,
    carryover,
    adjustedCap: cap + carryover,
    lines,
    contracts,
    deadMoney,
    total,
    room: cap + carryover - total,
    topContractsRule: topRule,
  };
}

/** Teams over the cap in a League Year (the league must stay legal: CLAUDE.md rule 9). */
export function teamsOverCap(
  league: League,
  season = league.season,
): { teamId: string; room: Dollars }[] {
  return league.teams
    .map((t) => ({ teamId: t.id, room: capSheet(league, t.id, season).room }))
    .filter((t) => t.room < 0);
}

/**
 * Minimum Team Cash Spending (Article 12, Section 9): over each multi-year
 * period, a team must pay players at least 90% of the period's caps; any
 * shortfall is paid to its players after the period ends. Returns the
 * shortfall for the period ending in `season` (0 if none, or not a period end).
 */
export function cashSpendingShortfall(league: League, teamId: string, season: number): Dollars {
  const rule = league.rules.cap.minimumCashSpending;
  let period = rule.periods.find(([, end]) => end === season);
  if (!period) {
    // After the agreement: periods of `afterAgreementYears`, continuing from the last one.
    const lastEnd = Math.max(...rule.periods.map(([, end]) => end));
    if (season > lastEnd && (season - lastEnd) % rule.afterAgreementYears === 0)
      period = [season - rule.afterAgreementYears + 1, season];
  }
  if (!period) return 0;
  const team = league.teams.find((t) => t.id === teamId)!;
  let cash = 0;
  let caps = 0;
  for (let y = period[0]; y <= period[1]; y++) {
    const paid = team.cap.cashPaid.filter((c) => c.season === y);
    // Years before the league began have no record: they count as met (only recorded years are checked).
    if (paid.length === 0) continue;
    cash += paid.reduce((a, c) => a + c.amount, 0);
    caps += salaryCap(league.rules.cap, y);
  }
  return Math.max(0, Math.round(caps * rule.share) - cash);
}
