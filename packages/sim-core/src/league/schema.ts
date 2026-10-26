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
export const LEAGUE_FORMAT_VERSION = 22;

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

/** Tenders and tags a club can hold a player's rights with (Phase 12, CBA Articles 8-10). */
export const RIGHTS_KINDS = [
  "franchise-exclusive",
  "franchise",
  "transition",
  "rfa-first",
  "rfa-second",
  "rfa-original",
  "rfa-rofr",
  "erfa",
] as const;

/** An offer: years, average yearly value, total guaranteed, signing bonus (whole dollars). */
export const OfferSchema = z.object({
  years: z.number().int().positive(),
  apy: z.number().int().nonnegative(),
  guaranteed: z.number().int().nonnegative(),
  signingBonus: z.number().int().nonnegative(),
});

/** An agent (Phase 12): fictional, with a negotiating style. */
export const AGENT_STYLES = ["hardball", "fair", "relationship", "money"] as const;
export const AgentSchema = z.object({
  id: z.number().int().nonnegative(),
  firstName: z.string(),
  lastName: z.string(),
  agency: z.string(),
  style: z.enum(AGENT_STYLES),
});

/** What moves a player's mood (Phase 12b). */
export const MOOD_FACTORS = [
  "winning",
  "role",
  "pay",
  "fit",
  "leaders",
  "loyalty",
  "dispute",
] as const;

/** A contract dispute (Phase 12b): out of camp, at camp but not practicing, or asking to be traded. */
export const DISPUTE_KINDS = ["holdout", "hold-in", "trade-request"] as const;
/** How a dispute ended. */
export const DISPUTE_OUTCOMES = [
  "extended",
  "traded",
  "reported",
  "withdrawn",
  "released",
] as const;

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

/**
 * A player long gone from the league (Phase 13): retired, or a free agent unsigned, for four
 * seasons or more. He leaves the player list (which the sim scans all the time) and keeps this
 * short card for history: draft history, old transactions and his page.
 */
