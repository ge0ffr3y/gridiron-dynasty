/**
 * Contract moves and their cap effects (Phase 7). Each has a preview (what
 * happens to the cap, without changing anything) and an action that applies
 * it and records a transaction with its reason (CLAUDE.md, rule 8).
 *
 * Rules (2020 CBA, Article 13, Section 6):
 * - Release or trade on or before June 1: all bonus proration still to come
 *   counts this League Year.
 * - After June 1, or with a June 1 designation (two per League Year): this
 *   year's proration stays this year; later years' count next League Year.
 * - Guaranteed salary still owed counts when he's released, either way.
 * - A traded player's new team carries none of his bonus; it takes the rest
 *   of the contract.
 * - A restructure turns salary into a bonus spread over this and later years
 *   (at most five, void years included).
 */
import type { Dollars } from "@fgm/foundation";
import type { Bonus, Contract, ContractYear, League, Player } from "../league/schema";
import { minimumSalary } from "./cap";
import {
  capHit,
  prorationSeasons,
  remainingGuarantees,
  remainingProration,
  span,
  yearOf,
} from "./contract";

/** June 1 of a League Year, the day the acceleration rules change. */
export function juneFirst(season: number): string {
  return `${season}-06-01`;
}

function findPlayer(league: League, playerId: number): Player & { contract: Contract } {
  const p = league.players.find((x) => x.id === playerId);
  if (!p) throw new Error(`no player ${playerId}`);
  if (!p.contract || p.contract.teamId !== p.teamId || p.teamId === null)
    throw new Error(`${p.firstName} ${p.lastName} isn't under contract with a team`);
  return p as Player & { contract: Contract };
}

export function recordTransaction(
  league: League,
  entry: Omit<League["transactions"][number], "id" | "date">,
): void {
  league.transactions.push({ id: league.nextIds.transaction++, date: league.date, ...entry });
}

function addDeadMoney(
  league: League,
  teamId: string,
  season: number,
  playerId: number,
  amount: Dollars,
  reason: string,
) {
  if (amount === 0) return;
  league.teams
    .find((t) => t.id === teamId)!
    .cap.deadMoney.push({ season, playerId, amount, reason });
}

const name = (p: Player) => `${p.firstName} ${p.lastName}`;
const money = (d: Dollars) => `$${(d / 1_000_000).toFixed(2)}M`;

// ---------------------------------------------------------------------------
// Release

export interface ReleaseEffects {
  /** Counted as if after June 1 (by date, or with a June 1 designation). */
  afterJuneFirst: boolean;
  capHitNow: Dollars;
  deadThisYear: Dollars;
  deadNextYear: Dollars;
  /** Cap room gained this League Year (negative: it costs room). */
  savingsThisYear: Dollars;
}

export function juneFirstDesignationsLeft(league: League, teamId: string): number {
  const team = league.teams.find((t) => t.id === teamId)!;
  const used = team.cap.juneFirstDesignations.filter((d) => d.season === league.season).length;
  return league.rules.cap.juneFirstDesignationsPerYear - used;
}

export function previewRelease(
  league: League,
  playerId: number,
  options: { juneFirstDesignation?: boolean } = {},
): ReleaseEffects {
  const p = findPlayer(league, playerId);
  const season = league.season;
  const afterJuneFirst = league.date > juneFirst(season) || !!options.juneFirstDesignation;
  const guarantees = remainingGuarantees(p.contract, season, league.date);
  const capHitNow = capHit(p.contract, season, league.rules.cap);
  const deadThisYear =
    (afterJuneFirst
      ? remainingProration(p.contract, season) - remainingProration(p.contract, season + 1)
      : remainingProration(p.contract, season)) + guarantees;
  const deadNextYear = afterJuneFirst ? remainingProration(p.contract, season + 1) : 0;
  return {
    afterJuneFirst,
    capHitNow,
    deadThisYear,
    deadNextYear,
    savingsThisYear: capHitNow - deadThisYear,
  };
}

