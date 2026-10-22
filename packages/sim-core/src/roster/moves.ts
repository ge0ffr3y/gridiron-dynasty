/**
 * Roster moves (Phase 8), each recording a transaction with its reason
 * (CLAUDE.md, rule 8): signing to the active roster or practice squad, waivers
 * and claims, reserve lists and returns, promotions and game-day elevations.
 *
 * Rules are in `rules.roster` (2020 CBA and the league's roster rules):
 * - Released players with fewer than four accrued seasons go on waivers; after
 *   the trade deadline everyone does. Claim order is last season's draft order
 *   through Week 3, then current standings (worst first). A claiming team takes
 *   the contract without the bonus money, like a trade.
 * - Practice-squad deals pay a weekly CBA amount that counts on the cap.
 * - Injured reserve: at least four games out; returns are designated, eight a
 *   season (two more in the playoffs).
 */
import { ageOn, formatDollars, overallAt, type Dollars } from "@fgm/foundation";
import { minimumSalary, practiceSquadWeeklyRate } from "../contracts/cap";
import { capHit } from "../contracts/contract";
import {
  contractAfterTrade,
  earnedSoFar,
  previewRelease,
  recordTransaction,
  releasePlayer,
  tradePlayer,
} from "../contracts/operations";
import { capSheet } from "../contracts/team";
import type { Contract, League, Player, RosterList } from "../league/schema";
import { computeDraftOrder } from "../season/draftOrder";
import { seasonDates } from "../season/calendar";
import { computeStandings } from "../season/seeding";
import { ROSTER_AI } from "./config";
import { inSeasonRosters, onTeam, openSpots, practiceSquadOpening } from "./lists";

const name = (p: Player) => `${p.firstName} ${p.lastName}`;

/** How much a team values a player (true ratings: the AI's scouting arrives in Phase 11). */
export function playerValue(league: League, p: Player): number {
  const age = ageOn(p.birthDate, league.date);
  const grade =
    p.preseason?.season === league.season && p.preseason.grade !== null
      ? ((p.preseason.grade - 50) / 50) * ROSTER_AI.preseasonGradeWeight
      : 0;
  return overallAt(p.ratings, p.position) - Math.max(0, age - ROSTER_AI.agePenaltyFrom) + grade;
}

/** Regular-season weeks still to be paid from today (all of them before Week 1). */
function weeksLeft(league: League): { left: number; total: number } {
  const sundays = seasonDates(league.rules, league.season).weekSundays;
  return { left: sundays.filter((d) => d > league.date).length, total: sundays.length };
}