export const FormerPlayerSchema = z.object({
  id: z.number().int().nonnegative(),
  firstName: z.string(),
  lastName: z.string(),
  position: PositionSchema,
  college: z.string(),
  birthDate: IsoDate,
  drafted: DraftInfoSchema.nullable(),
  experience: z.number().int().nonnegative(),
  retiredAfter: z.number().int().nullable(),
  /** First and last seasons in the league, and his age in the last. */
  firstSeason: z.number().int(),
  lastSeason: z.number().int(),
  lastAge: z.number().int(),
  /** Teams he played for, in order. */
  teams: z.array(z.string()),
  /** Seasons he was a regular starter (for draft grades). */
  seasonsStarted: z.number().int().nonnegative(),
  /** His best season's overall as the league office read it. */
  peak: z.number().int(),
  /** Career totals (regular season). Imported legends carry only what's known. */
  career: StatLineSchema,
  /** The number he last wore (Phase 15; for retired numbers), if known. */
  number: z.number().int().min(0).max(99).nullable(),
  /** A real player from before the league began, imported with the real history (Phase 15). */
  legend: z.boolean(),
  /** Championships his teams won while he played for them (Phase 15). */
  titles: z.number().int().nonnegative(),
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
  /**
   * A team's rights to him while his tender or tag is unsigned (Phase 12): which tender, for
   * which League Year. Offer sheets from other clubs are possible except for exclusive ones.
   */
  rights: z
    .object({
      kind: z.enum(RIGHTS_KINDS),
      teamId: z.string(),
      season: z.number().int(),
    })
    .nullable(),
  /**
   * How he feels about where he is (Phase 12b): 0-100 (50 = content), updated weekly, with
   * what moved it (points each). Null while he has no team.
   */
  mood: z
    .object({
      score: z.number().min(0).max(100),
      factors: z.array(z.object({ key: z.enum(MOOD_FACTORS), points: z.number() })),
    })
    .nullable(),
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

/** Front-office philosophies (Phase 13): the archetype a GM's knobs sit nearest. */
export const GM_ARCHETYPES = [
  "analytics",
  "win-now",
  "draft-and-develop",
  "cap-aggressive",
  "trade-happy",
  "conservative",
] as const;
/** A team's read of where it stands (Phase 13). */
export const TEAM_STANCES = ["contend", "retool", "rebuild"] as const;
export const EXECUTIVE_ROLES = ["GM", "owner"] as const;

/**
 * A general manager's knobs (Phase 13), each -1..1 with 0 typical: how much he discounts the
 * future (1 = win now), how much he trusts models over scouts and veterans, how freely he pushes
 * money into later years, how keen he is to trade, how loyal to his own players, how much risk
 * he takes; and his skill at judging players, 0-100.
 */
export const GmStyleSchema = z.object({
  futureDiscount: z.number().min(-1).max(1),
  analytics: z.number().min(-1).max(1),
  capAggression: z.number().min(-1).max(1),
  tradeAppetite: z.number().min(-1).max(1),
  loyalty: z.number().min(-1).max(1),
  risk: z.number().min(-1).max(1),
  skill: Score,
});

/** An owner's character (Phase 13), each -1..1 with 0 typical; meddling 0..1. */
export const OwnerStyleSchema = z.object({
  patience: z.number().min(-1).max(1),
  /** Willingness to spend cash (and to carry dead money). */
  budget: z.number().min(-1).max(1),
  /** How often he overrules his GM and coaches. */
  meddling: z.number().min(0).max(1),
  /** How high he sets the bar. */
  ambition: z.number().min(-1).max(1),
});

/** A general manager or an owner (Phase 13). */
export const ExecutiveSchema = z.object({
  id: z.number().int().nonnegative(),
  firstName: z.string(),
  lastName: z.string(),
  role: z.enum(EXECUTIVE_ROLES),
  teamId: z.string().nullable(),
  birthDate: IsoDate,
  gm: GmStyleSchema.nullable(),
  owner: OwnerStyleSchema.nullable(),
  /** The season he took this job (or first ran a team). */
  hiredSeason: z.number().int(),
  /** The last season of a GM's contract (owners: null). */
  contractThrough: z.number().int().nullable(),
  /** How the league regards him, 0-100. */
  reputation: z.number().min(0).max(100),
  /** A line per season: the team he ran and its record. */
  career: z.array(
    z.object({
      season: z.number().int(),
      teamId: z.string().nullable(),
      role: z.enum(EXECUTIVE_ROLES),
      record: z
        .object({ wins: z.number().int(), losses: z.number().int(), ties: z.number().int() })
        .nullable(),
      playoffs: z.boolean(),
    }),
  ),
  retiredAfter: z.number().int().nullable(),
  /** The person playing GM Mode (Phase 14): his decisions come from the inbox, not knobs. */
  person: z.boolean(),
});

/** A front-office move (Phase 13): hired, fired, retired, with its reason. */
export const ExecutiveMoveSchema = z.object({
  season: z.number().int(),
  date: IsoDate,
  kind: z.enum(["fired", "hired", "retired", "left"]),
  executiveId: z.number().int(),
  teamId: z.string().nullable(),
  role: z.enum(EXECUTIVE_ROLES),
  text: z.string(),
  reason: z.string(),
});

/** One side of a trade proposal: players and picks a team sends. */
export const TradePackageSchema = z.object({
  players: z.array(z.number().int()),
  picks: z.array(z.number().int()),
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
    /**
     * A board set by hand (Phase 11b): prospect ids, best first. Null = the scouts' own board.
     * The team drafts from it on draft day (unranked prospects follow, by the scouts' board).
     */
    board: z.array(z.number().int()).nullable(),
  }),
  /**
   * The GM's read of where the team stands (Phase 13): contend, retool or rebuild, with the
   * reasons, roster strength now and in two years, and projected cap room for three seasons.
   */
  plan: z
    .object({
      stance: z.enum(TEAM_STANCES),
      season: z.number().int(),
      date: IsoDate,
      strength: z.number(),
      future: z.number(),
      capRoom: z.array(z.number()),
      reasons: z.array(z.string()),
    })
    .nullable(),
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
  /**
   * Compensatory picks (Phase 11b, CBA Article 6 and Appendix V): for a net loss of free agents
   * ("formula"), an equal loss by value ("equal-loss"), or filling the draft to one per club
   * ("supplemental"). Null for a regular pick.
   */
  compensatory: z.enum(["formula", "equal-loss", "supplemental"]).nullable(),
  /** The player taken with it, once used on draft day. */
  selection: z.number().int().nullable(),
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
  "draft",
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

// ---------------------------------------------------------------------------
// League history (Phase 15)

export const AWARD_KINDS = [
  "mvp",
  "opoy",
  "dpoy",
  "oroy",
  "droy",
  "comeback",
  "coach",
  "all-pro-1",
  "all-pro-2",
  "pro-bowl",
] as const;

/** One award line: a winner (place 1) or a runner-up in the vote; All-Pro and All-Star Game spots. */
export const AwardSchema = z.object({
  season: z.number().int(),
  award: z.enum(AWARD_KINDS),
  place: z.number().int().positive(),
  /** A player (current, or a history card) or a coach; null for people the league never had. */
  playerId: z.number().int().nullable(),
  coachId: z.number().int().nullable(),
  name: z.string(),
  position: z.string(),
  teamId: z.string().nullable(),
  /** Share of the vote, when known (0-1). */
  share: z.number().nullable(),
  reason: z.string(),
  /** Imported from the real league's past. */
  real: z.boolean(),
});

/** The stats the record book keeps. */
export const RECORD_STATS = [
  "passYds",
  "passTd",
  "rushYds",
  "rushTd",
  "rec",
  "recYds",
  "recTd",
  "sacks",
  "defInt",
  "fgm",
] as const;
export const RECORD_LEVELS = ["game", "season", "career"] as const;

export const RecordEntrySchema = z.object({
  value: z.number(),
  playerId: z.number().int().nullable(),
  name: z.string(),
  teamId: z.string().nullable(),
  /** The season (game and season records) or last season (career). */
  season: z.number().int().nullable(),
  /** When it was set, if in the league (game records: the game's date). */
  date: IsoDate.nullable(),
  real: z.boolean(),
});

/** One record list: league-wide or a franchise's, at one level, for one stat. */
export const RecordListSchema = z.object({
  /** "league" or a team id. */
  scope: z.string(),
  level: z.enum(RECORD_LEVELS),
  stat: z.enum(RECORD_STATS),
  /** Best first. */
  top: z.array(RecordEntrySchema),
  /** Times the record changed hands in the league, newest last (kept short). */
  broken: z.array(
    z.object({
      date: IsoDate,
      season: z.number().int(),
      value: z.number(),
      name: z.string(),
      playerId: z.number().int().nullable(),
      previous: z.object({
        value: z.number(),
        name: z.string(),
        season: z.number().int().nullable(),
      }),
    }),
  ),
});

export const HallOfFamerSchema = z.object({
  kind: z.enum(["player", "coach", "contributor"]),
  playerId: z.number().int().nullable(),
  coachId: z.number().int().nullable(),
  executiveId: z.number().int().nullable(),
  name: z.string(),
  position: z.string(),
  teams: z.array(z.string()),
  /** The class he went in with. */
  inducted: z.number().int(),
  /** Years he waited after first being eligible (0 = first ballot), if known. */
  waited: z.number().int().nullable(),
  reason: z.string(),
  real: z.boolean(),
});

export const RetiredNumberSchema = z.object({
  teamId: z.string(),
  number: z.number().int().min(0).max(99),
  name: z.string(),
  playerId: z.number().int().nullable(),
  /** The season it was retired, if known. */
  season: z.number().int().nullable(),
  real: z.boolean(),
});

/** A season from before the league began (the real league's past), compact. */
export const AnnalSchema = z.object({
  season: z.number().int(),
  championId: z.string().nullable(),
  runnerUpId: z.string().nullable(),
  /** The championship game's score (winner first), if known. */
  final: z.tuple([z.number().int(), z.number().int()]).nullable(),
  /** Each franchise that played (from 1970 on), under its city then. */
  teams: z.array(
    z.object({
      teamId: z.string(),
      city: z.string(),
      wins: z.number().int(),
      losses: z.number().int(),
      ties: z.number().int(),
      pointsFor: z.number().int(),
      pointsAgainst: z.number().int(),
      playoffs: z.boolean(),
    }),
  ),
  /** Head coaches that season, if known (team id -> name). */
  coaches: z.record(z.string(), z.string()),
});

export const NEWS_KINDS = [
  "trade",
  "signing",
  "injury",
  "record",
  "milestone",
  "race",
  "streak",
  "hot-seat",
  "coaching",
  "front-office",
  "award",
  "hall-of-fame",
  "owner",
  "draft",
] as const;

export const NewsItemSchema = z.object({
  id: z.number().int(),
  date: IsoDate,
  season: z.number().int(),
  week: z.number().int().nullable(),
  kind: z.enum(NEWS_KINDS),
  headline: z.string(),
  text: z.string(),
  teamIds: z.array(z.string()),
  playerIds: z.array(z.number().int()),
  link: z.string().nullable(),
});

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
  /**
   * Every regular-season game's score (Phase 18), kept compact so past seasons can still be read:
   * week, home team, away team, home score, away score, 1 if it went to overtime.
   */
  results: z.array(
    z.tuple([
      z.number().int(),
      z.string(),
      z.string(),
      z.number().int(),
      z.number().int(),
      z.number().int(),
    ]),
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
    // Phase 11b: compensatory picks awarded.
    "compensatory",
    // Phase 12b: holdouts, hold-ins and trade requests, and how they ended.
    "dispute",
  ]),
  teamIds: z.array(z.string()),
  playerIds: z.array(z.number().int()),
  text: z.string(),
  /** Why it happened (CLAUDE.md, rule 8). */
  reason: z.string(),
});

