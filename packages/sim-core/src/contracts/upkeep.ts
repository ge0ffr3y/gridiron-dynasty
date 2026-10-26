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
import { proBowls } from "../history/awards";
import { aggressiveRestructures } from "../front-office/strategy";
import { overallAt, Rng, streamSeed, type Dollars } from "@fgm/foundation";
import { POSITIONS } from "@fgm/foundation";
import type { Contract, League, Player } from "../league/schema";
import { ROSTER_MIX, STARTERS } from "../generate/config";
import { minimumSalary, practiceSquadWeeklyRate, salaryCap } from "./cap";
import {
  capHit,
  cashIn,
  remainingProration,
  span,
  totalValue,
  yearOf,
  yearsLeft,
} from "./contract";
import { MARKET, marketRanks } from "./generate";
import { freeAgencyRound, startFreeAgency } from "./freeAgency";
import {
  decideFifthYearOption,
  previewRelease,
  previewRestructure,
  recordTransaction,
  releasePlayer,
  restructureContract,
} from "./operations";
import { capSheet, cashSpendingShortfall, offseasonRuleApplies, playersOn } from "./team";
import { fifthYearOptionSalary, recordSalaryHistory } from "./tags";

/** Seasons of dead money and carryover kept on file (older entries can't affect the cap any more). */
const KEEP_SEASONS = 3;
/** Snaps a full-time player plays in a season (for fifth-year option playing-time tiers). */
const FULL_SEASON_SNAPS = 17 * 64;
/** A first-round pick whose rank at his category is inside this share of starter slots gets his option exercised. */
const OPTION_STARTER_SHARE = 0.75;
/** Most of a cap AI teams carry into the next League Year (placeholder until Phase 13's AI GMs). */
const CARRYOVER_MAX_SHARE = 0.05;
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
  // Last League Year's talks are over.
  league.negotiations = league.negotiations.filter((n) => n.season >= season);
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

  releaseToMarket(league, expiring);
  // Cap-aggressive GMs buy room now and pay later (Phase 13).
  aggressiveRestructures(league);
  // Free agency opens: day one includes the deals agreed in the negotiating period (Phase 12).
  startFreeAgency(league);
  freeAgencyRound(league, 1);
}

/**
 * Players whose deals ran out and weren't kept (re-signed, tagged or tendered in the re-signing
 * window): teams first get under the new cap, then these players become free agents.
 */
function releaseToMarket(league: League, expiring: Player[]): void {
  for (const team of league.teams) getUnderCap(league, team.id);
  for (const p of expiring) {
    const teamId = p.teamId!;
    p.teamId = null;
    p.contract = null;
    p.roster = "active";
    recordTransaction(league, {
      type: "expired",
      teamIds: [teamId],
      playerIds: [p.id],
      text: `${p.firstName} ${p.lastName}'s contract with ${teamId} ran out; he's a free agent.`,
      reason: `${teamId} didn't keep him in the re-signing window (no deal, tag or tender).`,
    });
  }
}

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
    fifthYearOptionSalary(
      league,
      p.position,
      option.season,
      shares,
      proBowls(league, p.id, season - league.rules.cap.fifthYearOption.proBowlSeasons, season - 1),
    ),
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
    if (roster.length >= league.rules.roster.offseasonMax) break;
    // Every position needs its starters, even on a full roster; below the floor, fill the thinnest spots.
    const missingStarters = POSITIONS.filter(
      (pos) => roster.filter((p) => p.position === pos).length < (STARTERS[pos] ?? 1),
    );
    if (roster.length >= ROSTER_FLOOR && missingStarters.length === 0) break;
    const deficits = (roster.length >= ROSTER_FLOOR ? missingStarters : POSITIONS)
      .map((pos) => ({
        pos,
        need: ROSTER_MIX[pos] - roster.filter((p) => p.position === pos).length,
      }))
      .sort((a, b) => b.need - a.need || POSITIONS.indexOf(a.pos) - POSITIONS.indexOf(b.pos));
    let pick: Player | undefined;
    for (const { pos } of deficits) {
      pick = league.players
        .filter((p) => p.teamId === null && p.retiredAfter === null && p.position === pos)
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
    // Signed only if he fits (in the offseason a deal outside the top 51 costs no room).
    pick.teamId = teamId;
    pick.contract = contract;
    if (capSheet(league, teamId, season).room < 0) {
      pick.teamId = null;
      pick.contract = null;
      break;
    }
    signed += 1;
    recordTransaction(league, {
      type: "signed",
      teamIds: [teamId],
      playerIds: [pick.id],
      text: `${teamId} signed free agent ${pick.firstName} ${pick.lastName} (${pick.position}) to a one-year minimum deal${vsb ? " (veteran salary benefit)" : ""}.`,
      reason: `Roster down to ${roster.length}; ${pick.position} was the thinnest spot.`,
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
/** The contract on a team whose restructure frees the most room this season, if any. */
function bestRestructure(league: League, teamId: string): Player | null {
  const season = league.season;
  const best = playersOn(league, teamId)
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
    .sort((a, b) => b.savings - a.savings || a.p.id - b.p.id)[0];
  return best?.p ?? null;
}

/**
 * Restructures the team's biggest contracts, one at a time, until `enough()`, as long as next
 * season's commitments stay under next season's cap (a team doesn't borrow from a year it can't
 * pay for). Leaves things as they are if no restructure fits.
 */
export function restructureForRoom(
  league: League,
  teamId: string,
  enough: () => boolean,
  reason: string,
): void {
  const next = league.season + 1;
  const nextCap = salaryCap(league.rules.cap, next);
  for (let moves = 0; !enough() && moves < MAX_COMPLIANCE_MOVES; moves++) {
    const p = bestRestructure(league, teamId);
    if (!p) return;
    const effects = previewRestructure(league, p.id);
    const addedNext = (effects.capHitAfter[1] ?? 0) - (effects.capHitBefore[1] ?? 0);
    if (capSheet(league, teamId, next).total + addedNext > nextCap) return;
    restructureContract(league, p.id, reason);
  }
}

export function getUnderCap(
  league: League,
  teamId: string,
  roomFor?: { amount: Dollars; what: string; releases?: boolean },
): number {
  const season = league.season;
  let moves = 0;
  // Restructures may also make room for something the team needs (`roomFor`); releases happen
  // to get under the cap, or for room the team can't do without (`roomFor.releases`).
  const target = roomFor?.amount ?? 0;
  for (;;) {
    const room = capSheet(league, teamId, season).room;
    if (room >= target || moves >= MAX_COMPLIANCE_MOVES) break;
    moves += 1;
    const players = playersOn(league, teamId);
    const restructure = bestRestructure(league, teamId);
    if (restructure) {
      restructureContract(
        league,
        restructure.id,
        room < 0
          ? `${teamId} was over the ${season} cap; turning salary into bonus frees room now.`
          : `${teamId} needed room for ${roomFor!.what}; turning salary into bonus frees it now.`,
      );
      continue;
    }
    if (room >= 0 && !roomFor?.releases) break;
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
      room < 0
        ? `${teamId} was over the ${season} cap ($${(salaryCap(league.rules.cap, season) / 1_000_000).toFixed(1)}M) after restructuring; releasing him saves $${(savings / 1_000_000).toFixed(2)}M for the least football value.`
        : `${teamId} needed room for ${roomFor!.what}; releasing him saves $${(savings / 1_000_000).toFixed(2)}M for the least football value.`,
    );
  }
  return moves;
}
