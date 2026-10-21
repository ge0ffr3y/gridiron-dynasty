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
import { completeSeasonFromResults, startNextSeason } from "./season/flow";
import { stadiumFor } from "./season/weather";
import { generateCoach } from "./generate/coaches";
import {
  COACH_AGE_FALLBACK,
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
}

export interface RealCoachInput {
  key: string;
  firstName: string;
  lastName: string;
  role: CoachRole;
  teamId: string;
  birthDate: LeagueDate | null;
  experience: number | null;
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
  // Generated attributes (Phase 10 derives real ones); the facts we have override the rest.
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
  // Jobs the real data doesn't cover get generated people.
  const coachRng = new Rng(streamSeed(input.seed, "coaches"));
  for (const team of teams) {
    for (const role of ["HC", "OC", "DC", "STC", "SCOUT", "SCOUT"] as const) {
      if (role !== "SCOUT" && coaches.some((c) => c.teamId === team.id && c.role === role))
        continue;
      coaches.push(
        generateCoach(
          coachRng,
          input.names,
          date,
          coaches.length,
          team.id,
          role,
          COACH_AGE_FALLBACK[role],
        ),
      );
    }
  }

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
    history: [],
    salaryHistory: [],
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
  completeSeasonFromResults(league);
  startNextSeason(league, { agePlayers: false });
  // Money: everyone on a roster gets a contract, and the tag history starts from them.
  generateContracts(league, new Rng(streamSeed(input.seed, "contracts")));
  seedSalaryHistory(league);
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