/**
 * The areas of a GM's job (Phase 14). In GM Mode each is yours or your staff's; AI teams' staffs
 * run them all.
 */
export const DELEGATION_AREAS = [
  "draft",
  "re-signing",
  "free-agency",
  "trades",
  "extensions",
  "disputes",
  "coaching",
  "cutdown",
  "depth-chart",
  "reserve-lists",
  "waivers",
  "elevations",
  "cap",
] as const;

/** Kinds of decisions that reach a person (Phase 13-14). */
export const DECISION_KINDS = [
  "placeholder",
  "trade-offer",
  "re-sign",
  "draft-pick",
  "cutdown",
  "dispute",
  "extension",
  "coach-vacancy",
  "interview",
  "owner",
] as const;

export const DecisionRequestSchema = z.object({
  kind: z.enum(DECISION_KINDS),
  prompt: z.string(),
  options: z.array(z.string()).min(1),
  /** "trade-offer" (Phase 13): the offer it answers. */
  offerId: z.number().int().optional(),
  /** The player or coaching job it's about (Phase 14). */
  playerId: z.number().int().optional(),
  role: z.string().optional(),
  /** The area of the job it belongs to (delegation), and where to act (a screen's path). */
  area: z.enum(DELEGATION_AREAS).optional(),
  link: z.string().optional(),
});

