/**
 * Draft classes (Phase 11). Each class is a list of college prospects for one
 * draft year: about as many as there are picks (in the real position mix and
 * ages by round, calibration/draft.json) plus the pool teams sign undrafted.
 * Prospects aren't on any team and aren't free agents; on draft day they
 * become players (drafted, signed undrafted, or left as free agents).
 *
 * The next class appears as soon as the last draft is over (or when the league
 * is created), so scouts study it from September to April.
 */
import {
  addDays,
  daysBetween,
  overallAt,
  POSITIONS,
  Rng,
  streamSeed,
  ALTERNATE_POSITIONS,
  ATTRIBUTES,
  OVERALL_WEIGHTS,
  type Position,
  type Ratings,
} from "@fgm/foundation";
import draftData from "../../../../calibration/draft.json";
import { generatePlayer, generateRatings } from "../generate/players";
import { COLLEGES } from "../generate/names";
import { NamePicker } from "../generate/people";
import { JERSEY_RANGES, ROSTER_MIX } from "../generate/config";
import type { League, Measurables, Player, Prospect } from "../league/schema";
import { NEW_PLAYER_ROSTER } from "../roster/defaults";
import { DRAFT_CLASS } from "../roster/config";
import { seasonDates } from "../season/calendar";
import { drillResults, physicalsFromDrills } from "./measurables";
import { meanOverall } from "./strength";

export { meanOverall };
import { regionOf } from "./regions";
import { uniformFrom } from "./noise";

const SPECIALISTS = new Set<Position>(["K", "P", "LS"]);

/** The draft year the next class belongs to: this season's, until its draft is done. */
export function upcomingDraftYear(league: League): number {
  const done = league.calendar.stage !== "offseason" && league.calendar.stage !== "free-agency";
  return done ? league.season + 1 : league.season;
}

/** The class for a draft year, best (truly) first as generated. */
export function draftClass(league: League, draftYear = upcomingDraftYear(league)): Prospect[] {
  return league.prospects.filter((p) => p.draftYear === draftYear);
}

/** A position drawn from the real mix for a round (the undrafted pool: a 90-man roster's mix). */
function drawPosition(rng: Rng, round: number | null): Position {
  const mix = round
    ? (draftData.positionMix as Record<string, Record<string, number>>)[round]
    : null;
  if (mix) {
    let u = rng.next();
    const entries = POSITIONS.filter((p) => (mix[p] ?? 0) > 0);
    for (const pos of entries) {
      u -= mix[pos]!;
      if (u < 0) return pos;
    }
    return entries[entries.length - 1]!;
  }
  const pool = POSITIONS.flatMap((pos) => Array<Position>(ROSTER_MIX[pos]).fill(pos));
  return pool[rng.int(pool.length)]!;
}

/** Age on draft day from the real ages by round (the undrafted: like the last round). */
function drawAge(rng: Rng, round: number | null): number {
  const ages = draftData.ages;
  const row = ages.find((a) => a.round === round) ?? ages[ages.length - 1]!;
  return Math.max(20, Math.round(rng.gaussian(row.mean, row.spread)));
}

/** Share of picks who were at the combine, and of the undrafted pool, from the real invite counts. */
function inviteShares(picks: number, pool: number): { drafted: number; undrafted: number } {
  const { invitesPerYear, draftedShare } = draftData.combine;
  const drafted = Math.min(1, (invitesPerYear * draftedShare) / Math.max(1, picks));
  const undrafted = Math.min(1, (invitesPerYear * (1 - draftedShare)) / Math.max(1, pool));
  return { drafted, undrafted };
}

/** Converts a generated player into a prospect for a draft year. */
function asProspect(
  league: League,
  p: Player,
  draftYear: number,
  invited: boolean,
  anchorRank: number,
): Prospect {
  return {
    id: p.id,
    firstName: p.firstName,
    lastName: p.lastName,
    position: p.position,
    college: p.college,
    region: regionOf(p.college),
    birthDate: p.birthDate,
    heightIn: p.heightIn,
    weightLb: p.weightLb,
    draftYear,
    ratings: p.ratings,
    familiarity: p.familiarity,
    hidden: p.hidden,
    personality: p.personality,
    measurables: drillResults(p.ratings, p.position, `${league.meta.seed}:drills:${p.id}`),
    invited,
    tested: false,
    anchorRank,
  };
}

/**
 * What the league expects of a prospect of this rank (before anyone knows better): the rank's
 * overall and potential. Scouts' shared read starts here; the truth differs by the hidden spread.
 */
export function anchorFor(
  league: League,
  position: Position,
  rank: number,
): { overall: number; potential: number } {
  const total = league.rules.draft.rounds * league.teams.length + DRAFT_CLASS.undraftedPool;
  const overall = meanOverall(rank) + (SPECIALISTS.has(position) ? DRAFT_CLASS.specialistBonus : 0);
  const growth =
    DRAFT_CLASS.growthMean +
    DRAFT_CLASS.growthTopExtra * Math.max(0, 1 - rank / total) +
    (DRAFT_CLASS.growthByPosition[position] ?? 0);
  return { overall, potential: Math.min(99, overall + growth) };
}

