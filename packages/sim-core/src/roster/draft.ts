/**
 * The draft (Phase 8, scouted boards from Phase 11; draft day's clock and
 * trades come in 11b). The class (scouting/classes.ts) is picked in the draft
 * order set when last season ended: each team takes the best prospect left as
 * its own scouts see him, counting his room to grow and nudged toward thin
 * positions. Every pick signs a rookie deal on the real wage scale; then teams
 * fill out to 90 with undrafted free agents, and everyone left is a free agent.
 */
import type { Position } from "@fgm/foundation";
import { rookieContract } from "../contracts/generate";
import { minimumSalary } from "../contracts/cap";
import { recordTransaction } from "../contracts/operations";
import { ROSTER_MIX } from "../generate/config";
import type { Contract, League, Player, Prospect } from "../league/schema";
import { perceiveProspect } from "../perception";
import { draftClass, prospectToPlayer } from "../scouting/classes";
import { runProDays } from "../scouting/study";
import { draftValue } from "../scouting/value";
import { getUnderCap } from "../contracts/upkeep";
import { DRAFT_CLASS } from "./config";
import { onTeam, openSpots } from "./lists";
import { playerValue, waivePlayer } from "./moves";

const ordinal = (n: number) =>
  `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th")}`;

/** A prospect's worth to a team (before need), as its scouts see him. */
function scoutedValue(league: League, teamId: string, p: Prospect): number {
  return draftValue(perceiveProspect(league, p, { kind: "team", teamId }), p.position);
}

/** The team's favorite prospect left: its scouts' value, nudged toward positions it's thin at. */
function bestFor(
  league: League,
  teamId: string,
  available: Map<number, Prospect>,
  boards: Map<string, Map<number, number>>,
): Prospect | null {
  const counts = new Map<Position, number>();
  for (const x of onTeam(league, teamId)) counts.set(x.position, (counts.get(x.position) ?? 0) + 1);
  let board = boards.get(teamId);
  if (!board) {
    board = new Map([...available.values()].map((p) => [p.id, scoutedValue(league, teamId, p)]));
    boards.set(teamId, board);
  }
  let best: Prospect | null = null;
  let bestValue = -Infinity;
  for (const p of available.values()) {
    const v =
      (board.get(p.id) ?? scoutedValue(league, teamId, p)) +
      ((counts.get(p.position) ?? 0) < ROSTER_MIX[p.position] ? DRAFT_CLASS.needBonus : 0);
    if (v > bestValue || (v === bestValue && best !== null && p.id < best.id)) {
      best = p;
      bestValue = v;
    }
  }
  return best;
}

function freeJersey(league: League, teamId: string, p: Player): number {
  const taken = new Set(onTeam(league, teamId).map((x) => x.jersey));
  if (!taken.has(p.jersey)) return p.jersey;
  for (let n = 1; n < 100; n++) if (!taken.has(n)) return n;
  return 0;
}

function undraftedDeal(league: League, teamId: string): Contract {
  const cap = league.rules.cap;
  const years = Array.from({ length: DRAFT_CLASS.undraftedYears }, (_, i) => ({
    season: league.season + i,
    base: minimumSalary(cap, league.season + i, i),
    guaranteed: 0,
    injuryGuaranteed: 0,
    vestsOn: null,
    rosterBonus: 0,
    workoutBonus: 0,
    perGameBonus: 0,
    incentives: [],
    void: false,
  }));
  return {
    teamId,
    type: "rookie",
    signedOn: league.date,
    years,
    bonuses: [],
    fifthYearOption: null,
    veteranSalaryBenefit: false,
  };
}

/**
 * Draft day: every pick this season, in order, then the undrafted rush. Returns the number of
 * players drafted and signed undrafted. A team at 90 waives its least valuable player to make
 * room for a pick, and signs undrafted players only into open spots.
 */