export const PendingDecisionSchema = z.object({
  id: z.number().int().nonnegative(),
  teamId: z.string(),
  createdOn: IsoDate,
  request: DecisionRequestSchema,
  /** If not answered by this date, the team's staff decide (Phase 14). Null: no deadline. */
  deadline: IsoDate.nullable().optional(),
});

/** A GM Mode career (Phase 14): the person's team, delegation, and what's happened. */
export const CareerSchema = z.object({
  /** The team the person runs now (null between jobs). */
  teamId: z.string().nullable(),
  /** The person's executive record (a GM in `league.executives`). */
  executiveId: z.number().int(),
  startedSeason: z.number().int(),
  status: z.enum(["active", "fired", "retired"]),
  delegation: z.record(z.enum(DELEGATION_AREAS), z.enum(["you", "staff"])),
  /** Decisions made, by the person or by the staff at a deadline, newest last (kept short). */
  log: z.array(
    z.object({
      date: IsoDate,
      kind: z.enum(DECISION_KINDS),
      /** Who: you, your staff at a deadline, or the owner speaking (Phase 14b). */
      by: z.enum(["you", "staff", "owner"]),
      text: z.string(),
    }),
  ),
  /** Tips already shown (onboarding). */
  tipsSeen: z.array(z.string()),
  /** Job offers after a firing (Phase 14b). */
  offers: z.array(z.object({ teamId: z.string(), season: z.number().int(), reason: z.string() })),
  /** The owner's view of your moves (log-odds on the firing odds; + is good), fading each season. */
  standing: z.number().default(0),
  /** The last transaction the owner has looked at (his reactions, Phase 14b). */
  seenTransaction: z.number().int().default(0),
  /** The team that fired you last (it won't offer you a job). */
  firedFrom: z.string().nullable().default(null),
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
  /** Agents (Phase 12); each player's agent follows from a hash of his id. */
  agents: z.array(AgentSchema),
  /** Contract talks this League Year (Phase 12): rounds so far, the last offer and counter, why. */
  negotiations: z.array(
    z.object({
      playerId: z.number().int(),
      teamId: z.string(),
      season: z.number().int(),
      kind: z.enum(["re-sign", "free-agent", "extension"]),
      rounds: z.number().int().nonnegative(),
      status: z.enum(["open", "agreed", "ended"]),
      offer: OfferSchema.nullable(),
      counter: OfferSchema.nullable(),
      reason: z.string(),
      date: IsoDate,
    }),
  ),
  /**
   * Free agency under way (Phase 12): the day, open offers, and offer sheets waiting for the
   * prior club to match. Null outside free agency.
   */
  freeAgency: z
    .object({
      season: z.number().int(),
      day: z.number().int().nonnegative(),
      offers: z.array(
        z.object({
          playerId: z.number().int(),
          teamId: z.string(),
          offer: OfferSchema,
          date: IsoDate,
          reason: z.string(),
        }),
      ),
      offerSheets: z.array(
        z.object({
          playerId: z.number().int(),
          teamId: z.string(),
          priorTeamId: z.string(),
          offer: OfferSchema,
          date: IsoDate,
          matchBy: IsoDate,
        }),
      ),
    })
    .nullable(),
  /**
   * Unrestricted free agents who signed with a new club (Phase 11b): the compensatory-pick
   * formula (CBA Appendix V) weighs them a year later. Kept for two League Years.
   */
  freeAgentMoves: z.array(
    z.object({
      season: z.number().int(),
      date: IsoDate,
      playerId: z.number().int(),
      fromTeamId: z.string(),
      toTeamId: z.string(),
      position: PositionSchema,
      /** Average yearly compensation: total value over the maximum possible term. */
      averagePerYear: z.number().int().nonnegative(),
      years: z.number().int().positive(),
      /** Accrued seasons when he signed (10+ non-quarterbacks can't bring a pick before round 5). */
      accruedSeasons: z.number().int().nonnegative(),
    }),
  ),
  /**
   * Contract disputes (Phase 12b), oldest first: holdouts, hold-ins and trade requests, open
   * while `end` is null. Kept for three seasons.
   */
  disputes: z.array(
    z.object({
      playerId: z.number().int(),
      teamId: z.string(),
      season: z.number().int(),
      kind: z.enum(DISPUTE_KINDS),
      start: IsoDate,
      reason: z.string(),
      /** Camp fines he's run up (CBA Article 42), whole dollars; teams often waive them. */
      fines: z.number().int().nonnegative(),
      end: IsoDate.nullable(),
      outcome: z.enum(DISPUTE_OUTCOMES).nullable(),
      /** How the team answered, or how it ended, and why. */
      response: z.string(),
    }),
  ),
  /** Players long gone (Phase 13): short history cards, out of the player list. */
  formerPlayers: z.array(FormerPlayerSchema),
  /** General managers and owners (Phase 13), past and present. */
  executives: z.array(ExecutiveSchema),
  /** Front-office moves (Phase 13), oldest first. */
  executiveMoves: z.array(ExecutiveMoveSchema),
  /**
   * Trades and how each side valued them (Phase 13), kept for three seasons: the trade AI's
   * memory, so a run of small one-way deals with the same partner gets refused.
   */
  tradeHistory: z.array(
    z.object({
      season: z.number().int(),
      date: IsoDate,
      teams: z.tuple([z.string(), z.string()]),
      /** Each side's value of what it gave and got, in its own eyes (draft career value). */
      gave: z.tuple([z.number(), z.number()]),
      got: z.tuple([z.number(), z.number()]),
      /** What each side sent, as a neutral judge (true ratings, no biases) values it. */
      neutral: z.tuple([z.number(), z.number()]),
      /** Who started it: an AI team, the league office, or an AI offer accepted by a person. */
      source: z.enum(["ai", "office", "offer"]),
    }),
  ),
  /** Trade offers waiting for an answer from a person-run team (Phase 13). */
  tradeOffers: z.array(
    z.object({
      id: z.number().int().nonnegative(),
      date: IsoDate,
      expires: IsoDate,
      fromTeamId: z.string(),
      toTeamId: z.string(),
      /** What the offering team sends, and what it wants back. */
      give: TradePackageSchema,
      get: TradePackageSchema,
      reason: z.string(),
      status: z.enum(["open", "accepted", "declined", "expired"]),
    }),
  ),
  /** One summary per completed season, oldest first. */
  history: z.array(SeasonHistorySchema),
  /** Seasons from before the league began (the real league's past, Phase 15), oldest first. */
  annals: z.array(AnnalSchema),
  /** Awards, every season (and the real past's winners), oldest first. */
  awards: z.array(AwardSchema),
  /** The record book (Phase 15). */
  records: z.array(RecordListSchema),
  hallOfFame: z.array(HallOfFamerSchema),
  retiredNumbers: z.array(RetiredNumberSchema),
  /** The newsfeed (Phase 15), this season's and last's, oldest first. */
  news: z.array(NewsItemSchema),
  /** Where the newsfeed has read up to in the league's logs. */
  newsCursor: z.object({
    transaction: z.number().int(),
    coachingMove: z.number().int(),
    executiveMove: z.number().int(),
  }),
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
  /** GM Mode (Phase 14): the person's career, or null in Simulation Mode. */
  career: CareerSchema.nullable(),
  /**
   * The real league's starting file keeps the season it began after (Phase 16): its games let each
   * new game run its own coaching carousel (Black Monday, interviews, hires) for that season, then
   * drops this. Null everywhere else.
   */
  priorSeason: z.object({ season: z.number().int(), games: z.array(GameSchema) }).nullable(),
  /**
   * The seasons whose drafts this league held (Phase 18), kept when older transactions are pruned
   * so the draft history still knows which drafts were real events here.
   */
  draftsHeld: z.array(z.number().int()),
  rng: z.partialRecord(z.string(), RngStateSchema),
  nextIds: z.object({
    player: z.number().int(),
    coach: z.number().int(),
    draftPick: z.number().int(),
    transaction: z.number().int(),
    decision: z.number().int(),
    executive: z.number().int(),
    tradeOffer: z.number().int(),
    news: z.number().int(),
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
export type Offer = z.infer<typeof OfferSchema>;
export type Agent = z.infer<typeof AgentSchema>;
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
export type Executive = z.infer<typeof ExecutiveSchema>;
export type ExecutiveMove = z.infer<typeof ExecutiveMoveSchema>;
export type GmStyle = z.infer<typeof GmStyleSchema>;
export type OwnerStyle = z.infer<typeof OwnerStyleSchema>;
export type TradePackage = z.infer<typeof TradePackageSchema>;
export type TeamPlan = NonNullable<Team["plan"]>;
export type FormerPlayer = z.infer<typeof FormerPlayerSchema>;
export type Award = z.infer<typeof AwardSchema>;
export type AwardKind = (typeof AWARD_KINDS)[number];
export type RecordStat = (typeof RECORD_STATS)[number];
export type RecordLevel = (typeof RECORD_LEVELS)[number];
export type RecordList = z.infer<typeof RecordListSchema>;
export type RecordEntry = z.infer<typeof RecordEntrySchema>;
export type HallOfFamer = z.infer<typeof HallOfFamerSchema>;
export type RetiredNumber = z.infer<typeof RetiredNumberSchema>;
export type Annal = z.infer<typeof AnnalSchema>;
export type NewsItem = z.infer<typeof NewsItemSchema>;
export type Career = z.infer<typeof CareerSchema>;
export type DelegationArea = (typeof DELEGATION_AREAS)[number];