/** His true overall: the rank's level plus the hidden spread that makes busts and gems. */
function talentTarget(rng: Rng, rank: number, position: Position): number {
  return rng.gaussian(
    meanOverall(rank) + (SPECIALISTS.has(position) ? DRAFT_CLASS.specialistBonus : 0),
    DRAFT_CLASS.overallSpread,
  );
}

/** His hidden potential: room to grow above his overall, more for the best prospects. */
function drawPotential(
  rng: Rng,
  ratings: Ratings,
  position: Position,
  rank: number,
  total: number,
): number {
  const growth =
    DRAFT_CLASS.growthMean +
    DRAFT_CLASS.growthTopExtra * Math.max(0, 1 - rank / total) +
    (DRAFT_CLASS.growthByPosition[position] ?? 0);
  const overall = overallAt(ratings, position);
  return Math.min(
    99,
    Math.max(overall, Math.round(overall + rng.gaussian(growth, DRAFT_CLASS.growthSpread))),
  );
}

/** How many picks a draft year has (all rounds, before compensatory picks are added). */
function picksIn(league: League, draftYear: number): number {
  const n = league.draftPicks.filter((p) => p.season === draftYear).length;
  return n > 0 ? n : league.rules.draft.rounds * league.teams.length;
}

/**
 * A generated class: one prospect per pick plus the undrafted pool. Strength by rank comes from
 * DRAFT_CLASS (tuned so the league stays balanced over decades); positions and ages follow the
 * real drafts round by round; drills come from each prospect's physical ratings.
 */
export function generateClass(league: League, draftYear: number, size?: number): Prospect[] {
  const rng = new Rng(streamSeed(league.meta.seed, `draft-class:${draftYear}`));
  const names = new NamePicker(new Rng(streamSeed(league.meta.seed, `draft-names:${draftYear}`)));
  const draftDay = seasonDates(league.rules, draftYear).draft;
  const ctx = {
    rng,
    names,
    date: draftDay,
    season: draftYear,
    teamIds: league.teams.map((t) => t.id),
    draftRounds: league.rules.draft.rounds,
    colleges: COLLEGES,
  };
  const picks = picksIn(league, draftYear);
  const total = size ?? picks + DRAFT_CLASS.undraftedPool;
  const invites = inviteShares(picks, total - picks);
  const teams = league.teams.length;
  const out: Prospect[] = [];
  // Names nobody in the league already has (players, coaches, other prospects).
  const taken = new Set(
    [...league.players, ...league.coaches, ...league.prospects].map(
      (x) => `${x.firstName} ${x.lastName}`,
    ),
  );
  for (let rank = 1; rank <= total; rank++) {
    const round =
      rank <= picks ? Math.min(league.rules.draft.rounds, Math.ceil(rank / teams)) : null;
    const position = drawPosition(rng, round);
    const p = generatePlayer(ctx, league.nextIds.player++, "", position, "camp", 0, new Set());
    while (taken.has(`${p.firstName} ${p.lastName}`)) Object.assign(p, names.next());
    taken.add(`${p.firstName} ${p.lastName}`);
    p.ratings = generateRatings(rng, position, talentTarget(rng, rank, position));
    const age = drawAge(rng, round);
    p.birthDate = addDays(`${draftYear - age}${draftDay.slice(4)}`, -rng.int(365));
    p.hidden.potential = drawPotential(rng, p.ratings, position, rank, total);
    const invited = rng.chance(round ? invites.drafted : invites.undrafted);
    out.push(asProspect(league, p, draftYear, invited, rank));
  }
  return out;
}

/** Makes sure the upcoming draft has a class (a new league, or right after a draft). */
export function ensureDraftClass(league: League): void {
  const year = upcomingDraftYear(league);
  if (league.prospects.some((p) => p.draftYear === year)) return;
  league.prospects.push(...generateClass(league, year));
}

/** A prospect becomes a player (drafted, signed undrafted, or a free agent after the draft). */
export function prospectToPlayer(prospect: Prospect): Player {
  return {
    id: prospect.id,
    firstName: prospect.firstName,
    lastName: prospect.lastName,
    position: prospect.position,
    teamId: null,
    jersey: JERSEY_RANGES[prospect.position][0]![0],
    birthDate: prospect.birthDate,
    heightIn: prospect.heightIn,
    weightLb: prospect.weightLb,
    experience: 0,
    college: prospect.college,
    drafted: null,
    ratings: prospect.ratings,
    familiarity: prospect.familiarity,
    hidden: prospect.hidden,
    personality: prospect.personality,
    contract: null,
    stats: [],
    injury: null,
    knock: null,
    injuryHistory: [],
    ratingHistory: [],
    ...NEW_PLAYER_ROSTER,
    measurables: prospect.tested ? prospect.measurables : null,
  };
}

