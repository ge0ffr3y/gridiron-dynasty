/**
 * Money at the turn of each League Year (Phase 7), until free agency
 * (Phase 12) and AI general managers (Phase 13) take over:
 *
 * 1. The year just ended: its top salaries are recorded (for tags), each
 *    team's cash spending is logged, and some unused room carries over.
 * 2. Contracts that ran out: void years accelerate their leftover bonus as
 *    dead money; the team re-signs the expiring players it can afford, best
 *    first, at a market value that fits the league to its cap; the rest
 *    become free agents (a placeholder for real free agency).
 * 3. First-round picks entering year four: the fifth-year option is decided.
 * 4. Any team over the new cap gets legal the way real teams do:
 *    restructures first, then releases, each with its reason.
 * 5. Thin rosters sign free agents to minimum deals (until Phase 8).
 */
import { overallAt, Rng, streamSeed, type Dollars } from "@fgm/foundation";
import { POSITIONS } from "@fgm/foundation";
import type { Contract, League, Player } from "../league/schema";
import { ROSTER_MIX, STARTERS } from "../generate/config";
import { minimumSalary, salaryCap } from "./cap";
import { capHit, cashIn, remainingProration, span, yearOf, yearsLeft } from "./contract";
import { MARKET, marketRanks, marketValue, veteranContract, yearsForAge } from "./generate";
import {
  decideFifthYearOption,
  previewRelease,
  previewRestructure,
  recordTransaction,
  releasePlayer,
  restructureContract,
} from "./operations";
import { capSheet, cashSpendingShortfall, playersOn } from "./team";
import { fifthYearOptionSalary, recordSalaryHistory } from "./tags";

/** Seasons of dead money and carryover kept on file (older entries can't affect the cap any more). */
const KEEP_SEASONS = 3;
/** Snaps a full-time player plays in a season (for fifth-year option playing-time tiers). */
const FULL_SEASON_SNAPS = 17 * 64;
/** A first-round pick whose rank at his category is inside this share of starter slots gets his option exercised. */
const OPTION_STARTER_SHARE = 0.75;
/** Most of a cap AI teams carry into the next League Year (placeholder until Phase 13's AI GMs). */
const CARRYOVER_MAX_SHARE = 0.05;
/** Bounds on how far the re-signing market can move from market value in one year. */
const RESIGN_SCALE: [number, number] = [0.7, 1.6];
/** Roster size AI teams refill to in the offseason with minimum signings (placeholder until Phase 8). */
const ROSTER_FLOOR = 80;
/** Restructures and releases tried per team before giving up (it never should need this many). */
const MAX_COMPLIANCE_MOVES = 40;

const ageOn = (birthDate: string, date: string) => {
  const [by, bm, bd] = birthDate.split("-").map(Number) as [number, number, number];
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
};

/** Before the season counter moves on: record the year that just ended. */
export function closeLeagueYear(league: League): void {
  const season = league.season;
  recordSalaryHistory(league, season);
  for (const team of league.teams) {
    // A brand-new league's teams have no contracts yet: nothing to carry over.
    if (playersOn(league, team.id).length === 0) continue;
    const sheet = capSheet(league, team.id, season);
    const cash = playersOn(league, team.id).reduce((a, p) => a + cashIn(p.contract!, season), 0);
    team.cap.cashPaid.push({ season, amount: cash + sheet.deadMoney });
    const shortfall = cashSpendingShortfall(league, team.id, season);
    if (shortfall > 0)
      recordTransaction(league, {
        type: "cash-shortfall",
        teamIds: [team.id],
        playerIds: [],
        text: `${team.id} paid its players $${(shortfall / 1_000_000).toFixed(2)}M to meet the minimum cash spending rule.`,
        reason:
          "Teams must pay players at least 90% of the salary caps over each multi-year period (CBA Article 12, Section 9).",
      });
    settleIncentives(league, team.id, sheet.room);
    // Carry over unused room (the CBA allows all of it). Until free agency lets teams spend it,
    // AI teams carry over a modest amount so room doesn't snowball.
    const carry = Math.min(
      sheet.room,
      Math.round(salaryCap(league.rules.cap, season) * CARRYOVER_MAX_SHARE),
    );
    if (carry > 0) team.cap.carryover.push({ season: season + 1, amount: carry });
  }
}