export function releasePlayer(
  league: League,
  playerId: number,
  reason: string,
  options: { juneFirstDesignation?: boolean } = {},
): ReleaseEffects {
  const p = findPlayer(league, playerId);
  const teamId = p.teamId!;
  if (options.juneFirstDesignation) {
    if (league.date > juneFirst(league.season))
      throw new Error("June 1 designations are only for releases before June 2");
    if (juneFirstDesignationsLeft(league, teamId) <= 0)
      throw new Error(`no June 1 designations left this League Year`);
    league.teams
      .find((t) => t.id === teamId)!
      .cap.juneFirstDesignations.push({ season: league.season, playerId });
  }
  const effects = previewRelease(league, playerId, options);
  addDeadMoney(
    league,
    teamId,
    league.season,
    playerId,
    effects.deadThisYear,
    `Released ${name(p)}`,
  );
  addDeadMoney(
    league,
    teamId,
    league.season + 1,
    playerId,
    effects.deadNextYear,
    `Released ${name(p)} (after June 1)`,
  );
  p.teamId = null;
  (p as Player).contract = null;
  recordTransaction(league, {
    type: "released",
    teamIds: [teamId],
    playerIds: [playerId],
    text: `${teamId} released ${name(p)}${options.juneFirstDesignation ? " (June 1 designation)" : ""}: ${money(effects.deadThisYear)} dead money this year${effects.deadNextYear ? `, ${money(effects.deadNextYear)} next year` : ""}, ${money(effects.savingsThisYear)} saved.`,
    reason,
  });
  return effects;
}

// ---------------------------------------------------------------------------
// Trade

export interface TradeEffects {
  /** The old team's dead money this year and next, and room gained this year. */
  deadThisYear: Dollars;
  deadNextYear: Dollars;
  savingsThisYear: Dollars;
  /** What he counts on the new team this year (no bonus proration comes with him). */
  newTeamCapHit: Dollars;
}

/** The contract the new team takes over: same years, no bonus money (Article 13, Section 6(b)(ii)(3)). */
function contractAfterTrade(c: Contract, toTeamId: string): Contract {
  return { ...c, teamId: toTeamId, bonuses: [] };
}

export function previewTrade(league: League, playerId: number, toTeamId: string): TradeEffects {
  const p = findPlayer(league, playerId);
  const season = league.season;
  const afterJuneFirst = league.date > juneFirst(season);
  const capHitNow = capHit(p.contract, season, league.rules.cap);
  const deadThisYear = afterJuneFirst
    ? remainingProration(p.contract, season) - remainingProration(p.contract, season + 1)
    : remainingProration(p.contract, season);
  const deadNextYear = afterJuneFirst ? remainingProration(p.contract, season + 1) : 0;
  return {
    deadThisYear,
    deadNextYear,
    savingsThisYear: capHitNow - deadThisYear,
    newTeamCapHit: capHit(contractAfterTrade(p.contract, toTeamId), season, league.rules.cap),
  };
}

/** Moves a player and his contract to another team (picks and the trade itself are Phase 8). */
export function tradePlayer(
  league: League,
  playerId: number,
  toTeamId: string,
  reason: string,
): TradeEffects {
  const p = findPlayer(league, playerId);
  const fromTeamId = p.teamId!;
  if (fromTeamId === toTeamId) throw new Error("he's already on that team");
  const effects = previewTrade(league, playerId, toTeamId);
  addDeadMoney(
    league,
    fromTeamId,
    league.season,
    playerId,
    effects.deadThisYear,
    `Traded ${name(p)}`,
  );
  addDeadMoney(
    league,
    fromTeamId,
    league.season + 1,
    playerId,
    effects.deadNextYear,
    `Traded ${name(p)} (after June 1)`,
  );
  p.contract = contractAfterTrade(p.contract, toTeamId);
  p.teamId = toTeamId;
  recordTransaction(league, {
    type: "traded",
    teamIds: [fromTeamId, toTeamId],
    playerIds: [playerId],
    text: `${fromTeamId} traded ${name(p)} to ${toTeamId}: ${money(effects.deadThisYear)} dead money for ${fromTeamId}, ${money(effects.newTeamCapHit)} on ${toTeamId}'s cap.`,
    reason,
  });
  return effects;
}

