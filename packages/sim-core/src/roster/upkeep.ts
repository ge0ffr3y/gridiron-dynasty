/**
 * The AI's roster upkeep through the League Year (Phase 8; Phase 13's AI GMs
 * replace the judgment calls, which are tuned in roster/config.ts):
 * - training camp: injured players start on the PUP list;
 * - cutdown day: reserve lists, cuts to 53, the waiver rush in claim order,
 *   practice squads formed, and the in-season cap;
 * - each week: injured reserve, returns, keeping 53 and a full practice squad;
 * - season's end: practice-squad futures deals, reserve lists cleared, and
 *   retirement (the model is in lifecycle/retirement.ts).
 * Every move records why.
 */
import { Rng, streamSeed, type Position } from "@fgm/foundation";
import { capHit, remainingGuarantees, remainingProration } from "../contracts/contract";
import { batch, recordTransaction } from "../contracts/operations";
import { capSheet } from "../contracts/team";
import { minimumSalary } from "../contracts/cap";
import { getUnderCap } from "../contracts/upkeep";
import { ROSTER_MIX, STARTERS } from "../generate/config";
import type { League, Player } from "../league/schema";
import { decideRetirement } from "../lifecycle/retirement";
import { seasonDates } from "../season/calendar";
import { ROSTER_AI } from "./config";
import { inSeasonRosters, isPracticeSquadVeteran, onTeam, openSpots } from "./lists";
import {
  activate,
  claimOrder,
  elevationsLeft,
  minimumDeal,
  placeOnReserve,
  playerValue,
  practiceSquadDeal,
  practiceSquadWeekly,
  promote,
  protectedPracticeSquad,
  reserveReturnsLeft,
  signFromPracticeSquad,
  signFreeAgent,
  waivePlayer,
} from "./moves";

const name = (p: Player) => `${p.firstName} ${p.lastName}`;
const aiTeams = (league: League) => league.teams.filter((t) => t.controller === "ai");

/** The fewest players a team keeps at a position on the 53 (a typical real roster). */
function keepAtLeast(position: Position): number {
  return ROSTER_AI.fiftyThreeMinimums[position];
}

/** The highest-scoring player (lowest id on ties), scoring each once. */
function best(players: Player[], score: (p: Player) => number): Player | undefined {
  let top: Player | undefined;
  let topScore = -Infinity;
  for (const p of players) {
    const s = score(p);
    if (s > topScore || (s === topScore && top !== undefined && p.id < top.id)) {
      top = p;
      topScore = s;
    }
  }
  return top;
}

/** Sorts by a score computed once per player (highest first, lowest id on ties). */
function byScore(players: Player[], score: (p: Player) => number): Player[] {
  const scored = players.map((p) => ({ p, s: score(p) }));
  scored.sort((a, b) => b.s - a.s || a.p.id - b.p.id);
  return scored.map((x) => x.p);
}

/** What cutting him costs in dead money (teams are slow to cut what they've already paid). */
function cutValue(league: League, p: Player): number {
  const dead = p.contract
    ? remainingProration(p.contract, league.season) +
      remainingGuarantees(p.contract, league.season, league.date)
    : 0;
  return playerValue(league, p) + (ROSTER_AI.deadMoneyPerMillion * dead) / 1_000_000;
}

function freeAgents(league: League): Player[] {
  return league.players.filter((p) => p.teamId === null && p.retiredAfter === null);
}

// ---------------------------------------------------------------------------
// Training camp

/** Camp opens: players still hurt go on the PUP list (they count toward 90 and can come back any time). */
export function trainingCampOpens(league: League): void {
  for (const p of league.players) if (p.teamId !== null) p.preseason = null;
  for (const p of [...league.players].sort((a, b) => a.id - b.id)) {
    if (p.teamId === null || p.roster !== "active" || !p.injury) continue;
    p.roster = "pup";
    recordTransaction(league, {
      type: "reserve",
      teamIds: [p.teamId],
      playerIds: [p.id],
      text: `${p.teamId} put ${name(p)} on the active/PUP list for training camp.`,
      reason: `Still hurt when camp opened (${p.injury.description.toLowerCase()}).`,
    });
  }
}

// ---------------------------------------------------------------------------
// Cutdown day

