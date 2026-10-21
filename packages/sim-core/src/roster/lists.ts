/**
 * Who is where on a team, and which limits apply today (Phase 8, rules in
 * `rules.roster`):
 * - Until final cuts, every player under contract counts toward the 90-man
 *   offseason limit, whatever list he's on.
 * - From cutdown day through the playoffs, only the active roster counts
 *   toward 53; the practice squad has its own limit and reserve lists none.
 */
import { isPlaying } from "../season/calendar";
import type { League, Player, RosterList } from "../league/schema";

export function onTeam(league: League, teamId: string, list?: RosterList): Player[] {
  return league.players.filter(
    (p) => p.teamId === teamId && (list === undefined || p.roster === list),
  );
}

/** The 53-man limit applies from final cuts through the playoffs. */
export function inSeasonRosters(league: League): boolean {
  return isPlaying(league.calendar.stage);
}

/** The roster limit today, and the players who count toward it. */
export function rosterLimit(league: League): number {
  return inSeasonRosters(league)
    ? league.rules.roster.regularSeasonMax
    : league.rules.roster.offseasonMax;
}

export function countsTowardLimit(league: League, p: Player): boolean {
  if (p.roster === "practice-squad") return false;
  return inSeasonRosters(league) ? p.roster === "active" : true;
}

export function rosterCount(league: League, teamId: string): number {
  return onTeam(league, teamId).filter((p) => countsTowardLimit(league, p)).length;
}

/** Room under today's roster limit (negative when over). */
export function openSpots(league: League, teamId: string): number {
  return rosterLimit(league) - rosterCount(league, teamId);
}

/** A practice-squad "veteran": more accrued seasons than the restricted players may have. */
export function isPracticeSquadVeteran(league: League, p: Player): boolean {
  return p.experience > league.rules.roster.practiceSquad.restrictedMaxAccruedSeasons;
}

/** Whether a player may join this team's practice squad now (size and the veteran limit). */
export function practiceSquadOpening(league: League, teamId: string, p: Player): boolean {
  const ps = league.rules.roster.practiceSquad;
  const squad = onTeam(league, teamId, "practice-squad");
  if (squad.length >= ps.max) return false;
  if (!isPracticeSquadVeteran(league, p)) return true;
  return squad.filter((x) => isPracticeSquadVeteran(league, x)).length < ps.veteransMax;
}