/**
 * Year-end incentive accounting (Article 13, Section 6(c)). Incentives were
 * counted on the cap if "likely" (he reached the mark the year before). Now
 * that the season is over:
 * - if the "not likely" ones he earned exceed the "likely" ones he didn't,
 *   the difference beyond the team's room is charged to next year's cap;
 * - if the reverse, the overage beyond the team's room is credited to next year;
 * - next year's incentives become likely or not by whether he earned them now.
 */
export function settleIncentives(league: League, teamId: string, room: Dollars): Dollars {
  const season = league.season;
  let earnedNotLikely = 0;
  let missedLikely = 0;
  for (const p of playersOn(league, teamId)) {
    const y = yearOf(p.contract!, season);
    if (!y || y.incentives.length === 0) continue;
    const games = p.stats.find((st) => st.season === season && st.teamId === teamId)?.line.gp ?? 0;
    for (const incentive of y.incentives) {
      const earned = games >= incentive.games;
      if (earned && !incentive.likely) earnedNotLikely += incentive.amount;
      if (!earned && incentive.likely) missedLikely += incentive.amount;
      // Next year's matching incentive: likely if he reached it this year.
      for (const next of yearOf(p.contract!, season + 1)?.incentives ?? [])
        if (next.games === incentive.games) next.likely = earned;
    }
  }
  const team = league.teams.find((t) => t.id === teamId)!;
  const net = earnedNotLikely - missedLikely;
  const beyondRoom = Math.max(0, Math.abs(net) - Math.max(0, room));
  if (net > 0 && beyondRoom > 0)
    team.cap.deadMoney.push({
      season: season + 1,
      playerId: -1,
      amount: beyondRoom,
      reason: `Incentives earned in ${season} beyond the cap room`,
    });
  if (net < 0 && beyondRoom > 0)
    team.cap.carryover.push({ season: season + 1, amount: beyondRoom });
  return net > 0 ? beyondRoom : -beyondRoom;
}

