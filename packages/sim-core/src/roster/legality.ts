/**
 * The league stays legal (CLAUDE.md, rule 9; Phase 8). Every rule a roster
 * must meet at any moment, as plain-English problems (none = legal):
 * - roster size under today's limit (90 until final cuts, then 53 active);
 * - practice squad size and its veteran limit (only during the season);
 * - everyone on a team under contract with that team; contracts that ran out
 *   with last season stay valid only until the new League Year opens;
 * - every team under the salary cap (the offseason top-51 rule, then every
 *   contract plus practice-squad pay in the season), from the new League Year
 *   on (between the championship and March, teams have until then);
 * - nobody retired on a team.
 *
 * `setTransactionAudit(checkLegal)` (contracts/operations.ts) runs this after
 * every recorded transaction; the tests do that for whole seasons.
 */
import { formatDollars } from "@fgm/foundation";
import { span } from "../contracts/contract";
import { teamsOverCap } from "../contracts/team";
import type { League } from "../league/schema";
import { inSeasonRosters, isPracticeSquadVeteran, onTeam, rosterCount, rosterLimit } from "./lists";

export function rosterProblems(league: League): string[] {
  const problems: string[] = [];
  const ps = league.rules.roster.practiceSquad;
  const limit = rosterLimit(league);
  for (const team of league.teams) {
    const count = rosterCount(league, team.id);
    if (count > limit) problems.push(`${team.id} has ${count} players (limit ${limit})`);
    const squad = onTeam(league, team.id, "practice-squad");
    // Practice squads exist from final cuts until the season's end (settled the day after).
    if (squad.length > 0 && !inSeasonRosters(league) && league.calendar.stage !== "complete")
      problems.push(`${team.id} has a practice squad outside the season`);
    if (squad.length > ps.max)
      problems.push(`${team.id}'s practice squad has ${squad.length} (limit ${ps.max})`);
    const veterans = squad.filter((p) => isPracticeSquadVeteran(league, p)).length;
    if (veterans > ps.veteransMax)
      problems.push(
        `${team.id}'s practice squad has ${veterans} veterans (limit ${ps.veteransMax})`,
      );
  }
  for (const p of league.players) {
    if (p.teamId === null) continue;
    const who = `${p.firstName} ${p.lastName} (${p.id}, ${p.teamId})`;
    if (p.retiredAfter !== null) problems.push(`${who} is retired but on a team`);
    if (!p.contract) {
      problems.push(`${who} has no contract`);
      continue;
    }
    if (p.contract.teamId !== p.teamId) problems.push(`${who}'s contract is with another team`);
    const ranOut = span(p.contract).lastReal < league.season;
    // Deals that ended with last season run until the new League Year opens in March.
    if (
      ranOut &&
      !(league.calendar.stage === "offseason" && span(p.contract).lastReal === league.season - 1)
    )
      problems.push(`${who}'s contract has run out`);
    if (p.roster === "practice-squad" && p.contract.type !== "practice-squad")
      problems.push(`${who} is on the practice squad without a practice-squad deal`);
  }
  // Teams must be under the new year's cap when its League Year opens in March (CBA Art. 13):
  // between the championship and then, they have time to get there.
  if (league.calendar.stage !== "offseason")
    for (const { teamId, room } of teamsOverCap(league))
      problems.push(`${teamId} is over the cap by ${formatDollars(-room)}`);
  return problems;
}

/** Throws with every problem found (used as the transaction audit in tests and the runner). */
export function checkLegal(league: League): void {
  const problems = rosterProblems(league);
  if (problems.length > 0)
    throw new Error(`The league broke a roster rule:\n${problems.slice(0, 8).join("\n")}`);
}