/** A one-year minimum deal from today: in the season, only the weeks still to be paid. */
export function minimumDeal(league: League, p: Player, teamId: string): Contract {
  const cap = league.rules.cap;
  const { left, total } = weeksLeft(league);
  const full = minimumSalary(cap, league.season, p.experience);
  const vsb = p.experience >= cap.veteranSalaryBenefit.minCreditedSeasons;
  return {
    teamId,
    type: "minimum",
    signedOn: league.date,
    years: [
      {
        season: league.season,
        base: left > 0 ? Math.round((full * left) / total) : full,
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
}

/** Weekly practice-squad pay (CBA Art. 33 Sec. 3): the fixed rate, or the veteran minimum. */
export function practiceSquadWeekly(league: League, p: Player): Dollars {
  return practiceSquadWeeklyRate(
    league.rules,
    league.season,
    p.experience > league.rules.roster.practiceSquad.restrictedMaxAccruedSeasons,
  );
}

/** A practice-squad deal for the rest of the regular season. */
export function practiceSquadDeal(league: League, p: Player, teamId: string): Contract {
  const { left, total } = weeksLeft(league);
  return {
    ...minimumDeal(league, p, teamId),
    type: "practice-squad",
    years: [
      {
        ...minimumDeal(league, p, teamId).years[0]!,
        base: practiceSquadWeekly(league, p) * (left > 0 ? left : total),
      },
    ],
    veteranSalaryBenefit: false,
  };
}

function capFits(league: League, teamId: string, contract: Contract): boolean {
  return (
    capSheet(league, teamId, league.season).room >=
    capHit(contract, league.season, league.rules.cap)
  );
}

/** Signs a free agent to a team's active roster (a minimum deal) or practice squad. */
export function signFreeAgent(
  league: League,
  playerId: number,
  teamId: string,
  list: "active" | "practice-squad",
  reason: string,
): void {
  const p = league.players.find((x) => x.id === playerId)!;
  if (p.teamId !== null || p.retiredAfter !== null)
    throw new Error(`${name(p)} isn't a free agent`);
  if (list === "active" && openSpots(league, teamId) <= 0)
    throw new Error(`${teamId} has no roster spot`);
  if (
    list === "practice-squad" &&
    !(inSeasonRosters(league) && practiceSquadOpening(league, teamId, p))
  )
    throw new Error(`${teamId} has no practice-squad spot for him`);
  const contract =
    list === "active" ? minimumDeal(league, p, teamId) : practiceSquadDeal(league, p, teamId);
  if (!capFits(league, teamId, contract)) throw new Error(`${teamId} can't fit him under the cap`);
  p.teamId = teamId;
  p.contract = contract;
  p.roster = list;
  p.reserve = null;
  recordTransaction(league, {
    type: list === "active" ? "signed" : "practice-squad",
    teamIds: [teamId],
    playerIds: [p.id],
    text:
      list === "active"
        ? `${teamId} signed ${name(p)} (${p.position}) to a one-year minimum deal.`
        : `${teamId} signed ${name(p)} (${p.position}) to its practice squad at ${formatDollars(practiceSquadWeekly(league, p))} a week.`,
    reason,
  });
}

// ---------------------------------------------------------------------------
// Waivers

/** Players with fewer than four accrued seasons go on waivers; after the trade deadline, everyone. */
export function subjectToWaivers(league: League, p: Player): boolean {
  if (p.experience < league.rules.roster.waivers.vestedVeteranSeasons) return true;
  return (
    inSeasonRosters(league) && league.date > seasonDates(league.rules, league.season).tradeDeadline
  );
}

/**
 * Claim priority, worst team first: last season's draft order until Week 3 is played, then
 * this season's standings (ties broken as for the draft order: strength of schedule, ...).
 */
export function claimOrder(league: League): string[] {
  const through = league.rules.roster.waivers.draftOrderThroughWeek;
  const regularPlayed = league.games.filter((g) => g.round === "regular" && g.result !== null);
  const weeksPlayed = Math.max(0, ...regularPlayed.map((g) => g.week));
  const lastOrder = league.history.at(-1)?.draftOrder;
  if (weeksPlayed <= through && lastOrder) return [...lastOrder];
  const standings = computeStandings(
    league.rules,
    league.teams,
    regularPlayed,
    `${league.meta.seed}:${league.season}:waivers`,
  );
  return computeDraftOrder(standings, new Map(league.teams.map((t) => [t.id, "missed" as const])))
    .firstRound;
}

/** The team's least valuable active player at a position. */
function weakestAt(league: League, teamId: string, position: Player["position"]): Player | null {
  return weakestIn(league, onTeam(league, teamId, "active"), position);
}

function weakestIn(league: League, roster: Player[], position: Player["position"]): Player | null {
  let worst: Player | null = null;
  let worstValue = Infinity;
  // Before camp, a team doesn't cut a player it just drafted to make room for a waiver claim.
  const spring = ["free-agency", "draft", "after-draft"].includes(league.calendar.stage);
  for (const x of roster) {
    if (x.position !== position || x.roster !== "active") continue;
    if (spring && x.drafted?.season === league.season) continue;
    const v = playerValue(league, x);
    if (v < worstValue || (v === worstValue && worst !== null && x.id > worst.id)) {
      worst = x;
      worstValue = v;
    }
  }
  return worst;
}

/**
 * An AI team claims a player who clearly beats its weakest at his position and fits the cap.
 * `roster` is the team's players (passed in so a waiver run indexes rosters once).
 */
function wantsClaim(
  league: League,
  teamId: string,
  p: Player,
  roster: Player[],
  value: number,
): boolean {
  const team = league.teams.find((t) => t.id === teamId)!;
  if (team.controller !== "ai") return false;
  const weakest = weakestIn(league, roster, p.position);
  if (weakest && value < playerValue(league, weakest) + ROSTER_AI.claimMargin) return false;
  if (!weakest && openSpots(league, teamId) <= 0) return false;
  const contract = contractAfterTrade(league, p.contract!, teamId);
  // Waiving the weakest frees only what a release saves (paid salary and guarantees stay).
  const freed =
    openSpots(league, teamId) > 0 || !weakest
      ? 0
      : previewRelease(league, weakest.id).savingsThisYear;
  return (
    capSheet(league, teamId, league.season).room + freed >=
    capHit(contract, league.season, league.rules.cap)
  );
}

/**
 * Releases a player; if he's subject to waivers, teams in claim order may claim him (the first
 * that wants him gets him). A claiming team without a spot waives its weakest at his position.
 * Returns the claiming team, or null if he became a free agent.
 */
export function waivePlayer(
  league: League,
  playerId: number,
  reason: string,
  depth = 0,
): string | null {
  const p = league.players.find((x) => x.id === playerId)!;
  const from = p.teamId!;
  if (subjectToWaivers(league, p) && depth < 4) {
    const rosters = new Map<string, Player[]>();
    for (const x of league.players) {
      if (!x.teamId) continue;
      const list = rosters.get(x.teamId);
      if (list) list.push(x);
      else rosters.set(x.teamId, [x]);
    }
    const value = playerValue(league, p);
    for (const teamId of claimOrder(league)) {
      if (teamId === from || !wantsClaim(league, teamId, p, rosters.get(teamId) ?? [], value))
        continue;
      if (openSpots(league, teamId) <= 0) {
        const weakest = weakestAt(league, teamId, p.position)!;
        waivePlayer(
          league,
          weakest.id,
          `Waived to make room for ${name(p)}, claimed off waivers.`,
          depth + 1,
        );
      }
      p.roster = "active";
      p.reserve = null;
      tradePlayer(
        league,
        playerId,
        teamId,
        `${reason} ${teamId} claimed him: better than its weakest ${p.position}.`,
        {
          claim: true,
        },
      );
      return teamId;
    }
  }
  releasePlayer(
    league,
    playerId,
    subjectToWaivers(league, p)
      ? `${reason} Cleared waivers.`
      : `${reason} A vested veteran: no waivers.`,
  );
  p.roster = "active";
  p.reserve = null;
  return null;
}

// ---------------------------------------------------------------------------
// Reserve lists and the practice squad

export function placeOnReserve(
  league: League,
  playerId: number,
  list: Exclude<RosterList, "active" | "practice-squad">,
  reason: string,
): void {
  const p = league.players.find((x) => x.id === playerId)!;
  p.roster = list;
  p.reserve = { since: league.date, gamesMissed: 0, designatedToReturn: false };
  const label = { "injured-reserve": "injured reserve", pup: "the PUP list", nfi: "the NFI list" }[
    list
  ];
  recordTransaction(league, {
    type: "reserve",
    teamIds: [p.teamId!],
    playerIds: [p.id],
    text: `${p.teamId} placed ${name(p)} on ${label}.`,
    reason,
  });
}

/** Designated returns used this season (injured reserve only). */
export function reserveReturnsLeft(league: League, teamId: string): number {
  const team = league.teams.find((t) => t.id === teamId)!;
  const used = team.reserveReturns.filter((r) => r.season === league.season).length;
  const r = league.rules.roster.reserve;
  const playoffs =
    league.calendar.stage !== "regular" && inSeasonRosters(league) ? r.returnsPlayoffExtra : 0;
  return r.returnsPerSeason + playoffs - used;
}

/** Back to the active roster from a reserve list (an injured-reserve return uses a designation). */
export function activate(league: League, playerId: number, reason: string): void {
  const p = league.players.find((x) => x.id === playerId)!;
  const teamId = p.teamId!;
  if (p.roster === "injured-reserve" && inSeasonRosters(league)) {
    if (reserveReturnsLeft(league, teamId) <= 0)
      throw new Error(`${teamId} has no injured-reserve returns left`);
    league.teams
      .find((t) => t.id === teamId)!
      .reserveReturns.push({ season: league.season, playerId });
  }
  p.roster = "active";
  p.reserve = null;
  if (openSpots(league, teamId) < 0) throw new Error(`${teamId} has no roster spot for ${name(p)}`);
  recordTransaction(league, {
    type: "activated",
    teamIds: [teamId],
    playerIds: [p.id],
    text: `${teamId} activated ${name(p)}.`,
    reason,
  });
}

/** Signs his own practice-squad player to the active roster for the rest of the season. */
export function promote(league: League, playerId: number, reason: string): void {
  const p = league.players.find((x) => x.id === playerId)!;
  const teamId = p.teamId!;
  if (p.roster !== "practice-squad") throw new Error(`${name(p)} isn't on the practice squad`);
  if (openSpots(league, teamId) <= 0) throw new Error(`${teamId} has no roster spot`);
  // The practice-squad pay already earned stays on the cap; the rest is replaced by a minimum deal.
  const cap = league.rules.cap;
  const change =
    capHit(minimumDeal(league, p, teamId), league.season, cap) +
    earnedSoFar(league, p.contract!).total -
    capHit(p.contract!, league.season, cap);
  if (capSheet(league, teamId, league.season).room < change)
    throw new Error(`${teamId} can't fit ${name(p)}'s promotion under the cap`);
  releasePlayer(
    league,
    playerId,
    "Promoted from the practice squad (practice-squad deal ended).",
    {},
  );
  p.teamId = teamId;
  p.contract = minimumDeal(league, p, teamId);
  p.roster = "active";
  recordTransaction(league, {
    type: "signed",
    teamIds: [teamId],
    playerIds: [p.id],
    text: `${teamId} promoted ${name(p)} (${p.position}) from its practice squad to the active roster.`,
    reason,
  });
}

/** Game-day elevations left for a practice-squad player this season. */
export function elevationsLeft(league: League, p: Player): number {
  return league.rules.roster.practiceSquad.elevationsPerPlayerPerSeason - p.elevations;
}

/**
 * The practice-squad players a team protects this week (its best, up to the weekly limit):
 * other teams can't sign them away.
 */
export function protectedPracticeSquad(league: League, teamId: string): Set<number> {
  const squad = onTeam(league, teamId, "practice-squad")
    .map((p) => ({ p, v: playerValue(league, p) }))
    .sort((a, b) => b.v - a.v || a.p.id - b.p.id);
  return new Set(
    squad.slice(0, league.rules.roster.practiceSquad.protectedPerWeek).map((x) => x.p.id),
  );
}

/**
 * Signs another team's (unprotected) practice-squad player to this team's active roster, as the
 * rules allow any club to: his old team keeps the practice-squad pay already earned.
 */
export function signFromPracticeSquad(
  league: League,
  playerId: number,
  teamId: string,
  reason: string,
): void {
  const p = league.players.find((x) => x.id === playerId)!;
  const from = p.teamId!;
  if (p.roster !== "practice-squad" || from === teamId)
    throw new Error(`${name(p)} isn't on another team's practice squad`);
  if (protectedPracticeSquad(league, from).has(p.id))
    throw new Error(`${from} has protected ${name(p)} this week`);
  if (openSpots(league, teamId) <= 0) throw new Error(`${teamId} has no roster spot`);
  const contract = minimumDeal(league, p, teamId);
  if (!capFits(league, teamId, contract)) throw new Error(`${teamId} can't fit him under the cap`);
  releasePlayer(league, playerId, `Signed away from the practice squad by ${teamId}.`);
  p.teamId = teamId;
  p.contract = contract;
  p.roster = "active";
  recordTransaction(league, {
    type: "signed",
    teamIds: [teamId, from],
    playerIds: [p.id],
    text: `${teamId} signed ${name(p)} (${p.position}) off ${from}'s practice squad to its active roster.`,
    reason,
  });
}