/** After the season counter has moved on: expirations, options, re-signings, compliance. */
export function openLeagueYear(league: League): void {
  const season = league.season;
  const rng = new Rng(streamSeed(league.meta.seed, `contracts:${season}`));
  const ranks = marketRanks(league);

  for (const team of league.teams) {
    team.cap.deadMoney = team.cap.deadMoney.filter((d) => d.season > season - KEEP_SEASONS);
    team.cap.carryover = team.cap.carryover.filter((c) => c.season > season - KEEP_SEASONS);
    team.cap.cashPaid = team.cap.cashPaid.filter((c) => c.season > season - 8);
  }

  // Fifth-year options, then expiring deals. Players go in id order so results never depend on anything else.
  const expiring: Player[] = [];
  for (const p of [...league.players].sort((a, b) => a.id - b.id)) {
    const c = p.contract;
    if (!c || p.teamId === null) continue;
    if (
      c.fifthYearOption &&
      c.fifthYearOption.exercised === null &&
      c.fifthYearOption.season === season + 1
    )
      decideOption(league, p, ranks);
    if (span(p.contract!).lastReal >= season) continue;
    // The deal has run out. Void years accelerate whatever bonus they still carried.
    const leftover = remainingProration(p.contract!, season);
    if (leftover > 0)
      league.teams
        .find((t) => t.id === p.teamId)!
        .cap.deadMoney.push({
          season,
          playerId: p.id,
          amount: leftover,
          reason: `${p.firstName} ${p.lastName}'s void years`,
        });
    p.contract = null;
    expiring.push(p);
  }

  // Get legal with the players still under contract, then re-sign the best expiring players the
  // team can afford while keeping enough room to fill out its roster.
  for (const team of league.teams) getUnderCap(league, team.id);
  const scale = reSigningScale(league, expiring, ranks);
  const priceOf = (p: Player) => {
    const r = ranks.get(p.id)!;
    return marketValue(league, season, r.category, r.rank, p.experience, scale);
  };
  for (const team of league.teams) {
    const mine = expiring
      .filter((p) => p.teamId === team.id)
      .sort((a, b) => keepValue(b, league.date) - keepValue(a, league.date) || a.id - b.id);
    for (const p of mine) {
      const apy = priceOf(p);
      const years = yearsForAge(rng, ageOn(p.birthDate, league.date));
      const contract = veteranContract(league, rng, p, team.id, season, apy, years);
      if (canAfford(league, team.id, capHit(contract, season, league.rules.cap), 1)) {
        p.contract = contract;
        recordTransaction(league, {
          type: "signed",
          teamIds: [team.id],
          playerIds: [p.id],
          text: `${team.id} re-signed ${p.firstName} ${p.lastName}: ${years} year${years === 1 ? "" : "s"}, $${(apy / 1_000_000).toFixed(2)}M a year.`,
          reason:
            "Placeholder until free agency (Phase 12): a team keeps the expiring players it can afford, best first, at their market value.",
        });
      } else {
        p.teamId = null;
        recordTransaction(league, {
          type: "expired",
          teamIds: [team.id],
          playerIds: [p.id],
          text: `${p.firstName} ${p.lastName}'s contract with ${team.id} ran out; he's a free agent.`,
          reason: `${team.id} couldn't fit his market value ($${(apy / 1_000_000).toFixed(2)}M a year) under the ${season} cap and still fill its roster.`,
        });
      }
    }
  }

  // A simple free-agent market: the best free agents sign, at their market value, with the team
  // that has the most room and a roster spot.
  const offseasonMax = league.rules.roster.offseasonMax;
  const freeAgents = league.players
    .filter((p) => p.teamId === null && ranks.has(p.id))
    .sort((a, b) => priceOf(b) - priceOf(a) || a.id - b.id);
  for (const p of freeAgents) {
    const apy = priceOf(p);
    const minimum = minimumSalary(league.rules.cap, season, p.experience);
    if (apy <= minimum) break; // the rest are minimum-salary players: roster filling takes them
    const rooms = league.teams
      .map((t) => ({ id: t.id, room: capSheet(league, t.id, season).room }))
      .sort((a, b) => b.room - a.room || a.id.localeCompare(b.id));
    const years = yearsForAge(rng, ageOn(p.birthDate, league.date));
    for (const t of rooms) {
      const contract = veteranContract(league, rng, p, t.id, season, apy, years);
      if (!canAfford(league, t.id, capHit(contract, season, league.rules.cap), 1)) continue;
      // A full roster makes space by cutting its weakest cheap player at his position, if he's worse.
      if (league.players.filter((x) => x.teamId === t.id).length >= offseasonMax) {
        const cut = playersOn(league, t.id)
          .filter(
            (x) =>
              x.position === p.position &&
              capHit(x.contract!, season, league.rules.cap) <= 2 * minimum,
          )
          .filter((x) => overallAt(x.ratings, x.position) < overallAt(p.ratings, p.position))
          .sort(
            (a, b) =>
              overallAt(a.ratings, a.position) - overallAt(b.ratings, b.position) || a.id - b.id,
          )[0];
        if (!cut) continue;
        releasePlayer(
          league,
          cut.id,
          `Roster full; cut to make room for free agent ${p.firstName} ${p.lastName}, a better ${p.position}.`,
        );
      }
      p.teamId = t.id;
      p.contract = contract;
      recordTransaction(league, {
        type: "signed",
        teamIds: [t.id],
        playerIds: [p.id],
        text: `${t.id} signed free agent ${p.firstName} ${p.lastName}: ${years} year${years === 1 ? "" : "s"}, $${(apy / 1_000_000).toFixed(2)}M a year.`,
        reason:
          "Placeholder until free agency (Phase 12): free agents sign at their market value with the team that has the most cap room and a roster spot.",
      });
      break;
    }
  }
  for (const team of league.teams) fillRoster(league, team.id);
}