/** Which of a team's active players it keeps on the 53: position needs first, then value. */
function chooseFiftyThree(league: League, teamId: string): { keep: Player[]; cut: Player[] } {
  const limit = league.rules.roster.regularSeasonMax;
  const active = byScore(onTeam(league, teamId, "active"), (p) => cutValue(league, p));
  const keep = new Set<number>();
  for (const pos of Object.keys(ROSTER_MIX) as Position[]) {
    for (const p of active.filter((x) => x.position === pos).slice(0, keepAtLeast(pos)))
      if (keep.size < limit) keep.add(p.id);
  }
  for (const p of active) if (keep.size < limit) keep.add(p.id);
  return {
    keep: active.filter((p) => keep.has(p.id)),
    cut: active.filter((p) => !keep.has(p.id)),
  };
}

/**
 * Final cuts: camp lists resolved (Reserve/PUP or active), injured players to injured reserve
 * (two designated to return), every team to 53 at once, then the waiver rush in claim order,
 * practice squads, and the in-season cap.
 */
export function cutdownDay(league: League): void {
  const dates = seasonDates(league.rules, league.season);
  const r = league.rules.roster.reserve;
  batch(league, () => {
    league.date = dates.cutdown;
    const pending: { p: Player; from: string }[] = [];
    for (const team of aiTeams(league)) {
      for (const p of onTeam(league, team.id, "pup").sort((a, b) => a.id - b.id)) {
        if (p.injury && p.injury.gamesRemaining >= r.pupMinGames)
          placeOnReserve(
            league,
            p.id,
            "pup",
            `Still hurt at final cuts: Reserve/PUP, out at least ${r.pupMinGames} games and off the 53.`,
          );
        else activate(league, p.id, "Healthy by final cuts: off the PUP list.");
      }
      const hurt = byScore(
        onTeam(league, team.id, "active").filter(
          (p) => p.injury && p.injury.gamesRemaining >= r.injuredMinGames,
        ),
        (p) => playerValue(league, p),
      );
      hurt.forEach((p, i) => {
        placeOnReserve(
          league,
          p.id,
          "injured-reserve",
          `Out ${p.injury!.gamesRemaining} games at final cuts: injured reserve keeps his spot on the 53 open.`,
        );
        // Up to two may be designated to return now (they count against the season's eight).
        if (
          i < r.returnsAtCutdown &&
          p.injury!.gamesRemaining < league.rules.schedule.regularSeasonWeeks
        ) {
          p.reserve!.designatedToReturn = true;
          team.reserveReturns.push({ season: league.season, playerId: p.id });
        }
      });
      for (const p of chooseFiftyThree(league, team.id).cut) {
        // Off the roster now; the wire is worked once every team has cut.
        pending.push({ p, from: team.id });
        p.teamId = null;
      }
    }
    league.calendar = { stage: "regular", week: 1 };
    // The waiver rush: best players first, each to the first team in claim order that wants him.
    const values = new Map(pending.map(({ p }) => [p.id, playerValue(league, p)]));
    pending.sort((a, b) => values.get(b.p.id)! - values.get(a.p.id)! || a.p.id - b.p.id);
    for (const { p, from } of pending) {
      p.teamId = from;
      waivePlayer(league, p.id, `Cut at final cuts (${p.position}): not among ${from}'s best 53.`);
    }
    league.date = dates.practiceSquads;
    // Room for a full practice squad (the CBA's weekly pay for 18 weeks), restructuring if needed.
    const squadCost =
      league.rules.roster.practiceSquad.max *
      practiceSquadWeekly(league, { experience: 0 } as Player) *
      league.rules.schedule.regularSeasonWeeks;
    // The 53 comes first, then the practice squad.
    for (const team of aiTeams(league)) {
      getUnderCap(league, team.id, {
        amount: squadCost,
        what: "a full practice squad",
        releases: true,
      });
      keepFiftyThree(league, team.id);
    }
    formPracticeSquads(league, new Map(pending.map(({ p, from }) => [p.id, from])));
  });
}

/** Practice squads: teams take turns in claim order, one player a round, by need and value. */
function formPracticeSquads(league: League, cutBy: Map<number, string>): void {
  const order = claimOrder(league).filter(
    (id) => league.teams.find((t) => t.id === id)!.controller === "ai",
  );
  const max = league.rules.roster.practiceSquad.max;
  // Free agents' values don't change while squads form: score each once.
  const values = new Map(freeAgents(league).map((p) => [p.id, playerValue(league, p)]));
  for (let round = 0; round < max; round++) {
    for (const teamId of order) {
      const pick = practiceSquadPick(league, teamId, cutBy, values);
      if (pick)
        signFreeAgent(
          league,
          pick.id,
          teamId,
          "practice-squad",
          cutBy.get(pick.id) === teamId
            ? "Cleared waivers after final cuts; back on the practice squad to keep developing."
            : `Practice squad: the best ${pick.position} left for a position the squad needs.`,
        );
    }
  }
}

