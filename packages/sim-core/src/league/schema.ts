/**
 * The league data model. Plain JSON-friendly objects (no classes) so a league
 * saves and loads as-is. Each schema both types the code and validates files
 * on import.
 */
import { z } from "zod";
import { ATTRIBUTE_KEYS, POSITIONS, type AttributeKey } from "@fgm/foundation";
import { DEPTH_SLOTS, STAT_KEYS, type BoxScore, type StatLine } from "@fgm/game-engine";
import { RulesSchema } from "../rules";

export const LEAGUE_FORMAT = "fgm-league";
export const LEAGUE_FORMAT_VERSION = 5;

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Score = z.number().int().min(0).max(100);
export const PositionSchema = z.enum(POSITIONS);

export const RatingsSchema = z.object(
  Object.fromEntries(ATTRIBUTE_KEYS.map((k) => [k, Score])) as Record<AttributeKey, typeof Score>,
);

export const HiddenTraitsSchema = z.object({
  /** The overall this player could reach at their position with ideal development. */
  potential: Score,
  workEthic: Score,
  consistency: Score,
  injuryProneness: Score,
  durability: Score,
  coachability: Score,
  clutch: Score,
});

export const PersonalitySchema = z.object({
  ego: Score,
  loyalty: Score,
  leadership: Score,
  temperament: Score,
  /** How much each matters when choosing a team; the four add up to 100. */
  priorities: z.object({ money: Score, winning: Score, role: Score, location: Score }),
});

/** Placeholder until real contracts arrive in Phase 7. */
export const ContractStubSchema = z.object({
  teamId: z.string(),
  /** Last season covered by the contract. */
  expiresAfterSeason: z.number().int(),
});

export const DraftInfoSchema = z.object({
  season: z.number().int(),
  round: z.number().int().positive(),
  pick: z.number().int().positive(),
  teamId: z.string(),
});

/** A player's stats: only non-zero numbers are stored. */
export const StatLineSchema = z.partialRecord(z.enum(STAT_KEYS), z.number());

/** One season's stats for one team (a player traded mid-season has two). */
export const SeasonStatsSchema = z.object({
  season: z.number().int(),
  teamId: z.string(),
  line: StatLineSchema,
});

const TeamGameStatsSchema = z.object({
  points: z.number().int(),
  firstDowns: z.number().int(),
  plays: z.number().int(),
  totalYards: z.number().int(),
  passYards: z.number().int(),
  rushYards: z.number().int(),
  passAtt: z.number().int(),
  passCmp: z.number().int(),
  sacked: z.number().int(),
  sackedYds: z.number().int(),
  rushAtt: z.number().int(),
  turnovers: z.number().int(),
  thirdDownAtt: z.number().int(),
  thirdDownConv: z.number().int(),
  fourthDownAtt: z.number().int(),
  fourthDownConv: z.number().int(),
  punts: z.number().int(),
  drives: z.number().int(),
  possessionSeconds: z.number().int(),
  penalties: z.number().int(),
  penaltyYards: z.number().int(),
  epa: z.number(),
  epaPlays: z.number().int(),
  successPlays: z.number().int(),
  dropbacks: z.number().int(),
  pressured: z.number().int(),
});

export const BoxScoreSchema = z.object({
  periods: z.object({ home: z.array(z.number().int()), away: z.array(z.number().int()) }),
  home: TeamGameStatsSchema,
  away: TeamGameStatsSchema,
  players: z.array(
    z.object({ id: z.number().int(), side: z.enum(["home", "away"]), line: StatLineSchema }),
  ),
});

// The engine's box score and the saved one must be the same shape.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const boxScoresMatch: Same<z.infer<typeof BoxScoreSchema>, BoxScore> = true;
const statLinesMatch: Same<z.infer<typeof StatLineSchema>, StatLine> = true;
void boxScoresMatch;
void statLinesMatch;

