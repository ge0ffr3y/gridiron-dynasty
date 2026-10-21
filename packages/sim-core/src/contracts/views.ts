/**
 * Screen data for contracts and the salary cap (Phase 7b): a player's
 * contract year by year, a team's cap sheet for four League Years, and "what
 * if" previews of the moves teams make for room (release before or after
 * June 1, trade, restructure). Until GM Mode (Phase 14) the league office can
 * make these moves for any team, so the math can be checked in the app.
 *
 * Previews apply the move to a light copy of the league and read the cap
 * sheet before and after, so they show the real change in room, including the
 * offseason top-51 rule (cutting one player can pull the 52nd into the count).
 */
import { ageOn, type Position } from "@fgm/foundation";
import type { League, Player } from "../league/schema";
import { perceivePlayer, type Viewer } from "../perception";
import { salaryCap } from "./cap";
import {
  capHit,
  capParts,
  cashIn,
  guaranteedAtSigning,
  remainingGuarantees,
  remainingProration,
  span,
  totalValue,
  yearOf,
} from "./contract";
import {
  juneFirst,
  juneFirstDesignationsLeft,
  previewRelease,
  previewRestructure,
  previewTrade,
  releasePlayer,
  restructureContract,
  tradePlayer,
} from "./operations";
import { capSheet, playersOn } from "./team";

/** League Years a cap sheet looks ahead (this one and the next three). */
export const CAP_SHEET_YEARS = 4;
/** Why every league-office move is made, until GM Mode. */
const OFFICE_REASON = "League office move (any team, until GM Mode in Phase 14).";

export interface ContractYearRow {
  season: number;
  void: boolean;
  /** This League Year. */
  current: boolean;
  base: number;
  /** This year's share of signing, option and restructure bonuses. */
  proration: number;
  rosterBonus: number;
  workoutBonus: number;
  perGameBonus: number;
  /** Likely-to-be-earned incentives (they count on the cap now). */
  likelyIncentives: number;
  guaranteed: number;
  capHit: number;
  /** Cash he's paid that year (bonuses when paid, salary, roster bonuses). */
  cash: number;
  /** Dead money if he were released before June 1 of that year (proration left + guarantees left). */
  deadIfCut: number;
}

export type CapMoveKind = "release" | "release-june-1" | "trade" | "restructure";

export interface CapMovePreview {
  kind: CapMoveKind;
  label: string;
  /** Whether the league office can make this move now (trades are previews until Phase 8). */
  available: boolean;
  /** Why it isn't available, or a note on how it's counted. */
  note: string;
  deadThisYear: number;
  deadNextYear: number;
  /** The team's cap room this year and next, before and after. */
  roomNow: { before: number; after: number };
  roomNext: { before: number; after: number };
}

export interface ContractView {
  playerId: number;
  name: string;
  position: Position;
  team: { id: string; name: string } | null;
  season: number;
  date: string;
  type: string;
  signedOn: string;
  totalValue: number;
  averagePerYear: number;
  guaranteedAtSigning: number;
  /** The last season with salary (void years after it only carry bonus proration). */
  lastSeason: number;
  voidYears: number;
  veteranSalaryBenefit: boolean;
  fifthYearOption: { season: number; exercised: boolean | null } | null;
  rows: ContractYearRow[];
  moves: CapMovePreview[];
}

export interface CapSheetYear {
  season: number;
  cap: number;
  carryover: number;
  adjustedCap: number;
  contracts: number;
  deadMoney: number;
  total: number;
  room: number;
  /** Only the top 51 count (this League Year's offseason). */
  topContractsRule: boolean;
  players: number;
}

export interface CapSheetPlayer {
  id: number;
  name: string;
  position: Position;
  age: number;
  overall: number;
  /** Cap hit by season (0 once his contract has ended). */
  capHits: number[];
  /** What counts now (outside the top 51 in the offseason, only bonus money). */
  counted: number;
  inTopContracts: boolean;
  lastSeason: number;
  /** Dead money if released before June 1 now. */
  deadIfCut: number;
}

export interface CapSheetView {
  team: { id: string; name: string };
  season: number;
  date: string;
  topContracts: number;
  juneFirstDesignationsLeft: number;
  years: CapSheetYear[];
  players: CapSheetPlayer[];
  deadMoney: { season: number; name: string | null; amount: number; reason: string }[];
}

function teamName(league: League, teamId: string): string {
  const t = league.teams.find((x) => x.id === teamId);
  return t ? `${t.city} ${t.nickname}` : teamId;
}

/**
 * A copy of the league that cap moves can change without touching the real one: the players,
 * teams' cap books and the transaction log are copied; everything else is shared (read only).
 */
function scratch(league: League): League {
  return {
    ...league,
    players: league.players.map((p) => ({ ...p })),
    teams: league.teams.map((t) => ({
      ...t,
      cap: {
        ...t.cap,
        deadMoney: [...t.cap.deadMoney],
        carryover: [...t.cap.carryover],
        juneFirstDesignations: [...t.cap.juneFirstDesignations],
      },
    })),
    transactions: [...league.transactions],
    nextIds: { ...league.nextIds },
  };
}

