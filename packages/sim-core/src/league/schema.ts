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
export const LEAGUE_FORMAT_VERSION = 13;

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

const Dollars = z.number().int();

/** A playing-time incentive: earned by playing at least `games` games that season. */
export const IncentiveSchema = z.object({
  amount: Dollars,
  games: z.number().int().positive(),
  /** "Likely to be earned" (counted on the cap now): he reached it the season before. */
  likely: z.boolean(),
});

/** One League Year of a contract (Phase 7). Whole dollars throughout. */
export const ContractYearSchema = z.object({
  season: z.number().int(),
  /** Paragraph 5 salary. */
  base: Dollars,
  /** Part of the base guaranteed for skill, injury and cap (counts as dead money if he's cut). */
  guaranteed: Dollars,
  /** Part guaranteed for injury only (becomes fully guaranteed on `vestsOn`). */
  injuryGuaranteed: Dollars,
  vestsOn: IsoDate.nullable(),
  rosterBonus: Dollars,
  workoutBonus: Dollars,
  /** Most he can earn in per-game roster bonuses (counted in full, as a 17-game roster spot). */
  perGameBonus: Dollars,
  incentives: z.array(IncentiveSchema),
  /** A year that voids before it's played: it exists only to spread bonus money. */
  void: z.boolean(),
});

/** A bonus spread over up to five League Years (signing bonus, option bonus, a restructure). */
export const BonusSchema = z.object({
  amount: Dollars,
  kind: z.enum(["signing", "option", "restructure"]),
  /** The League Years its cap charge is spread over, equally, earliest first. */
  seasons: z.array(z.number().int()).min(1),
  /** The League Year it's paid in cash. */
  paidIn: z.number().int(),
});

export const CONTRACT_TYPES = [
  "rookie",
  "veteran",
  "extension",
  "franchise",
  "transition",
  "tender",
  "minimum",
  /** A practice-squad deal: weekly pay at the CBA scale (Phase 8). */
  "practice-squad",
] as const;

export const ContractSchema = z.object({
  teamId: z.string(),
  type: z.enum(CONTRACT_TYPES),
  signedOn: IsoDate,
  /** Contract years in order, including any void years at the end. */
  years: z.array(ContractYearSchema).min(1),
  bonuses: z.array(BonusSchema),
  /** First-round rookies: the fifth-year option (the salary is set when it's exercised). */
  fifthYearOption: z
    .object({ season: z.number().int(), exercised: z.boolean().nullable() })
    .nullable(),
  /** A one-year minimum deal for a veteran that counts at a lower minimum (veteran salary benefit). */
  veteranSalaryBenefit: z.boolean(),
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

/**
 * Where a player on a team is listed (Phase 8): the active roster (90 in the offseason, 53 from
 * cutdown day), the practice squad, or a reserve list (injured reserve, physically unable to
 * perform, non-football injury). Reserve players don't count against the roster limit.
 */
export const ROSTER_LISTS = ["active", "practice-squad", "injured-reserve", "pup", "nfi"] as const;
export type RosterList = (typeof ROSTER_LISTS)[number];

/** Phase 9b: how bad an injury is (games missed: 1, 2-3, 4-8, 9 or more). */
export const INJURY_SEVERITIES = ["minor", "moderate", "significant", "severe"] as const;
/** Where it happened. */
export const INJURY_KINDS = ["game", "practice", "camp", "non-football"] as const;
/** The injury report's game statuses. */
export const REPORT_STATUSES = ["Out", "Doubtful", "Questionable"] as const;

export const SCOUTING_BUDGETS = ["low", "normal", "high"] as const;

/** The six combine drills (Phase 11), in their real units. */
export const MeasurablesSchema = z.object({
  /** 40-yard dash, seconds. */
  forty: z.number().nullable(),
  /** Bench press reps at 225 lb. */
  bench: z.number().nullable(),
  /** Vertical jump, inches. */
  vertical: z.number().nullable(),
  /** Broad jump, inches. */
  broadJump: z.number().nullable(),
  /** 3-cone drill, seconds. */
  cone: z.number().nullable(),
  /** 20-yard shuttle, seconds. */
  shuttle: z.number().nullable(),
});

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
  contract: ContractSchema.nullable(),
  /** Season-by-season stats, oldest first. Career totals are the sum. */
  stats: z.array(SeasonStatsSchema),
  /**
   * A current injury that costs games (Phase 9b): he sits out until his team has played this
   * many more games. `status` is how his team lists him for the next game.
   */
  injury: z
    .object({
      description: z.string(),
      part: z.string(),
      severity: z.enum(INJURY_SEVERITIES),
      kind: z.enum(INJURY_KINDS),
      gamesRemaining: z.number().int().positive(),
      /** Games he was expected to miss when it happened. */
      totalGames: z.number().int().positive(),
      since: IsoDate,
      status: z.enum(REPORT_STATUSES),
    })
    .nullable(),
  /** A knock he plays through: listed Questionable for his next game, a step slower in it. */
  knock: z.object({ part: z.string(), since: IsoDate }).nullable(),
  /** Every injury that cost games or was listed, oldest first. */
  injuryHistory: z.array(
    z.object({
      season: z.number().int(),
      date: IsoDate,
      part: z.string(),
      kind: z.enum(INJURY_KINDS),
      /** Games he was expected to miss (0 for a knock). */
      games: z.number().int().nonnegative(),
    }),
  ),
  /** Which list he's on with his team (meaningless without a team). */
  roster: z.enum(ROSTER_LISTS),
  /** Time on a reserve list: team games missed since placed, and whether designated to return. */
  reserve: z
    .object({
      since: IsoDate,
      gamesMissed: z.number().int().nonnegative(),
      designatedToReturn: z.boolean(),
    })
    .nullable(),
  /** Game-day elevations from the practice squad this season. */
  elevations: z.number().int().nonnegative(),
  /** The season after which he retired (placeholder until Phase 9); retired players stay for history. */
  retiredAfter: z.number().int().nullable(),
  /** His overall at the end of each season he was in the league (Phase 9), oldest first. */
  ratingHistory: z.array(
    z.object({
      season: z.number().int(),
      age: z.number().int(),
      teamId: z.string().nullable(),
      position: PositionSchema,
      overall: z.number().int(),
    }),
  ),
  /** This year's preseason: his stats and showcase grade (0-100, 50 = typical), if he played. */
  preseason: z
    .object({
      season: z.number().int(),
      line: StatLineSchema,
      grade: z.number().nullable(),
    })
    .nullable(),
  /** His combine or pro-day results (Phase 11), if he was a prospect in this league. */
  measurables: MeasurablesSchema.nullable(),
});