// ---------------------------------------------------------------------------
// Restructure

export interface RestructureEffects {
  converted: Dollars;
  /** Seasons the new bonus is spread over (void years included). */
  seasons: number[];
  /** Void years added to spread it further. */
  voidYearsAdded: number;
  /** Cap hits from this League Year on, before and after. */
  capHitBefore: Dollars[];
  capHitAfter: Dollars[];
  /** Room gained this League Year. */
  savingsThisYear: Dollars;
}

/** Appends `count` void years (no salary; they only carry bonus proration). */
function withVoidYears(c: Contract, count: number): Contract {
  const years: ContractYear[] = [...c.years];
  for (let i = 0; i < count; i++)
    years.push({
      season: years[years.length - 1]!.season + 1,
      base: 0,
      guaranteed: 0,
      injuryGuaranteed: 0,
      vestsOn: null,
      rosterBonus: 0,
      workoutBonus: 0,
      perGameBonus: 0,
      incentives: [],
      void: true,
    });
  return { ...c, years };
}

function restructured(
  league: League,
  p: Player & { contract: Contract },
  options: { amount?: Dollars; addVoidYears?: number },
): { contract: Contract; effects: RestructureEffects } {
  const season = league.season;
  const cap = league.rules.cap;
  const y = yearOf(p.contract, season);
  if (!y || y.void) throw new Error(`${name(p)} has no salary this League Year to convert`);
  const floor = minimumSalary(cap, season, p.experience);
  const convertible = Math.max(0, y.base - floor);
  const amount = Math.min(convertible, options.amount ?? convertible);
  if (amount <= 0) throw new Error(`${name(p)} has no salary above the minimum to convert`);
  const room = cap.maxProrationYears - (span(p.contract).last - season + 1);
  const voidYearsAdded = Math.max(0, Math.min(options.addVoidYears ?? 0, room));
  let contract = withVoidYears(p.contract, voidYearsAdded);
  const seasons = prorationSeasons(contract, season, cap.maxProrationYears);
  const bonus: Bonus = { amount, kind: "restructure", seasons, paidIn: season };
  contract = {
    ...contract,
    years: contract.years.map((x) =>
      x.season === season
        ? { ...x, base: x.base - amount, guaranteed: Math.min(x.guaranteed, x.base - amount) }
        : x,
    ),
    bonuses: [...contract.bonuses, bonus],
  };
  // From this League Year on (earlier years are history).
  const all = contract.years.map((x) => x.season).filter((s) => s >= season);
  const capHitBefore = all.map((s) => capHit(p.contract, s, cap));
  const capHitAfter = all.map((s) => capHit(contract, s, cap));
  return {
    contract,
    effects: {
      converted: amount,
      seasons,
      voidYearsAdded,
      capHitBefore,
      capHitAfter,
      savingsThisYear: capHitBefore[0]! - capHitAfter[0]!,
    },
  };
}

export function previewRestructure(
  league: League,
  playerId: number,
  options: { amount?: Dollars; addVoidYears?: number } = {},
): RestructureEffects {
  return restructured(league, findPlayer(league, playerId), options).effects;
}

export function restructureContract(
  league: League,
  playerId: number,
  reason: string,
  options: { amount?: Dollars; addVoidYears?: number } = {},
): RestructureEffects {
  const p = findPlayer(league, playerId);
  const { contract, effects } = restructured(league, p, options);
  p.contract = contract;
  recordTransaction(league, {
    type: "restructured",
    teamIds: [p.teamId!],
    playerIds: [playerId],
    text: `${p.teamId} restructured ${name(p)}: ${money(effects.converted)} of salary became a bonus spread over ${effects.seasons.length} years${effects.voidYearsAdded ? ` (${effects.voidYearsAdded} void)` : ""}, saving ${money(effects.savingsThisYear)} this year.`,
    reason,
  });
  return effects;
}