function rooms(league: League, teamId: string): [number, number] {
  return [
    capSheet(league, teamId, league.season).room,
    capSheet(league, teamId, league.season + 1).room,
  ];
}

/** Applies a move to a scratch copy and measures the team's room before and after. */
function measure(
  league: League,
  teamId: string,
  move: (copy: League) => void,
): Pick<CapMovePreview, "roomNow" | "roomNext"> {
  const [now, next] = rooms(league, teamId);
  const copy = scratch(league);
  move(copy);
  const [nowAfter, nextAfter] = rooms(copy, teamId);
  return {
    roomNow: { before: now, after: nowAfter },
    roomNext: { before: next, after: nextAfter },
  };
}

function movePreviews(league: League, p: Player): CapMovePreview[] {
  const teamId = p.teamId!;
  const season = league.season;
  const beforeJuneSecond = league.date <= juneFirst(season);
  const moves: CapMovePreview[] = [];

  const release = previewRelease(league, p.id);
  moves.push({
    kind: "release",
    label: beforeJuneSecond ? "Release (before June 1)" : "Release (after June 1)",
    available: true,
    note: beforeJuneSecond
      ? "All bonus proration left and any guaranteed salary count this year."
      : "This year's proration and guarantees count this year; the rest moves to next year.",
    deadThisYear: release.deadThisYear,
    deadNextYear: release.deadNextYear,
    ...measure(league, teamId, (copy) => releasePlayer(copy, p.id, "preview")),
  });

  const designationsLeft = juneFirstDesignationsLeft(league, teamId);
  if (beforeJuneSecond) {
    const june = previewRelease(league, p.id, { juneFirstDesignation: true });
    const can = designationsLeft > 0;
    moves.push({
      kind: "release-june-1",
      label: "Release with a June 1 designation",
      available: can,
      note: can
        ? `Counted as after June 1: only this year's proration hits now, the rest next year (${designationsLeft} designation${designationsLeft === 1 ? "" : "s"} left).`
        : "No June 1 designations left this League Year (two a year).",
      deadThisYear: june.deadThisYear,
      deadNextYear: june.deadNextYear,
      ...(can
        ? measure(league, teamId, (copy) =>
            releasePlayer(copy, p.id, "preview", { juneFirstDesignation: true }),
          )
        : measure(league, teamId, () => {})),
    });
  }

  // A trade: the old team keeps the bonus proration; another team takes his salary.
  const other = league.teams.find((t) => t.id !== teamId)!.id;
  const trade = previewTrade(league, p.id, other);
  moves.push({
    kind: "trade",
    label: "Trade him away",
    available: false,
    note: `Preview only (trades arrive in Phase 8). The new team would carry $${(trade.newTeamCapHit / 1_000_000).toFixed(2)}M this year: his salary, no bonus money.`,
    deadThisYear: trade.deadThisYear,
    deadNextYear: trade.deadNextYear,
    ...measure(league, teamId, (copy) => tradePlayer(copy, p.id, other, "preview")),
  });

  let restructure: ReturnType<typeof previewRestructure> | null = null;
  let why = "";
  try {
    restructure = previewRestructure(league, p.id);
  } catch (e) {
    why = e instanceof Error ? e.message : String(e);
  }
  moves.push({
    kind: "restructure",
    label: "Restructure",
    available: restructure !== null && restructure.savingsThisYear > 0,
    note: restructure
      ? `Turns $${(restructure.converted / 1_000_000).toFixed(2)}M of this year's salary into a bonus spread over ${restructure.seasons.length} year${restructure.seasons.length === 1 ? "" : "s"}: room now, more on the cap later.`
      : `Not possible: ${why}.`,
    deadThisYear: 0,
    deadNextYear: 0,
    ...(restructure
      ? measure(league, teamId, (copy) => restructureContract(copy, p.id, "preview"))
      : measure(league, teamId, () => {})),
  });
  return moves;
}