/**
 * Staff jobs (Phase 10): head coach, coordinators, special teams, four position-group coaches
 * (QB and skill positions, offensive line, front seven, secondary), strength and conditioning,
 * head athletic trainer, scouts.
 */
export const COACH_ROLES = [
  "HC",
  "OC",
  "DC",
  "STC",
  "SKILL",
  "OLC",
  "FRONT",
  "DBC",
  "STR",
  "MED",
  "SCOUT",
] as const;
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
  /**
   * Skills, 0-100 (Phase 10): play calling on each side, development, leadership (also the
   * staff's discipline), game management, scouting, and health (strength coach and trainer).
   */
  ratings: z.object({
    offense: Score,
    defense: Score,
    development: Score,
    leadership: Score,
    gameManagement: Score,
    scouting: Score,
    health: Score,
  }),
  /**
   * How he coaches (Phase 10), relative to the league's average, in the real units of
   * calibration/coaching.json (0 = typical). The offensive coordinator's offense, the defensive
   * coordinator's defense and the head coach's game management reach the field.
   */
  style: z.object({
    passOverExpected: z.number(),
    noHuddle: z.number(),
    deepShare: z.number(),
    personnel11: z.number(),
    blitz: z.number(),
    manCoverage: z.number(),
    stackedBox: z.number(),
    fourthDown: z.number(),
    twoPoint: z.number(),
    /** In-game adaptability, 0-1 (0.5 typical). */
    adaptability: z.number(),
  }),
  offensiveScheme: z.enum(OFFENSIVE_SCHEMES).nullable(),
  defensiveScheme: z.enum(DEFENSIVE_SCHEMES).nullable(),
  /**
   * His career (Phase 10b), oldest first: each season's job and the head coach he worked under
   * (for coaching trees). `teamId` null: out of the league that season.
   */
  career: z.array(
    z.object({
      season: z.number().int(),
      teamId: z.string().nullable(),
      role: CoachRoleSchema,
      underId: z.number().int().nullable(),
      /** Head coaches: the team's record that season. */
      record: z
        .object({ wins: z.number().int(), losses: z.number().int(), ties: z.number().int() })
        .nullable(),
    }),
  ),
  /** The last season of his contract (null for a coach out of work). */
  contractThrough: z.number().int().nullable(),
  /** How the league regards him, 0-100 (results and promotions; Phase 10b). */
  reputation: z.number().min(0).max(100),
  /** An interim head coach, until the offseason. */
  interim: z.boolean(),
  /** The season after which he retired; retired coaches stay for history. */
  retiredAfter: z.number().int().nullable(),
  /** Scouts: the position group he knows best (used from Phase 11). */
  specialty: z.string().nullable(),
});