// ---------------------------------------------------------------------------
// Extension, pay cut, options

/**
 * Adds years to a contract with a new signing bonus, spread over the years
 * left plus the new ones (at most five: Article 13, Section 6(b)(i)(4)).
 */
export function extendContract(
  league: League,
  playerId: number,
  addYears: Omit<ContractYear, "season">[],
  signingBonus: Dollars,
  reason: string,
): Contract {
  const p = findPlayer(league, playerId);
  const season = league.season;
  // Void years at the end of the old deal are replaced by the new real years.
  const kept = p.contract.years.filter((y) => !y.void);
  const last = kept[kept.length - 1]!.season;
  const years = [...kept, ...addYears.map((y, i) => ({ ...y, season: last + 1 + i }))];
  const contract: Contract = { ...p.contract, type: "extension", signedOn: league.date, years };
  const seasons = prorationSeasons(contract, season, league.rules.cap.maxProrationYears);
  // Old bonuses spread onto the dropped void years now land on the years that replace them.
  contract.bonuses = [
    ...p.contract.bonuses,
    ...(signingBonus > 0
      ? [{ amount: signingBonus, kind: "signing" as const, seasons, paidIn: season }]
      : []),
  ];
  p.contract = contract;
  recordTransaction(league, {
    type: "extended",
    teamIds: [p.teamId!],
    playerIds: [playerId],
    text: `${p.teamId} extended ${name(p)} by ${addYears.length} year${addYears.length === 1 ? "" : "s"} with a ${money(signingBonus)} signing bonus.`,
    reason,
  });
  return contract;
}

/** Lowers this League Year's salary (only the part that isn't guaranteed can go). */
export function payCut(
  league: League,
  playerId: number,
  newBase: Dollars,
  reason: string,
): Dollars {
  const p = findPlayer(league, playerId);
  const y = yearOf(p.contract, league.season);
  if (!y) throw new Error(`${name(p)} has no salary this League Year`);
  const floor = Math.max(
    y.guaranteed,
    minimumSalary(league.rules.cap, league.season, p.experience),
  );
  const base = Math.max(floor, Math.min(y.base, newBase));
  const saved = y.base - base;
  y.base = base;
  recordTransaction(league, {
    type: "pay-cut",
    teamIds: [p.teamId!],
    playerIds: [playerId],
    text: `${name(p)} took a pay cut of ${money(saved)} for ${league.season}.`,
    reason,
  });
  return saved;
}

/**
 * Exercises (adds a fully guaranteed fifth year at `salary`) or declines a
 * first-round pick's fifth-year option.
 */
export function decideFifthYearOption(
  league: League,
  playerId: number,
  exercise: boolean,
  salary: Dollars,
  reason: string,
): void {
  const p = findPlayer(league, playerId);
  const option = p.contract.fifthYearOption;
  if (!option || option.exercised !== null)
    throw new Error(`${name(p)} has no open fifth-year option`);
  option.exercised = exercise;
  if (exercise)
    p.contract.years.push({
      season: option.season,
      base: salary,
      guaranteed: salary,
      injuryGuaranteed: 0,
      vestsOn: null,
      rosterBonus: 0,
      workoutBonus: 0,
      perGameBonus: 0,
      incentives: [],
      void: false,
    });
  recordTransaction(league, {
    type: "option",
    teamIds: [p.teamId!],
    playerIds: [playerId],
    text: `${p.teamId} ${exercise ? `exercised ${name(p)}'s fifth-year option (${money(salary)}, guaranteed)` : `declined ${name(p)}'s fifth-year option`}.`,
    reason,
  });
}
