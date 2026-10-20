/**
 * The league data model. Plain JSON-friendly objects (no classes) so a league
 * saves and loads as-is. Each schema both types the code and validates files
 * on import.
 */
import { z } from "zod";
import { ATTRIBUTE_KEYS, POSITIONS, type AttributeKey } from "../players/positions";
import { RulesSchema } from "../rules";

export const LEAGUE_FORMAT = "fgm-league";
export const LEAGUE_FORMAT_VERSION = 1;

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
});

export const DraftPickSchema = z.object({
  id: z.number().int().nonnegative(),
  season: z.number().int(),
  round: z.number().int().positive(),
  originalTeamId: z.string(),
  ownerTeamId: z.string(),
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
  teams: z.array(TeamSchema),
  players: z.array(PlayerSchema),
  coaches: z.array(CoachSchema),
  draftPicks: z.array(DraftPickSchema),
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