/** A move in the coaching carousel (Phase 10b), with its reason. */
export const CoachingMoveSchema = z.object({
  season: z.number().int(),
  date: IsoDate,
  kind: z.enum(["fired", "hired", "promoted", "interim", "interviewed", "retired", "left"]),
  coachId: z.number().int(),
  teamId: z.string().nullable(),
  role: CoachRoleSchema,
  text: z.string(),
  reason: z.string(),
});

export const StadiumSchema = z.object({
  roof: z.enum(["dome", "outdoor", "retractable"]),
  /** For a retractable roof: the share of games it's open when the weather allows. */
  openShare: z.number().min(0).max(1).optional(),
  surface: z.enum(["grass", "turf"]),
  elevationMeters: z.number(),
});

/** The weather at kickoff (outside conditions; `indoors` when under a dome or closed roof). */
export const WeatherSchema = z.object({
  indoors: z.boolean(),
  temperatureF: z.number(),
  windMph: z.number(),
  precipitation: z.enum(["none", "rain", "snow"]),
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
  /** Home stadium: roof, playing surface and elevation (no names; Phase 5b). */
  stadium: StadiumSchema,
  /** Cap bookkeeping beyond current contracts (Phase 7). */
  cap: z.object({
    /** Charges left behind by players who are gone (released, traded, voided years). */
    deadMoney: z.array(
      z.object({
        season: z.number().int(),
        playerId: z.number().int(),
        amount: Dollars,
        reason: z.string(),
      }),
    ),
    /** Unused room carried into a League Year (a credit). */
    carryover: z.array(z.object({ season: z.number().int(), amount: Dollars })),
    /** Cash paid to players each League Year (for the minimum cash spending rule). */
    cashPaid: z.array(z.object({ season: z.number().int(), amount: Dollars })),
    /** June 1 designations used, by League Year. */
    juneFirstDesignations: z.array(
      z.object({ season: z.number().int(), playerId: z.number().int() }),
    ),
  }),
  /** Players designated to return from a reserve list, by season (Phase 8; limited per season). */
  reserveReturns: z.array(z.object({ season: z.number().int(), playerId: z.number().int() })),
  /** Practice-squad players elevated for this week's game (set before the week, cleared after). */
  elevated: z.array(z.number().int()),
  /**
   * Scouting (Phase 11): the department's budget, where each scout is assigned (a region of
   * colleges and/or a position group; null = anywhere), and the points of study each prospect
   * (and each young player, by id) has had: more points, a clearer read.
   */
  scouting: z.object({
    budget: z.enum(SCOUTING_BUDGETS),
    assignments: z.array(
      z.object({
        scoutId: z.number().int(),
        region: z.string().nullable(),
        group: z.string().nullable(),
      }),
    ),
    points: z.record(z.string(), z.number()),
  }),
});

/**
 * A draft prospect (Phase 11): a college player in an upcoming draft class. Not on any team and
 * not a free agent; he becomes a player when drafted (or signed after the draft). Ratings and
 * hidden traits are the truth, seen only through scouting.
 */
export const ProspectSchema = z.object({
  id: z.number().int().nonnegative(),
  firstName: z.string(),
  lastName: z.string(),
  position: PositionSchema,
  college: z.string(),
  region: z.string(),
  birthDate: IsoDate,
  heightIn: z.number().int(),
  weightLb: z.number().int(),
  draftYear: z.number().int(),
  ratings: RatingsSchema,
  familiarity: z.partialRecord(PositionSchema, z.number().min(0).max(1)),
  hidden: HiddenTraitsSchema,
  personality: PersonalitySchema,
  /** His true drill results (null: he doesn't run that drill), revealed when he's tested. */
  measurables: MeasurablesSchema,
  /** Invited to the combine (else measured at his pro day). */
  invited: z.boolean(),
  /** Measured yet (the combine or his pro day has happened). */
  tested: z.boolean(),
  /**
   * HIDDEN: the class rank his true talent was drawn around (the real draft slot for the real
   * class). Never shown; the calibration measures how drafts track it.
   */
  anchorRank: z.number().int().positive(),
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
  "preseason",
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
  /** The weather it was played in (null before it's played, or for games from older saves). */
  weather: WeatherSchema.nullable(),
});

