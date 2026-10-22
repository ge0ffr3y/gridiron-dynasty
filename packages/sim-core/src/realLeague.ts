/**
 * Assembles the real league (Phase 6) from facts the pipeline gathered:
 * players and coaches (already renamed), and the real 2025 season's scores.
 * The real 2025 season goes through the same standings, tiebreaker and
 * draft-order code as a simulated one, then the 2026 league year begins.
 *
 * Anything the real data doesn't say (hidden traits, personalities, coach
 * attributes, ratings for players with no rating source) is generated here
 * from a seed per person, so rebuilding gives the same league.
 */
import { generateAgents } from "./people/agents";
import { emptyScouting } from "./scouting/config";
import { NEW_PLAYER_ROSTER } from "./roster/defaults";
import {
  ALTERNATE_POSITIONS,
  overallAt,
  Rng,
  streamSeed,
  type LeagueDate,
  type Position,
  type Ratings,
} from "@fgm/foundation";
import {
  LEAGUE_FORMAT,
  LEAGUE_FORMAT_VERSION,
  type Coach,
  type Contract,
  type CoachRole,
  type Game,
  type GameRound,
  type HiddenTraits,
  type SeasonStats,
  type League,
  type Player,
  type Team,
} from "./league/schema";
import { rulesFor, teamIdsInOrder } from "./rules";
import { emptyTeamCap } from "./contracts/team";
import { generateContracts } from "./contracts/generate";
import { seedSalaryHistory } from "./contracts/tags";
import { minimumSalary } from "./contracts/cap";
import { COACH_AGE_FALLBACK } from "./coaches/config";
import { completeSeasonFromResults, ensureClassAndScouts, startNextSeason } from "./season/flow";
import { realClass, redrawClass, type RealProspectInput } from "./scouting/classes";
import { assignScouts } from "./scouting/study";
import { stadiumFor } from "./season/weather";
import { fillStaff, generateCoach } from "./generate/coaches";
import {
  DRAFT_PEDIGREE_GROWTH,
  DRAFT_PEDIGREE_GROWTH_LATER,
  GROWTH_PER_YEAR,
  PEAK_AGE,
  TRAIT_MEAN,
  TRAIT_SPREAD,
  UNDRAFTED_GROWTH,
} from "./generate/config";
import type { NamePicker } from "./generate/people";
import { generateDraftPicks, generateRatings } from "./generate/players";
import { PLACEHOLDER_TEAMS } from "./generate/teams";
import { bounded, randomShares, score } from "./generate/util";

/** One real player, renamed, as the pipeline hands him over. */
export interface RealPlayerInput {
  /** A stable key (the source's player id); seeds everything generated for him. */
  key: string;
  firstName: string;
  lastName: string;
  position: Position;
  /** Other positions he has played, 0-1. */
  familiarity?: Partial<Record<Position, number>>;
  teamId: string | null;
  jersey: number;
  birthDate: LeagueDate;
  heightIn: number;
  weightLb: number;
  /** Credited seasons, counting 2025. */
  experience: number;
  college: string;
  drafted: Player["drafted"];
  /** Ratings from a rating source, or a target overall to generate them around. */
  ratings: Ratings | { targetOverall: number };
  /** Last season of his contract (Phase 7 brings real contracts). */
  contractThrough: number | null;
  /** Hidden traits the real data speaks to (the rest are generated). */
  hidden?: Partial<HiddenTraits>;
  /** Real season-by-season stats, oldest first. */
  stats?: SeasonStats[];
  /** His real contract when the league starts (null: none for this League Year, e.g. a pending free agent). */
  contract?: Contract | null;
  /**
   * Bonus proration still charged to his team after his deal ended with the last
   * season (its void years accelerate), by season. Becomes the team's dead money.
   */
  voidedProration?: { season: number; amount: number }[];
}

/** A team's published cap facts at the start: dead money left by earlier moves, and room carried over. */
export interface RealTeamCapInput {
  /** Dead money already on the books, by season (from moves made before the league began). */
  deadMoney: { season: number; amount: number }[];
  carryover: number;
}

export interface RealCoachInput {
  key: string;
  firstName: string;
  lastName: string;
  role: CoachRole;
  teamId: string;
  birthDate: LeagueDate | null;
  experience: number | null;
  /** Tendencies measured from his real teams (Phase 10); the rest are drawn as for generated coaches. */
  style?: Partial<Coach["style"]>;
  /** His real career so far (Phase 10b): head coaches' seasons and records. */
  career?: Coach["career"];
}