/** A prospect's pro-day date: spread from two weeks after the combine to two weeks before the draft. */
export function proDayDate(league: League, prospect: Prospect): string {
  const dates = seasonDates(league.rules, prospect.draftYear);
  const first = addDays(dates.combine, 14);
  const last = addDays(dates.draft, -14);
  const span = Math.max(0, daysBetween(first, last));
  return addDays(
    first,
    Math.floor(uniformFrom(`${league.meta.seed}:proday:${prospect.id}`) * (span + 1)),
  );
}

/** A real prospect's facts (the real 2026 class, renamed; built by the pipeline). */
export interface RealProspectInput {
  key: string;
  firstName: string;
  lastName: string;
  position: Position;
  /** Fictional school. */
  college: string;
  /** Age on draft day, if known. */
  age: number | null;
  heightIn: number;
  weightLb: number;
  /** His real combine results (null: not run, or not at the combine). */
  drills: Measurables;
  invited: boolean;
  /** Where he was really drafted (overall pick), or null if he wasn't. */
  pick: number | null;
}

/** Moves the skills that count for a position so the overall lands on `target` (physicals stay). */
function retarget(ratings: Ratings, position: Position, target: number): void {
  const weights = OVERALL_WEIGHTS[position];
  const skills = ATTRIBUTES.filter((a) => a.group !== "physical" && (weights[a.key] ?? 0) > 0);
  const all = Object.values(weights).reduce((a, w) => a + (w ?? 0), 0);
  const share = skills.reduce((a, s) => a + (weights[s.key] ?? 0), 0) / Math.max(1e-9, all);
  if (share <= 0) return;
  for (let pass = 0; pass < 4; pass++) {
    const diff = target - overallAt(ratings, position);
    if (Math.abs(diff) < 0.5) return;
    for (const s of skills)
      ratings[s.key] = Math.max(1, Math.min(99, Math.round(ratings[s.key] + diff / share)));
  }
}

/**
 * The real class for a draft year: real positions, sizes, ages and combine results, ranked by
 * where they were really drafted (the undrafted after them), with true talent drawn around that
 * rank's level plus the hidden spread, so the real draft order is the consensus but not the
 * truth. Physical ratings come from the real drills. The rest of the pool is generated.
 */
export function realClass(
  league: League,
  inputs: RealProspectInput[],
  draftYear: number,
): Prospect[] {
  const ordered = [...inputs].sort(
    (a, b) =>
      (a.pick ?? Number.MAX_SAFE_INTEGER) - (b.pick ?? Number.MAX_SAFE_INTEGER) ||
      Number(b.invited) - Number(a.invited) ||
      a.key.localeCompare(b.key),
  );
  const out = generateClass(
    league,
    draftYear,
    Math.max(ordered.length, picksIn(league, draftYear) + DRAFT_CLASS.undraftedPool),
  );
  const total = out.length;
  const draftDay = seasonDates(league.rules, draftYear).draft;
  ordered.forEach((input, i) => {
    const rank = i + 1;
    const template = out[i]!;
    const rng = new Rng(streamSeed(league.meta.seed, `real-prospect:${input.key}`));
    const position = input.position;
    const ratings = generateRatings(rng, position, talentTarget(rng, rank, position));
    const target = overallAt(ratings, position);
    Object.assign(ratings, physicalsFromDrills(input.drills, position, ratings));
    retarget(ratings, position, target);
    const familiarity: Prospect["familiarity"] = { [position]: 1 };
    for (const alt of ALTERNATE_POSITIONS[position] ?? [])
      if (rng.chance(alt.chance))
        familiarity[alt.position] = Math.round(rng.range(0.4, 0.95) * 100) / 100;
    const round = input.pick
      ? Math.min(league.rules.draft.rounds, Math.ceil(input.pick / league.teams.length))
      : null;
    const age = input.age ?? drawAge(rng, round);
    // Drills he didn't run at the combine (or he wasn't there): his pro day, from his ratings.
    const proDay = drillResults(ratings, position, `${league.meta.seed}:drills:${template.id}`);
    out[i] = {
      ...template,
      firstName: input.firstName,
      lastName: input.lastName,
      position,
      college: input.college,
      region: regionOf(input.college),
      birthDate: addDays(`${draftYear - age}${draftDay.slice(4)}`, -rng.int(365)),
      heightIn: input.heightIn,
      weightLb: input.weightLb,
      ratings,
      familiarity,
      hidden: { ...template.hidden, potential: drawPotential(rng, ratings, position, rank, total) },
      measurables: input.invited ? input.drills : proDay,
      invited: input.invited,
      anchorRank: rank,
    };
  });
  return out;
}

/**
 * A new game from the real league: the real class keeps its facts, but its hidden spread is
 * drawn again from the game's own seed, so each game's busts and gems differ. The skills that
 * count move by the difference; physicals (measured) stay.
 */
export function redrawClass(league: League): void {
  const total = league.prospects.length;
  for (const p of league.prospects) {
    const rng = new Rng(streamSeed(league.meta.seed, `redraw-prospect:${p.id}`));
    retarget(p.ratings, p.position, talentTarget(rng, p.anchorRank, p.position));
    p.hidden.potential = drawPotential(rng, p.ratings, p.position, p.anchorRank, total);
  }
}