export function contractView(league: League, playerId: number): ContractView {
  const p = league.players.find((x) => x.id === playerId);
  if (!p) throw new Error(`no player ${playerId}`);
  const c = p.contract;
  const season = league.season;
  const base: Omit<
    ContractView,
    | "type"
    | "signedOn"
    | "totalValue"
    | "averagePerYear"
    | "guaranteedAtSigning"
    | "lastSeason"
    | "voidYears"
    | "veteranSalaryBenefit"
    | "fifthYearOption"
    | "rows"
    | "moves"
  > = {
    playerId: p.id,
    name: `${p.firstName} ${p.lastName}`,
    position: p.position,
    team: p.teamId ? { id: p.teamId, name: teamName(league, p.teamId) } : null,
    season,
    date: league.date,
  };
  if (!c)
    return {
      ...base,
      type: "none",
      signedOn: "",
      totalValue: 0,
      averagePerYear: 0,
      guaranteedAtSigning: 0,
      lastSeason: 0,
      voidYears: 0,
      veteranSalaryBenefit: false,
      fifthYearOption: null,
      rows: [],
      moves: [],
    };
  const real = c.years.filter((y) => !y.void);
  const rows: ContractYearRow[] = c.years.map((y) => {
    const parts = capParts(c, y.season, league.rules.cap);
    return {
      season: y.season,
      void: y.void,
      current: y.season === season,
      base: y.void ? 0 : parts.base,
      proration: parts.proration,
      rosterBonus: y.rosterBonus,
      workoutBonus: y.workoutBonus,
      perGameBonus: y.perGameBonus,
      likelyIncentives: parts.incentives,
      guaranteed: y.guaranteed,
      capHit: capHit(c, y.season, league.rules.cap),
      cash: cashIn(c, y.season),
      deadIfCut:
        y.season >= season ? remainingProration(c, y.season) + remainingGuarantees(c, y.season) : 0,
    };
  });
  return {
    ...base,
    type: c.type,
    signedOn: c.signedOn,
    totalValue: totalValue(c),
    averagePerYear: Math.round(totalValue(c) / Math.max(1, real.length)),
    guaranteedAtSigning: guaranteedAtSigning(c),
    lastSeason: span(c).lastReal,
    voidYears: c.years.length - real.length,
    veteranSalaryBenefit: c.veteranSalaryBenefit,
    fifthYearOption: c.fifthYearOption,
    rows,
    moves: p.teamId && p.teamId === c.teamId && yearOf(c, season) ? movePreviews(league, p) : [],
  };
}

export function capSheetView(league: League, teamId: string, viewer: Viewer): CapSheetView {
  const team = league.teams.find((t) => t.id === teamId);
  if (!team) throw new Error(`no team ${teamId}`);
  const season = league.season;
  const seasons = Array.from({ length: CAP_SHEET_YEARS }, (_, i) => season + i);
  const sheets = seasons.map((s) => capSheet(league, teamId, s));
  const now = sheets[0]!;
  const counted = new Map(now.lines.map((l, i) => [l.playerId, { counted: l.counted, rank: i }]));
  const names = new Map(league.players.map((p) => [p.id, `${p.firstName} ${p.lastName}`]));
  const players: CapSheetPlayer[] = playersOn(league, teamId)
    .map((p) => {
      const c = p.contract!;
      return {
        id: p.id,
        name: `${p.firstName} ${p.lastName}`,
        position: p.position,
        age: ageOn(p.birthDate, league.date),
        overall: perceivePlayer(league, p, viewer).overall,
        capHits: seasons.map((s) => capHit(c, s, league.rules.cap)),
        counted: counted.get(p.id)?.counted ?? 0,
        inTopContracts:
          !now.topContractsRule ||
          (counted.get(p.id)?.rank ?? Infinity) < league.rules.cap.offseasonTopContracts,
        lastSeason: span(c).lastReal,
        deadIfCut: remainingProration(c, season) + remainingGuarantees(c, season, league.date),
      };
    })
    .sort((a, b) => b.capHits[0]! - a.capHits[0]! || a.id - b.id);
  return {
    team: { id: team.id, name: teamName(league, team.id) },
    season,
    date: league.date,
    topContracts: league.rules.cap.offseasonTopContracts,
    juneFirstDesignationsLeft: juneFirstDesignationsLeft(league, teamId),
    years: sheets.map((s) => ({
      season: s.season,
      cap: salaryCap(league.rules.cap, s.season),
      carryover: s.carryover,
      adjustedCap: s.adjustedCap,
      contracts: s.contracts,
      deadMoney: s.deadMoney,
      total: s.total,
      room: s.room,
      topContractsRule: s.topContractsRule,
      players: league.players.filter(
        (p) =>
          p.teamId === teamId &&
          p.contract?.teamId === teamId &&
          p.contract.years.some((y) => y.season === s.season && !y.void),
      ).length,
    })),
    players,
    deadMoney: team.cap.deadMoney
      .filter((d) => d.season >= season && d.season < season + CAP_SHEET_YEARS)
      .sort((a, b) => a.season - b.season || b.amount - a.amount)
      .map((d) => ({
        season: d.season,
        name: d.playerId >= 0 ? (names.get(d.playerId) ?? null) : null,
        amount: d.amount,
        reason: d.reason,
      })),
  };
}

/** A league-office cap move, made for real (recorded with its reason). */
export function makeCapMove(league: League, playerId: number, kind: CapMoveKind): string {
  const p = league.players.find((x) => x.id === playerId);
  if (!p?.teamId || !p.contract) throw new Error("He isn't under contract with a team.");
  const before = league.transactions.length;
  if (kind === "release") releasePlayer(league, playerId, OFFICE_REASON);
  else if (kind === "release-june-1")
    releasePlayer(league, playerId, OFFICE_REASON, { juneFirstDesignation: true });
  else if (kind === "restructure") restructureContract(league, playerId, OFFICE_REASON);
  else throw new Error("Trades arrive in Phase 8; this one is a preview only.");
  return league.transactions
    .slice(before)
    .map((t) => t.text)
    .join(" ");
}