/**
 * Whether a team can take on `capCharge` (for `adding` players) and still
 * afford minimum deals for the rest of a full offseason roster.
 */
function canAfford(league: League, teamId: string, capCharge: Dollars, adding: number): boolean {
  const season = league.season;
  const roster = league.players.filter(
    (p) => p.teamId === teamId && p.contract?.teamId === teamId,
  ).length;
  const stillNeeded = Math.max(0, ROSTER_FLOOR - roster - adding);
  const reserve = stillNeeded * minimumSalary(league.rules.cap, season, 0);
  return capSheet(league, teamId, season).room - capCharge >= reserve;
}

/**
 * How expiring players are priced this year. Free agency in the real league
 * spends teams' room; until it exists here (Phase 12), the market for expiring
 * players is set so that, league-wide, re-signing them would use the room
 * teams have left (keeping the usual few percent free), within sensible bounds.
 */
function reSigningScale(
  league: League,
  expiring: Player[],
  ranks: ReturnType<typeof marketRanks>,
): number {
  const season = league.season;
  let room = 0;
  for (const team of league.teams) {
    const sheet = capSheet(league, team.id, season);
    room += sheet.room - sheet.adjustedCap * MARKET.targetRoomShare;
  }
  const atMarket = expiring.reduce((a, p) => {
    const r = ranks.get(p.id)!;
    return a + marketValue(league, season, r.category, r.rank, p.experience);
  }, 0);
  return Math.min(RESIGN_SCALE[1], Math.max(RESIGN_SCALE[0], room / Math.max(1, atMarket)));
}

/** A first-round pick's fifth-year option: exercised for starter-level players. */
function decideOption(league: League, p: Player, ranks: ReturnType<typeof marketRanks>): void {
  const season = league.season;
  const option = p.contract!.fifthYearOption!;
  const rank = ranks.get(p.id);
  const starterSlots = league.teams.length * (rank ? MARKET.starters[rank.category] : 1);
  const exercise = !!rank && rank.rank <= starterSlots * OPTION_STARTER_SHARE;
  const shares = p.stats
    .filter((s) => s.season >= season - 3 && s.season < season)
    .map((s) => Math.min(1, ((s.line.offSnaps ?? 0) + (s.line.defSnaps ?? 0)) / FULL_SEASON_SNAPS));
  decideFifthYearOption(
    league,
    p.id,
    exercise,
    fifthYearOptionSalary(league, p.position, option.season, shares),
    exercise
      ? "He's a starter-level player: worth his option year."
      : "Not a starter-level player: the option year costs more than he's worth.",
  );
}

/**
 * Keeps a roster at a healthy size by signing free agents to one-year
 * minimum deals where the team is thinnest (a stand-in for Phase 8's roster
 * upkeep). Veterans with four or more credited seasons sign under the veteran
 * salary benefit.
 */