export const PlayerSchema = z.object({
  id: z.number().int().nonnegative(),
  firstName: z.string(),
  lastName: z.string(),
  position: PositionSchema,
  teamId: z.string().nullable(),
  jersey: z.number().int().min(0).max(99),
  birthDate: IsoDate,
  heightIn: z.number().int(),
  weightLb: z.number().int(),
  /** Credited seasons in the league. */
  experience: z.number().int().nonnegative(),
  college: z.string(),
  drafted: DraftInfoSchema.nullable(),
  /** TRUE ratings. Never shown directly: screens read them through the perception layer. */
  ratings: RatingsSchema,
  /** How well the player knows each position, 0-1. The primary position is always 1. */
  familiarity: z.partialRecord(PositionSchema, z.number().min(0).max(1)),
  hidden: HiddenTraitsSchema,
  personality: PersonalitySchema,
  contract: ContractStubSchema.nullable(),
  /** Season-by-season stats, oldest first. Career totals are the sum. */
  stats: z.array(SeasonStatsSchema),
  /** A current injury: he sits out until his team has played this many more games. */
  injury: z
    .object({
      description: z.string(),
      gamesRemaining: z.number().int().positive(),
      since: IsoDate,
    })
    .nullable(),
});

export const COACH_ROLES = ["HC", "OC", "DC", "STC", "SCOUT"] as const;
export const CoachRoleSchema = z.enum(COACH_ROLES);
export const OFFENSIVE_SCHEMES = [
  "West Coast",
  "Air Raid",
  "Spread/RPO",
  "Power Run",
  "Wide Zone",
  "Vertical",
] as const;
export const DEFENSIVE_SCHEMES = [
  "4-3",
  "3-4",
  "Cover 2",
  "Cover 3",
  "Man Pressure",
  "Multiple",
] as const;

export const CoachSchema = z.object({
  id: z.number().int().nonnegative(),
  firstName: z.string(),
  lastName: z.string(),
  role: CoachRoleSchema,
  teamId: z.string().nullable(),
  birthDate: IsoDate,
  /** Years coaching in the league. */
  experience: z.number().int().nonnegative(),
  /** Placeholder attributes; the full coach model arrives in Phase 10. */
  ratings: z.object({
    offense: Score,
    defense: Score,
    development: Score,
    leadership: Score,
    gameManagement: Score,
    scouting: Score,
  }),
  offensiveScheme: z.enum(OFFENSIVE_SCHEMES).nullable(),
  defensiveScheme: z.enum(DEFENSIVE_SCHEMES).nullable(),
});

export const TeamSchema = z.object({
  id: z.string(),
  city: z.string(),
  nickname: z.string(),
  abbreviation: z.string(),
  conferenceId: z.string(),
  divisionId: z.string(),
  colors: z.object({ primary: z.string(), secondary: z.string() }),
  /** Who makes this team's decisions: the AI, or the person playing. */
  controller: z.enum(["ai", "human"]),
  /**
   * The depth chart: automatic (rebuilt from the roster whenever needed) or
   * a custom order per spot, best first.
   */
  depthChart: z.object({
    auto: z.boolean(),
    slots: z.partialRecord(z.enum(DEPTH_SLOTS), z.array(z.number().int())),
  }),
});

export const DraftPickSchema = z.object({
  id: z.number().int().nonnegative(),
  season: z.number().int(),
  round: z.number().int().positive(),
  originalTeamId: z.string(),
  ownerTeamId: z.string(),
  /** Overall pick number, once the draft order is known (after the previous season). */
  overall: z.number().int().positive().nullable(),
});

export const GAME_ROUNDS = [
  "regular",
  "wildcard",
  "divisional",
  "conference",
  "championship",
] as const;
export type GameRound = (typeof GAME_ROUNDS)[number];
export const PLAYOFF_ROUNDS = ["wildcard", "divisional", "conference", "championship"] as const;
export type PlayoffRound = (typeof PLAYOFF_ROUNDS)[number];

export const GameSchema = z.object({
  id: z.number().int().nonnegative(),
  season: z.number().int(),
  round: z.enum(GAME_ROUNDS),
  /** Regular-season week (1-18); playoff games carry the week after the season they're played in. */
  week: z.number().int().positive(),
  date: IsoDate,
  homeId: z.string(),
  awayId: z.string(),
  /** No home-field advantage (the championship). */
  neutral: z.boolean(),
  /** Scores and touchdowns, null until the game is played. */
  result: z
    .object({
      homeScore: z.number().int().nonnegative(),
      awayScore: z.number().int().nonnegative(),
      homeTouchdowns: z.number().int().nonnegative(),
      awayTouchdowns: z.number().int().nonnegative(),
      overtime: z.boolean(),
    })
    .nullable(),
  /** Team and player stats for the game (null before it's played, or for games from older saves). */
  boxScore: BoxScoreSchema.nullable(),
});

export const CALENDAR_STAGES = [
  "offseason",
  "preseason",
  "regular",
  "wildcard",
  "divisional",
  "conference",
  "championship",
  "complete",
] as const;
export type CalendarStage = (typeof CALENDAR_STAGES)[number];