/** A real game from the season before the league starts. */
export interface RealGameInput {
  round: GameRound;
  week: number;
  date: LeagueDate;
  homeId: string;
  awayId: string;
  neutral: boolean;
  homeScore: number;
  awayScore: number;
  homeTouchdowns: number;
  awayTouchdowns: number;
  overtime: boolean;
}

export interface RealLeagueInput {
  name: string;
  seed: number;
  /** How the file was built (sources and dates), shown to curious players. */
  source: string;
  /** The season that was played for real; the league starts the year after. */
  season: number;
  players: RealPlayerInput[];
  coaches: RealCoachInput[];
  games: RealGameInput[];
  /** Fills coach jobs the real data doesn't cover (special teams, scouts). */
  names: NamePicker;
  /** Real contracts are on the players; these are each team's starting dead money and carryover. */
  teamCaps?: Record<string, RealTeamCapInput>;
  /** The real draft class for the league's first draft (Phase 11), renamed. */
  prospects?: RealProspectInput[];
  /**
   * The real first draft's order (Phase 11b): each pick's number, round and the club that made
   * it, compensatory picks included. Regular picks keep their original club from the standings.
   */
  draftOrder?: { overall: number; round: number; teamId: string }[];
}

/** A seeded random stream for one person, independent of everyone else. */
function personRng(seed: number, key: string): Rng {
  return new Rng(streamSeed(seed, `person:${key}`));
}