/**
 * Where the League Year stands (Phase 8). Each stage is the stretch before the next dated
 * event: "offseason" runs from the championship to the new League Year (March), "free-agency"
 * to the draft, "after-draft" to training camp, "preseason" through the preseason weeks
 * (`week` is the next one), "cutdown" until final cuts, then the regular season and playoffs.
 */
export const CALENDAR_STAGES = [
  "offseason",
  "free-agency",
  "after-draft",
  "preseason",
  "cutdown",
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
  type: z.enum([
    "league-created",
    "signed",
    "released",
    "traded",
    "restructured",
    "extended",
    "pay-cut",
    "option",
    "tagged",
    "expired",
    "cash-shortfall",
    // Phase 8: roster moves.
    "waived",
    "claimed",
    "drafted",
    "retired",
    "reserve",
    "activated",
    "practice-squad",
    "elevated",
    "development",
  ]),
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

/** A development round (Phase 9): the League Year's, camp's, or the season's small weekly changes. */
export const DevelopmentRoundSchema = z.object({
  season: z.number().int(),
  stage: z.enum(["league-year", "camp", "season"]),
  date: IsoDate,
  /** Players who changed notably, biggest change first. */
  changes: z.array(
    z.object({
      playerId: z.number().int(),
      before: z.number().int(),
      after: z.number().int(),
      reason: z.string(),
    }),
  ),
});

export const LeagueSchema = z.object({
  format: z.literal(LEAGUE_FORMAT),
  formatVersion: z.literal(LEAGUE_FORMAT_VERSION),
  meta: z.object({
    name: z.string(),
    seed: z.number().int(),
    kind: z.enum(["fictional", "real"]),
    /** How a real league was built (sources and dates). */
    source: z.string().optional(),
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
  /** This season's preseason games (Phase 8), kept apart so nothing counts them as real games. */
  preseasonGames: z.array(GameSchema),
  /** League settings chosen when it was made (Phase 8). */
  settings: z.object({
    /** Play the three preseason weeks (a showcase for players fighting for a roster spot). */
    preseasonGames: z.boolean(),
    /** Whose eyes the screens use (Phase 11): a team's scouts, or null for the league office's consensus. */
    viewingAs: z.string().nullable(),
  }),
  /** Upcoming draft classes' prospects (Phase 11). */
  prospects: z.array(ProspectSchema),
  /** One summary per completed season, oldest first. */
  history: z.array(SeasonHistorySchema),
  transactions: z.array(TransactionSchema),
  /** The coaching carousel's moves (Phase 10b), oldest first. */
  coachingMoves: z.array(CoachingMoveSchema),
  /** This season's development rounds (Phase 9); last season's go at the new League Year. */
  development: z.array(DevelopmentRoundSchema),
  /**
   * Each League Year's top salaries by tag category, highest first (Phase 7):
   * franchise and transition tags and fifth-year options are set from these.
   */
  salaryHistory: z.array(
    z.object({ season: z.number().int(), category: z.string(), top: z.array(z.number().int()) }),
  ),
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
export type Contract = z.infer<typeof ContractSchema>;
export type ContractYear = z.infer<typeof ContractYearSchema>;
export type Bonus = z.infer<typeof BonusSchema>;
export type TeamCap = z.infer<typeof TeamSchema>["cap"];
export type SeasonStats = z.infer<typeof SeasonStatsSchema>;
export type HiddenTraits = z.infer<typeof HiddenTraitsSchema>;
export type Coach = z.infer<typeof CoachSchema>;
export type CoachRole = z.infer<typeof CoachRoleSchema>;
export type CoachingMove = z.infer<typeof CoachingMoveSchema>;
export type Prospect = z.infer<typeof ProspectSchema>;
export type Measurables = z.infer<typeof MeasurablesSchema>;
export type Team = z.infer<typeof TeamSchema>;
export type Stadium = z.infer<typeof StadiumSchema>;
export type Weather = z.infer<typeof WeatherSchema>;
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