export function runDraft(league: League): { drafted: number; undrafted: number } {
  const picks = league.draftPicks
    .filter((p) => p.season === league.season && p.overall !== null)
    .sort((a, b) => a.overall! - b.overall!);
  // Anyone not yet measured has his pro day before the draft.
  runProDays(league, league.date);
  const prospects = draftClass(league, league.season);
  const available = new Map(prospects.map((p) => [p.id, p]));
  // Each team's board, built the first time it picks (its scouts' read of everyone left).
  const boards = new Map<string, Map<number, number>>();
  const teamCount = league.teams.length;
  // The whole class joins the league as players without a team (in id order), then is picked.
  const asPlayers = new Map(prospects.map((p) => [p.id, prospectToPlayer(p)]));
  league.players.push(...[...asPlayers.values()].sort((a, b) => a.id - b.id));
  const join = (prospect: Prospect): Player => asPlayers.get(prospect.id)!;

  for (const pick of picks) {
    const teamId = pick.ownerTeamId;
    const pickedProspect = bestFor(league, teamId, available, boards);
    if (!pickedProspect) break;
    available.delete(pickedProspect.id);
    if (openSpots(league, teamId) <= 0) {
      // Never this year's own picks: a team doesn't draft a player to cut him for the next one.
      const weakest = onTeam(league, teamId)
        .filter((x) => x.roster === "active" && x.drafted?.season !== league.season)
        .sort((a, b) => playerValue(league, a) - playerValue(league, b) || b.id - a.id)[0]!;
      waivePlayer(
        league,
        weakest.id,
        `Waived to make room for a draft pick (${weakest.position}, the least valuable player on the roster).`,
      );
    }
    const round = Math.ceil(pick.overall! / teamCount);
    const choice = join(pickedProspect);
    choice.drafted = { season: league.season, round, pick: pick.overall!, teamId };
    choice.teamId = teamId;
    choice.jersey = freeJersey(league, teamId, choice);
    choice.contract = rookieContract(league, choice, teamId, league.season, pick.overall!);
    recordTransaction(league, {
      type: "drafted",
      teamIds: [teamId],
      playerIds: [choice.id],
      text: `${teamId} drafted ${choice.firstName} ${choice.lastName} (${choice.position}), ${ordinal(round)} round, ${ordinal(pick.overall!)} overall, and signed him to a rookie-scale deal.`,
      reason:
        "Top of this team's board: its scouts' read of the best prospect left, counting room to grow and thin positions.",
    });
  }

  // The undrafted rush: teams fill open spots with the best prospects left, one at a time in draft order.
  let undrafted = 0;
  const order = picks.filter((p) => p.round === 1).map((p) => p.ownerTeamId);
  for (let round = 0; round < 60 && available.size > 0; round++) {
    let signed = false;
    for (const teamId of order) {
      if (openSpots(league, teamId) <= 0) continue;
      const signedProspect = bestFor(league, teamId, available, boards);
      if (!signedProspect) break;
      available.delete(signedProspect.id);
      const choice = join(signedProspect);
      choice.teamId = teamId;
      choice.jersey = freeJersey(league, teamId, choice);
      choice.contract = undraftedDeal(league, teamId);
      undrafted += 1;
      signed = true;
      recordTransaction(league, {
        type: "signed",
        teamIds: [teamId],
        playerIds: [choice.id],
        text: `${teamId} signed undrafted free agent ${choice.firstName} ${choice.lastName} (${choice.position}).`,
        reason:
          "Undrafted free-agent rush after the draft: an open camp spot, the best prospect left on this team's board.",
      });
    }
    if (!signed) break;
  }
  // Everyone left is a free agent now; the class is done, and scouts turn to next year's.
  league.prospects = league.prospects.filter((p) => p.draftYear !== league.season);
  // First-round deals can push a tight team over the cap: it restructures or releases, with reasons.
  for (const team of league.teams) getUnderCap(league, team.id);
  return { drafted: picks.length, undrafted };
}