export function fillRoster(league: League, teamId: string): number {
  const season = league.season;
  const cap = league.rules.cap;
  let signed = 0;
  for (;;) {
    const roster = league.players.filter((p) => p.teamId === teamId);
    if (roster.length >= ROSTER_FLOOR) break;
    const deficits = POSITIONS.map((pos) => ({
      pos,
      need: ROSTER_MIX[pos] - roster.filter((p) => p.position === pos).length,
    })).sort((a, b) => b.need - a.need || POSITIONS.indexOf(a.pos) - POSITIONS.indexOf(b.pos));
    let pick: Player | undefined;
    for (const { pos } of deficits) {
      pick = league.players
        .filter((p) => p.teamId === null && p.position === pos)
        .sort(
          (a, b) =>
            overallAt(b.ratings, b.position) - overallAt(a.ratings, a.position) || a.id - b.id,
        )[0];
      if (pick) break;
    }
    if (!pick) break;
    const vsb = pick.experience >= cap.veteranSalaryBenefit.minCreditedSeasons;
    const base = minimumSalary(cap, season, pick.experience);
    const contract: Contract = {
      teamId,
      type: "minimum",
      signedOn: league.date,
      years: [
        {
          season,
          base,
          guaranteed: 0,
          injuryGuaranteed: 0,
          vestsOn: null,
          rosterBonus: 0,
          workoutBonus: 0,
          perGameBonus: 0,
          incentives: [],
          void: false,
        },
      ],
      bonuses: [],
      fifthYearOption: null,
      veteranSalaryBenefit: vsb,
    };
    if (capSheet(league, teamId, season).room < capHit(contract, season, cap)) break;
    pick.teamId = teamId;
    pick.contract = contract;
    signed += 1;
    recordTransaction(league, {
      type: "signed",
      teamIds: [teamId],
      playerIds: [pick.id],
      text: `${teamId} signed free agent ${pick.firstName} ${pick.lastName} (${pick.position}) to a one-year minimum deal${vsb ? " (veteran salary benefit)" : ""}.`,
      reason: `Roster down to ${roster.length}; ${pick.position} was the thinnest spot. (Placeholder until Phase 8's roster upkeep.)`,
    });
  }
  return signed;
}

/** How much a player matters to his team, for choosing whom to let go: overall, a bonus for youth. */
function keepValue(p: Player, date: string): number {
  return overallAt(p.ratings, p.position) - Math.max(0, ageOn(p.birthDate, date) - 30);
}

/**
 * Restructures, then releases, until the team is under the cap. Restructures
 * go to the biggest salaries with years left to spread them over; releases
 * to whoever frees the most room for the least football value.
 */
export function getUnderCap(league: League, teamId: string): number {
  const season = league.season;
  let moves = 0;
  while (capSheet(league, teamId, season).room < 0 && moves < MAX_COMPLIANCE_MOVES) {
    moves += 1;
    const players = playersOn(league, teamId);
    const restructurable = players
      .filter(
        (p) => yearsLeft(p.contract!, season) >= 2 && (yearOf(p.contract!, season)?.base ?? 0) > 0,
      )
      .map((p) => {
        try {
          return { p, savings: previewRestructure(league, p.id).savingsThisYear };
        } catch {
          return null;
        }
      })
      .filter((x): x is { p: Player; savings: Dollars } => x !== null && x.savings > 0)
      .sort((a, b) => b.savings - a.savings || a.p.id - b.p.id);
    if (restructurable.length > 0) {
      const { p } = restructurable[0]!;
      restructureContract(
        league,
        p.id,
        `${teamId} was over the ${season} cap; turning salary into bonus frees room now.`,
      );
      continue;
    }
    // Never cut so deep that a position can't field its starters plus a backup.
    const count = (pos: string) => players.filter((x) => x.position === pos).length;
    const releasable = players
      .filter((p) => count(p.position) > (STARTERS[p.position] ?? 1) + 1)
      .map((p) => ({ p, savings: previewRelease(league, p.id).savingsThisYear }))
      .filter((x) => x.savings > 0)
      .sort(
        (a, b) =>
          keepValue(a.p, league.date) / (a.savings / 1_000_000 + 1) -
            keepValue(b.p, league.date) / (b.savings / 1_000_000 + 1) || a.p.id - b.p.id,
      );
    if (releasable.length === 0) break;
    const { p, savings } = releasable[0]!;
    releasePlayer(
      league,
      p.id,
      `${teamId} was over the ${season} cap ($${(salaryCap(league.rules.cap, season) / 1_000_000).toFixed(1)}M) after restructuring; releasing him saves $${(savings / 1_000_000).toFixed(2)}M for the least football value.`,
    );
  }
  return moves;
}