function ageOn(birthDate: string, date: string): number {
  const [by, bm, bd] = birthDate.split("-").map(Number) as [number, number, number];
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

function realPlayer(input: RealPlayerInput, id: number, date: LeagueDate, seed: number): Player {
  const rng = personRng(seed, input.key);
  const ratings =
    "targetOverall" in input.ratings
      ? generateRatings(rng, input.position, input.ratings.targetOverall)
      : input.ratings;
  const overall = overallAt(ratings, input.position);
  const age = ageOn(input.birthDate, date);
  const familiarity: Player["familiarity"] = { ...input.familiarity, [input.position]: 1 };
  if (!input.familiarity)
    for (const alt of ALTERNATE_POSITIONS[input.position] ?? [])
      if (rng.chance(alt.chance))
        familiarity[alt.position] = Math.round(rng.range(0.4, 0.95) * 100) / 100;
  // Young players have room to grow, high draft picks more than most (scouts saw it in them).
  const pedigree = input.drafted
    ? (DRAFT_PEDIGREE_GROWTH[input.drafted.round] ?? DRAFT_PEDIGREE_GROWTH_LATER)
    : UNDRAFTED_GROWTH;
  const growthRoom =
    age < PEAK_AGE ? (PEAK_AGE - age) * GROWTH_PER_YEAR * pedigree * rng.range(0.2, 1.3) : 0;
  const potential = bounded(overall + Math.max(0, growthRoom + rng.gaussian(0, 2)), overall, 99);
  const [money, winning, role, location] = randomShares(rng, 4) as [number, number, number, number];
  return {
    id,
    firstName: input.firstName,
    lastName: input.lastName,
    position: input.position,
    teamId: input.teamId,
    jersey: input.jersey,
    birthDate: input.birthDate,
    heightIn: input.heightIn,
    weightLb: input.weightLb,
    experience: input.experience,
    college: input.college,
    drafted: input.drafted,
    ratings,
    familiarity,
    hidden: {
      ...generatedTraits(rng),
      potential,
      ...input.hidden,
    },
    personality: {
      ego: score(rng, TRAIT_MEAN - 5, TRAIT_SPREAD),
      loyalty: score(rng, TRAIT_MEAN, TRAIT_SPREAD),
      leadership: score(rng, TRAIT_MEAN - 5, TRAIT_SPREAD),
      temperament: score(rng, TRAIT_MEAN, TRAIT_SPREAD),
      priorities: { money, winning, role, location },
    },
    // Contracts come after the whole league is assembled (generated until Phase 7b imports real ones).
    contract: null,
    stats: input.stats ?? [],
    injury: null,
    ratingHistory: [],
    knock: null,
    injuryHistory: [],
    ...NEW_PLAYER_ROSTER,
  };
}

/** Traits real data doesn't measure: drawn around league averages, as for generated players. */
function generatedTraits(rng: Rng): Omit<HiddenTraits, "potential"> {
  return {
    workEthic: score(rng, TRAIT_MEAN, TRAIT_SPREAD),
    consistency: score(rng, TRAIT_MEAN, TRAIT_SPREAD),
    injuryProneness: score(rng, TRAIT_MEAN - 10, TRAIT_SPREAD),
    durability: score(rng, TRAIT_MEAN, TRAIT_SPREAD),
    coachability: score(rng, TRAIT_MEAN, TRAIT_SPREAD),
    clutch: score(rng, TRAIT_MEAN - 5, TRAIT_SPREAD),
  };
}

function realCoach(input: RealCoachInput, id: number, date: LeagueDate, seed: number): Coach {
  const rng = personRng(seed, input.key);
  // Generated skills; the facts we have (age, experience, real tendencies) override the rest.
  const coach = generateCoach(
    rng,
    { next: () => ({ firstName: input.firstName, lastName: input.lastName }) } as NamePicker,
    date,
    id,
    input.teamId,
    input.role,
    COACH_AGE_FALLBACK[input.role],
  );
  if (input.birthDate) coach.birthDate = input.birthDate;
  if (input.experience !== null) coach.experience = input.experience;
  if (input.style) Object.assign(coach.style, input.style);
  if (input.career) coach.career = input.career;
  return coach;
}

/** The real league, at the end of `input.season`, moved on to the next league year. */
export function assembleRealLeague(input: RealLeagueInput): League {
  const rules = rulesFor(input.season);
  const nextRules = rulesFor(input.season + 1);
  const teamIds = teamIdsInOrder(nextRules);
  const date = nextRules.startDate;

  const teams: Team[] = [];
  for (const conference of nextRules.structure.conferences)
    for (const division of conference.divisions)
      for (const id of division.teams) {
        const identity = PLACEHOLDER_TEAMS[id];
        if (!identity) throw new Error(`no placeholder identity for team ${id}`);
        teams.push({
          id,
          city: identity.city,
          nickname: identity.nickname,
          abbreviation: id,
          conferenceId: conference.id,
          divisionId: division.id,
          colors: { primary: identity.colors[0], secondary: identity.colors[1] },
          controller: "ai",
          reserveReturns: [],
          scouting: emptyScouting(),
          elevated: [],
          depthChart: { auto: true, slots: {} },
          stadium: stadiumFor(id),
          cap: emptyTeamCap(),
        });
      }

  // Stable order: by key, so ids don't depend on the order the pipeline read its files.
  const players = [...input.players]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((p, i) => realPlayer(p, i, date, input.seed));
  const coaches = [...input.coaches]
    .sort((a, b) => a.teamId.localeCompare(b.teamId) || a.role.localeCompare(b.role))
    .map((c, i) => realCoach(c, i, date, input.seed));
  const draftPicks = generateDraftPicks(
    input.season + 1,
    nextRules.draft.seasonsOfPicksHeld,
    nextRules.draft.rounds,
    teamIds,
    0,
  );

  const games: Game[] = input.games.map((g, id) => ({
    id,
    season: input.season,
    round: g.round,
    week: g.week,
    date: g.date,
    homeId: g.homeId,
    awayId: g.awayId,
    neutral: g.neutral,
    result: {
      homeScore: g.homeScore,
      awayScore: g.awayScore,
      homeTouchdowns: g.homeTouchdowns,
      awayTouchdowns: g.awayTouchdowns,
      overtime: g.overtime,
    },
    boxScore: null,
    weather: null,
  }));

  const league: League = {
    format: LEAGUE_FORMAT,
    formatVersion: LEAGUE_FORMAT_VERSION,
    meta: { name: input.name, seed: input.seed, kind: "real", source: input.source },
    rules,
    date,
    season: input.season,
    calendar: { stage: "complete", week: 1 },
    teams,
    players,
    coaches,
    draftPicks,
    games,
    preseasonGames: [],
    settings: { preseasonGames: true, viewingAs: null },
    history: [],
    salaryHistory: [],
    coachingMoves: [],
    prospects: [],
    freeAgentMoves: [],
    agents: generateAgents(input.seed),
    negotiations: [],
    freeAgency: null,
    development: [],
    transactions: [
      {
        id: 0,
        date,
        type: "league-created",
        teamIds: [],
        playerIds: [],
        text: `${input.name} begins from the real league as it stood after the ${input.season} season.`,
        reason: input.source,
      },
    ],
    pendingDecisions: [],
    rng: {},
    nextIds: {
      player: players.length,
      coach: coaches.length,
      draftPick: draftPicks.length,
      transaction: 1,
      decision: 0,
    },
  };
  // Jobs the real data doesn't cover (position coaches, trainers, scouts) get generated people.
  fillStaff(league, date, "real");
  completeSeasonFromResults(league);
  startNextSeason(league, { agePlayers: false });
  // Money: everyone on a roster gets a contract, and the tag history starts from them.
  if (input.players.some((p) => p.contract)) {
    // Real contracts as they stood, plus each team's published dead money and carried-over room.
    const byKey = new Map(input.players.map((p) => [p.key, p]));
    const sorted = [...input.players].sort((a, b) => a.key.localeCompare(b.key));
    sorted.forEach((p, i) => {
      const player = league.players[i]!;
      const source = byKey.get(p.key)!;
      player.contract = source.contract ?? null;
      const team = league.teams.find((t) => t.id === player.teamId);
      for (const v of source.voidedProration ?? [])
        if (team && v.amount > 0)
          team.cap.deadMoney.push({
            season: v.season,
            playerId: player.id,
            amount: v.amount,
            reason:
              "Void years of a contract that ended last season: the bonus proration left accelerates",
          });
    });
    for (const team of league.teams) {
      const facts = input.teamCaps?.[team.id];
      if (!facts) continue;
      for (const d of facts.deadMoney)
        if (d.amount > 0)
          team.cap.deadMoney.push({
            season: d.season,
            playerId: -1,
            amount: d.amount,
            reason: "Dead money from moves made before the league began (published figure)",
          });
      if (facts.carryover > 0)
        team.cap.carryover.push({ season: league.season, amount: facts.carryover });
    }
    seedSalaryHistory(league);
    // Pending free agents (deals that ended with the last season) still belong to their teams until
    // the League Year: a one-year deal for the season just played stands in for the real one, so
    // they go through the re-signing window and free agency like anyone whose deal runs out.
    for (const p of league.players)
      if (p.teamId !== null && p.contract === null)
        p.contract = endedDeal(league, p, p.teamId, league.season - 1);
  } else {
    generateContracts(league, new Rng(streamSeed(input.seed, "contracts")));
    seedSalaryHistory(league);
  }
  if (input.draftOrder?.length) applyRealDraftOrder(league, input.draftOrder);
  // The 2026 draft class (the real one when the file has it), with scouts assigned (Phase 11).
  if (input.prospects?.length) {
    league.prospects = realClass(league, input.prospects, league.season);
    assignScouts(league);
  } else ensureClassAndScouts(league);
  return league;
}

/**
 * A new game from the real league file: the same starting league, with its
 * own name and seed, so every new real league plays out differently.
 */
export function startRealLeague(base: League, options: { name: string; seed: number }): League {
  if (base.meta.kind !== "real") throw new Error("That file isn't a real-league starting file.");
  // A full copy: the new game must never share data with the file it started from.
  const league = JSON.parse(JSON.stringify(base)) as League;
  league.meta = { ...league.meta, name: options.name, seed: options.seed };
  league.rng = {};
  // This game's own busts and gems in the real class.
  redrawClass(league);
  league.transactions = league.transactions.map((t) =>
    t.type === "league-created"
      ? {
          ...t,
          text: `${options.name} begins from the real league as it stood after the ${base.season - 1} season.`,
        }
      : t,
  );
  return league;
}

/**
 * The real first draft's order: regular picks go to the club that really made them (trades
 * before the draft), and the real compensatory picks are added. A round's picks beyond one per
 * club are its compensatory picks (they come at each round's end).
 */
function applyRealDraftOrder(
  league: League,
  order: { overall: number; round: number; teamId: string }[],
): void {
  const season = league.season;
  const teams = league.teams.length;
  const known = new Set(league.teams.map((t) => t.id));
  const regular = league.draftPicks
    .filter((p) => p.season === season)
    .sort((a, b) => a.round - b.round || (a.overall ?? 0) - (b.overall ?? 0));
  const seenInRound = new Map<number, number>();
  for (const real of order) {
    if (!known.has(real.teamId)) continue;
    const index = seenInRound.get(real.round) ?? 0;
    seenInRound.set(real.round, index + 1);
    if (index < teams) {
      const pick = regular.filter((p) => p.round === real.round)[index];
      if (!pick) continue;
      pick.ownerTeamId = real.teamId;
      pick.overall = real.overall;
    } else
      league.draftPicks.push({
        id: league.nextIds.draftPick++,
        season,
        round: real.round,
        originalTeamId: real.teamId,
        ownerTeamId: real.teamId,
        overall: real.overall,
        // The real list doesn't say which kind; all count as formula picks here.
        compensatory: "formula",
        selection: null,
      });
  }
}

/** A one-year deal at the minimum for a season already played (it has run out by the League Year). */
function endedDeal(league: League, p: Player, teamId: string, season: number): Contract {
  return {
    teamId,
    type: "veteran",
    signedOn: `${season}-03-12`,
    years: [
      {
        season,
        base: minimumSalary(league.rules.cap, season, Math.max(0, p.experience - 1)),
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
    veteranSalaryBenefit: false,
  };
}