export const CalendarSchema = z.object({
  stage: z.enum(CALENDAR_STAGES),
  /** The next regular-season week to be played (meaningful in the regular stage). */
  week: z.number().int().positive(),
});

export const PLAYOFF_EXITS = [
  "missed",
  "wildcard",
  "divisional",
  "conference",
  "runner-up",
  "champion",
] as const;

export const SeasonHistorySchema = z.object({
  season: z.number().int(),
  championId: z.string(),
  runnerUpId: z.string(),
  standings: z.array(
    z.object({
      teamId: z.string(),
      wins: z.number().int(),
      losses: z.number().int(),
      ties: z.number().int(),
      pointsFor: z.number().int(),
      pointsAgainst: z.number().int(),
      divisionRank: z.number().int().positive(),
      /** Playoff seed (1-7) or null. */
      seed: z.number().int().positive().nullable(),
      exit: z.enum(PLAYOFF_EXITS),
    }),
  ),
  playoffGames: z.array(
    z.object({
      round: z.enum(PLAYOFF_ROUNDS),
      homeId: z.string(),
      awayId: z.string(),
      homeScore: z.number().int(),
      awayScore: z.number().int(),
      overtime: z.boolean(),
    }),
  ),
  /** First-round order of the next draft (1st pick first). */
  draftOrder: z.array(z.string()),
  /** How ties in the final standings were broken. */
  tiebreakNotes: z.array(z.string()),
});

export const TransactionSchema = z.object({
  id: z.number().int().nonnegative(),
  date: IsoDate,
  type: z.enum(["league-created", "signed", "released", "traded"]),
  teamIds: z.array(z.string()),
  playerIds: z.array(z.number().int()),
  text: z.string(),
  /** Why it happened (CLAUDE.md, rule 8). */
  reason: z.string(),
});

export const DecisionRequestSchema = z.object({
  kind: z.literal("placeholder"),
  prompt: z.string(),
  options: z.array(z.string()).min(1),
});

export const PendingDecisionSchema = z.object({
  id: z.number().int().nonnegative(),
  teamId: z.string(),
  createdOn: IsoDate,
  request: DecisionRequestSchema,
});

const RngStateSchema = z.tuple([z.number(), z.number(), z.number(), z.number()]).readonly();

export const LeagueSchema = z.object({
  format: z.literal(LEAGUE_FORMAT),
  formatVersion: z.literal(LEAGUE_FORMAT_VERSION),
  meta: z.object({
    name: z.string(),
    seed: z.number().int(),
    kind: z.enum(["fictional", "real"]),
  }),
  rules: RulesSchema,
  date: IsoDate,
  season: z.number().int(),
  calendar: CalendarSchema,
  teams: z.array(TeamSchema),
  players: z.array(PlayerSchema),
  coaches: z.array(CoachSchema),
  draftPicks: z.array(DraftPickSchema),
  /** This season's games (regular season and playoffs). */
  games: z.array(GameSchema),
  /** One summary per completed season, oldest first. */
  history: z.array(SeasonHistorySchema),
  transactions: z.array(TransactionSchema),
  pendingDecisions: z.array(PendingDecisionSchema),
  rng: z.partialRecord(z.string(), RngStateSchema),
  nextIds: z.object({
    player: z.number().int(),
    coach: z.number().int(),
    draftPick: z.number().int(),
    transaction: z.number().int(),
    decision: z.number().int(),
  }),
});

export type Player = z.infer<typeof PlayerSchema>;
export type Coach = z.infer<typeof CoachSchema>;
export type CoachRole = z.infer<typeof CoachRoleSchema>;
export type Team = z.infer<typeof TeamSchema>;
export type DraftPick = z.infer<typeof DraftPickSchema>;
export type Transaction = z.infer<typeof TransactionSchema>;
export type DecisionRequest = z.infer<typeof DecisionRequestSchema>;
export type PendingDecision = z.infer<typeof PendingDecisionSchema>;
export type League = z.infer<typeof LeagueSchema>;
export type Game = z.infer<typeof GameSchema>;
export type GameResult = NonNullable<Game["result"]>;
export type Calendar = z.infer<typeof CalendarSchema>;
export type SeasonHistory = z.infer<typeof SeasonHistorySchema>;
export type PlayoffExit = (typeof PLAYOFF_EXITS)[number];
