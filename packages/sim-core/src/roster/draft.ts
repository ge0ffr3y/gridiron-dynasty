/**
 * The placeholder draft (Phase 8; Phase 11 brings scouting, the real 2026
 * class and draft day). On draft day a generated class (the size and position
 * mix of a real draft) is picked in the draft order already set when last
 * season ended: each team takes the best prospect left, counting his room to
 * grow and nudged toward thin positions. Every pick signs a rookie deal on the
 * real wage scale; then teams fill out to 90 with undrafted free agents.
 */
import { addDays, overallAt, POSITIONS, Rng, streamSeed, type Position } from "@fgm/foundation";
import { rookieContract } from "../contracts/generate";
import { minimumSalary } from "../contracts/cap";
import { recordTransaction } from "../contracts/operations";
import { generatePlayer, generateRatings } from "../generate/players";
import { COLLEGES } from "../generate/names";
import { NamePicker } from "../generate/people";
import { ROSTER_MIX } from "../generate/config";
import type { Contract, League, Player } from "../league/schema";
import { getUnderCap } from "../contracts/upkeep";
import { DRAFT_CLASS } from "./config";
import { onTeam, openSpots } from "./lists";
import { playerValue, waivePlayer } from "./moves";

const ordinal = (n: number) =>
  `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th")}`;

function meanOverall(rank: number): number {
  const knots = DRAFT_CLASS.overallByRank;
  for (let i = 0; i < knots.length - 1; i++) {
    const [r0, v0] = knots[i]!;
    const [r1, v1] = knots[i + 1]!;
    if (rank <= r1) return v0 + ((v1 - v0) * (Math.max(rank, r0) - r0)) / (r1 - r0);
  }
  return knots[knots.length - 1]![1];
}

/** This year's prospects, best first (free agents until drafted or signed). */
export function generateClass(league: League, size: number): Player[] {
  const season = league.season;
  const rng = new Rng(streamSeed(league.meta.seed, `draft-class:${season}`));
  const names = new NamePicker(new Rng(streamSeed(league.meta.seed, `draft-names:${season}`)));
  const ctx = {
    rng,
    names,
    date: league.date,
    season,
    teamIds: league.teams.map((t) => t.id),
    draftRounds: league.rules.draft.rounds,
    colleges: COLLEGES,
  };
  // Positions in the proportions of a 90-man roster (as real drafts roughly are).
  const mix = POSITIONS.flatMap((pos) => Array<Position>(ROSTER_MIX[pos]).fill(pos));
  const prospects: Player[] = [];
  for (let rank = 1; rank <= size; rank++) {
    const position = mix[rng.int(mix.length)]!;
    const p = generatePlayer(ctx, league.nextIds.player++, "", position, "camp", 0, new Set());
    const specialist = position === "K" || position === "P" || position === "LS";
    const target = rng.gaussian(
      meanOverall(rank) + (specialist ? DRAFT_CLASS.specialistBonus : 0),
      DRAFT_CLASS.overallSpread,
    );
    p.ratings = generateRatings(rng, position, target);
    const age = rng.intBetween(DRAFT_CLASS.ages[0], DRAFT_CLASS.ages[1]);
    p.birthDate = addDays(`${season - age}${league.date.slice(4)}`, -rng.int(365));
    p.experience = 0;
    p.drafted = null;
    p.teamId = null;
    const growth =
      DRAFT_CLASS.growthMean +
      DRAFT_CLASS.growthTopExtra * Math.max(0, 1 - rank / size) +
      (DRAFT_CLASS.growthByPosition[position] ?? 0);
    const overall = overallAt(p.ratings, position);
    p.hidden.potential = Math.min(
      99,
      Math.max(overall, Math.round(overall + rng.gaussian(growth, DRAFT_CLASS.growthSpread))),
    );
    prospects.push(p);
  }
  return prospects;
}

/** A prospect's worth to any team (before need): his overall plus some of his room to grow. */
function baseDraftValue(p: Player): number {
  const overall = overallAt(p.ratings, p.position);
  // Teams don't spend early picks on kickers: a specialist's head start doesn't count here.
  const specialist = p.position === "K" || p.position === "P" || p.position === "LS";
  return (
    overall +
    DRAFT_CLASS.potentialWeight * (p.hidden.potential - overall) -
    (specialist ? DRAFT_CLASS.specialistBonus : 0)
  );
}

/** The team's favorite prospect left: base value, nudged toward positions it's thin at. */
function bestFor(
  league: League,
  teamId: string,
  available: Map<number, { p: Player; value: number }>,
): Player | null {
  const counts = new Map<Position, number>();
  for (const x of onTeam(league, teamId)) counts.set(x.position, (counts.get(x.position) ?? 0) + 1);
  let best: Player | null = null;
  let bestValue = -Infinity;
  for (const { p, value } of available.values()) {
    const v =
      value + ((counts.get(p.position) ?? 0) < ROSTER_MIX[p.position] ? DRAFT_CLASS.needBonus : 0);
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
  const prospects = generateClass(league, picks.length + DRAFT_CLASS.undraftedPool);
  league.players.push(...prospects);
  const available = new Map(prospects.map((p) => [p.id, { p, value: baseDraftValue(p) }]));
  const teamCount = league.teams.length;

  for (const pick of picks) {
    const teamId = pick.ownerTeamId;
    const choice = bestFor(league, teamId, available);
    if (!choice) break;
    available.delete(choice.id);
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
        "Best prospect left on the board for this team (placeholder draft until Phase 11), counting room to grow and thin positions.",
    });
  }

  // The undrafted rush: teams fill open spots with the best prospects left, one at a time in draft order.
  let undrafted = 0;
  const order = picks.filter((p) => p.round === 1).map((p) => p.ownerTeamId);
  for (let round = 0; round < 60 && available.size > 0; round++) {
    let signed = false;
    for (const teamId of order) {
      if (openSpots(league, teamId) <= 0) continue;
      const choice = bestFor(league, teamId, available);
      if (!choice) break;
      available.delete(choice.id);
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
          "Undrafted free-agent rush after the draft: an open camp spot, best prospect left for this team.",
      });
    }
    if (!signed) break;
  }
  // First-round deals can push a tight team over the cap: it restructures or releases, with reasons.
  for (const team of league.teams) getUnderCap(league, team.id);
  return { drafted: picks.length, undrafted };
}