function practiceSquadPick(
  league: League,
  teamId: string,
  cutBy: Map<number, string>,
  values?: Map<number, number>,
): Player | null {
  const rules = league.rules.roster.practiceSquad;
  const squad = onTeam(league, teamId, "practice-squad");
  if (squad.length >= rules.max) return null;
  const veteranRoom =
    squad.filter((p) => isPracticeSquadVeteran(league, p)).length < rules.veteransMax;
  const mix = ROSTER_AI.practiceSquadMix as Partial<Record<Position, number>>;
  const short = new Set(
    (Object.keys(mix) as Position[]).filter(
      (pos) => squad.filter((p) => p.position === pos).length < mix[pos]!,
    ),
  );
  // Pay depends only on experience (restricted rate or the veteran minimum): price each once.
  const room = capSheet(league, teamId, league.season).room;
  const sample = { experience: 0 } as Player;
  const cost = (veteran: boolean) =>
    capHit(
      practiceSquadDeal(
        league,
        { ...sample, experience: veteran ? rules.restrictedMaxAccruedSeasons + 1 : 0 },
        teamId,
      ),
      league.season,
      league.rules.cap,
    );
  const affordable = { restricted: room >= cost(false), veteran: room >= cost(true) };
  let best: Player | null = null;
  let bestScore = -Infinity;
  for (const p of freeAgents(league)) {
    const veteran = isPracticeSquadVeteran(league, p);
    if (veteran ? !veteranRoom || !affordable.veteran : !affordable.restricted) continue;
    const score =
      (values?.get(p.id) ?? playerValue(league, p)) +
      (cutBy.get(p.id) === teamId ? ROSTER_AI.ownCutBonus : 0) +
      (short.has(p.position) ? 100 : 0);
    if (score > bestScore || (score === bestScore && best !== null && p.id < best.id)) {
      best = p;
      bestScore = score;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Each week of the season

/** Brings a team back to 53: its practice squad's best at the thinnest spot, else a free agent. */
function fillFiftyThree(league: League, teamId: string): void {
  for (let guard = 0; guard < 20 && openSpots(league, teamId) > 0; guard++) {
    const active = onTeam(league, teamId, "active").filter((p) => !p.injury);
    const thinnest = (Object.keys(ROSTER_MIX) as Position[])
      .map((pos) => ({
        pos,
        short: keepAtLeast(pos) - active.filter((p) => p.position === pos).length,
      }))
      .sort((a, b) => b.short - a.short || a.pos.localeCompare(b.pos))[0]!;
    const want = (p: Player) =>
      (p.position === thinnest.pos && thinnest.short > 0 ? 100 : 0) + playerValue(league, p);
    const fromSquad = best(onTeam(league, teamId, "practice-squad"), want);
    const fromMarket = best(freeAgents(league), want);
    // Another team's unprotected practice-squad player, if clearly better than anything closer.
    const others = league.teams.filter((t) => t.id !== teamId);
    const poachable = others.flatMap((t) => {
      const kept = protectedPracticeSquad(league, t.id);
      return onTeam(league, t.id, "practice-squad").filter((p) => !kept.has(p.id));
    });
    const fromOthers = best(poachable, want);
    const closest = Math.max(
      fromSquad ? want(fromSquad) : -Infinity,
      fromMarket ? want(fromMarket) : -Infinity,
    );
    const reason =
      thinnest.short > 0
        ? `Down to ${53 - openSpots(league, teamId)} players and thin at ${thinnest.pos}.`
        : `Down to ${53 - openSpots(league, teamId)} players.`;
    try {
      if (fromOthers && want(fromOthers) >= closest + ROSTER_AI.poachMargin)
        signFromPracticeSquad(
          league,
          fromOthers.id,
          teamId,
          `${reason} The best option was on another team's practice squad.`,
        );
      else if (fromSquad && (!fromMarket || want(fromSquad) >= want(fromMarket)))
        promote(league, fromSquad.id, reason);
      else if (fromMarket) signFreeAgent(league, fromMarket.id, teamId, "active", reason);
      else return;
    } catch {
      return; // no cap room for even a minimum deal: getUnderCap runs next week
    }
  }
}

/**
 * Under the cap with 53 players: get under the cap, then fill open spots. A team too tight to
 * afford fillers releases its costliest least-valuable player (a minimum deal costs less) and
 * tries again. Each open spot is priced at a veteran's minimum (the most a filler can cost).
 */
function keepFiftyThree(league: League, teamId: string): void {
  const topStep = league.rules.cap.minimumSalary.creditedSeasonFloors.at(-1)!;
  for (let round = 0; round < 4; round++) {
    const missing = Math.max(0, openSpots(league, teamId));
    const fillCost = missing * minimumSalary(league.rules.cap, league.season, topStep);
    getUnderCap(
      league,
      teamId,
      missing > 0 ? { amount: fillCost, what: "a full 53-man roster", releases: true } : undefined,
    );
    fillFiftyThree(league, teamId);
    if (openSpots(league, teamId) <= 0) return;
  }
}

/** Before each week's games: injured reserve, returns, 53 players, a full practice squad, the cap. */
export function weeklyRosterUpkeep(league: League): void {
  if (!inSeasonRosters(league)) return;
  const r = league.rules.roster.reserve;
  batch(league, () => {
    for (const team of aiTeams(league)) {
      // Out for weeks: injured reserve frees his spot.
      for (const p of onTeam(league, team.id, "active").sort((a, b) => a.id - b.id))
        if (p.injury && p.injury.gamesRemaining >= r.injuredMinGames)
          placeOnReserve(
            league,
            p.id,
            "injured-reserve",
            `Out ${p.injury.gamesRemaining} more games (${p.injury.description.toLowerCase()}).`,
          );
      // Back from a reserve list once healthy and past the minimum.
      for (const p of onTeam(league, team.id)
        .filter((x) => (x.roster === "injured-reserve" || x.roster === "pup") && x.reserve)
        .sort((a, b) => playerValue(league, b) - playerValue(league, a) || a.id - b.id)) {
        const min = p.roster === "pup" ? r.pupMinGames : r.injuredMinGames;
        if (p.injury || p.reserve!.gamesMissed < min) continue;
        const usesDesignation = p.roster === "injured-reserve" && !p.reserve!.designatedToReturn;
        if (usesDesignation && reserveReturnsLeft(league, team.id) <= 0) continue;
        if (openSpots(league, team.id) <= 0) {
          const weakest = onTeam(league, team.id, "active").sort(
            (a, b) => cutValue(league, a) - cutValue(league, b) || b.id - a.id,
          )[0];
          if (!weakest || cutValue(league, weakest) >= playerValue(league, p)) continue;
          waivePlayer(
            league,
            weakest.id,
            `Waived to make room for ${name(p)}, back from ${p.roster === "pup" ? "the PUP list" : "injured reserve"}.`,
          );
        }
        if (p.reserve!.designatedToReturn && p.roster === "injured-reserve") {
          // Already counted against the limit when designated: just back to the 53.
          p.roster = "active";
          p.reserve = null;
          recordTransaction(league, {
            type: "activated",
            teamIds: [team.id],
            playerIds: [p.id],
            text: `${team.id} activated ${name(p)} from injured reserve.`,
            reason: "Healthy, past the four-game minimum, and designated to return.",
          });
        } else activate(league, p.id, `Healthy and past the ${min}-game minimum.`);
      }
      keepFiftyThree(league, team.id);
      for (let i = 0; i < league.rules.roster.practiceSquad.max; i++) {
        const pick = practiceSquadPick(league, team.id, new Map());
        if (!pick) break;
        signFreeAgent(
          league,
          pick.id,
          team.id,
          "practice-squad",
          `Practice squad spot open: the best ${pick.position} available.`,
        );
      }
    }
  });
}

/**
 * Game-day elevations: up to two practice-squad players join a team for one game when injuries
 * leave a position short (each at most three times a season). Returns their ids by team.
 */
export function gameDayElevations(league: League, teamIds: string[]): Map<string, number[]> {
  const ps = league.rules.roster.practiceSquad;
  const out = new Map<string, number[]>();
  for (const teamId of teamIds) {
    const team = league.teams.find((t) => t.id === teamId)!;
    if (team.controller !== "ai") continue;
    const healthy = onTeam(league, teamId, "active").filter((p) => !p.injury);
    const chosen: number[] = [];
    for (const pos of (Object.keys(STARTERS) as Position[]).sort()) {
      if (chosen.length >= ps.elevationsPerGame) break;
      const short =
        STARTERS[pos] + (pos === "QB" ? 1 : 0) - healthy.filter((p) => p.position === pos).length;
      if (short <= 0) continue;
      const option = onTeam(league, teamId, "practice-squad")
        .filter(
          (p) =>
            p.position === pos &&
            !p.injury &&
            elevationsLeft(league, p) > 0 &&
            !chosen.includes(p.id),
        )
        .sort((a, b) => playerValue(league, b) - playerValue(league, a) || a.id - b.id)[0];
      if (!option) continue;
      option.elevations += 1;
      chosen.push(option.id);
      recordTransaction(league, {
        type: "elevated",
        teamIds: [teamId],
        playerIds: [option.id],
        text: `${teamId} elevated ${name(option)} (${pos}) from the practice squad for this week's game.`,
        reason: `Injuries left ${teamId} short at ${pos}; elevation ${option.elevations} of ${ps.elevationsPerPlayerPerSeason} this season (he returns to the practice squad after the game).`,
      });
    }
    if (chosen.length > 0) out.set(teamId, chosen);
  }
  return out;
}

/** After each game a team plays: its reserve players have missed one more game. */
export function countReserveGames(league: League, teamIds: string[]): void {
  const playing = new Set(teamIds);
  for (const p of league.players)
    if (p.teamId && playing.has(p.teamId) && p.reserve) p.reserve.gamesMissed += 1;
}

// ---------------------------------------------------------------------------
// The season's end

/**
 * After the championship: practice-squad players' deals end (each team keeps its best on futures
 * deals for next season), reserve lists clear, and players past their position's age limit or
 * unsigned all season retire (placeholder until Phase 9).
 */
export function seasonEnds(league: League): void {
  const season = league.season;
  batch(league, () => {
    for (const team of aiTeams(league)) {
      const squad = onTeam(league, team.id, "practice-squad").sort(
        (a, b) => playerValue(league, b) - playerValue(league, a) || a.id - b.id,
      );
      squad.forEach((p, i) => {
        if (i < ROSTER_AI.futuresKept) {
          // A reserve/future deal: next season's minimum, on the 90 from the new League Year.
          const deal = minimumDeal(
            { ...league, season: season + 1, date: `${season + 1}-01-01` },
            p,
            team.id,
          );
          p.contract = { ...deal, signedOn: league.date };
          p.roster = "active";
          recordTransaction(league, {
            type: "signed",
            teamIds: [team.id],
            playerIds: [p.id],
            text: `${team.id} signed ${name(p)} (${p.position}) to a reserve/future deal for ${season + 1}.`,
            reason: "One of the practice squad's best: kept for next season's camp.",
          });
        } else {
          p.teamId = null;
          p.contract = null;
          p.roster = "active";
        }
      });
    }
    for (const p of league.players) {
      if (p.teamId !== null && p.roster !== "practice-squad") p.roster = "active";
      p.reserve = null;
      p.elevations = 0;
    }
  });
}

/**
 * Retirement (Phase 9's model, lifecycle/retirement.ts), at the start of the offseason for the
 * season just ended. A retiring player gives up the salary still to come; the bonus money left
 * on his deal speeds up onto his team's cap for the new League Year.
 */
export function retirePlayers(league: League, endedSeason: number): void {
  batch(league, () => {
    for (const p of [...league.players].sort((a, b) => a.id - b.id)) {
      if (p.retiredAfter !== null) continue;
      const rng = new Rng(streamSeed(league.meta.seed, `retire:${endedSeason}:${p.id}`));
      const reason = decideRetirement(league, p, endedSeason, rng);
      if (reason === null) continue;
      const teamId = p.teamId;
      if (teamId && p.contract) {
        const leftover = remainingProration(p.contract, league.season);
        if (leftover > 0)
          league.teams
            .find((t) => t.id === teamId)!
            .cap.deadMoney.push({
              season: league.season,
              playerId: p.id,
              amount: leftover,
              reason: `${name(p)} retired: his remaining bonus money speeds up`,
            });
      }
      p.teamId = null;
      p.contract = null;
      p.roster = "active";
      p.retiredAfter = endedSeason;
      recordTransaction(league, {
        type: "retired",
        teamIds: teamId ? [teamId] : [],
        playerIds: [p.id],
        text: `${name(p)} (${p.position}) retired after the ${endedSeason} season.`,
        reason,
      });
    }
  });
}
