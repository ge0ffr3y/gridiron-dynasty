/**
 * What goes into a game and what comes out of it.
 */
import type { Position, Ratings } from "@fgm/foundation";

/** The rules of one game (matches the `game` block of the rules file). */
export interface GameRules {
  quarterMinutes: number;
  timeoutsPerHalf: number;
  twoMinuteWarning: boolean;
  playClockSeconds: number;
  outOfBoundsStopsClockLastSeconds: { firstHalf: number; secondHalf: number };
  extraPointSpot: number;
  twoPointSpot: number;
  kickoff: {
    touchbackSpot: number;
    landingZoneTouchbackSpot: number;
    shortOrOutOfBoundsSpot: number;
  };
  puntTouchbackSpot: number;
  safetyFreeKickFrom: number;
  overtime: {
    regularSeason: OvertimeRules;
    playoffs: OvertimeRules;
  };
  penalties: { types: Record<string, PenaltyRule> };
}

/** How a penalty is enforced (from the rules file). */
export interface PenaltyRule {
  phase: "pre" | "live" | "pass" | "return";
  side: "offense" | "defense";
  yards: number;
  from: "previous" | "spot" | "end";
  automaticFirstDown: boolean;
  lossOfDown: boolean;
}

export interface OvertimeRules {
  periodMinutes: number;
  /** null = keep playing until someone wins. */
  maxPeriods: number | null;
  timeouts: number;
  bothTeamsPossess: boolean;
}

/** A player as the engine sees him: TRUE ratings (the simulation uses the truth). */
export interface LineupPlayer {
  id: number;
  position: Position;
  ratings: Ratings;
  /** Overall at the spot he's playing. */
  overall: number;
  /** How injury-prone he is compared with a typical player (1 = typical). */
  injuryRisk?: number;
}

/** Spots on a depth chart. LT, LG, C, RG, RT are the five offensive line spots; KR and PR return kicks. */
export const DEPTH_SLOTS = [
  "QB",
  "RB",
  "FB",
  "WR",
  "TE",
  "LT",
  "LG",
  "C",
  "RG",
  "RT",
  "EDGE",
  "DT",
  "LB",
  "CB",
  "S",
  "K",
  "P",
  "KR",
  "PR",
] as const;
export type DepthSlot = (typeof DEPTH_SLOTS)[number];

/**
 * A team's depth chart for one game: the players at each spot, first string
 * first. Players already injured before the game are left off. A player may
 * be listed at more than one spot (a backup tackle on both sides, a receiver
 * who also returns kicks).
 */
export type DepthChart = Record<DepthSlot, LineupPlayer[]>;

/**
 * Who is on the field (or first in line) for one snap, by spot, best first.
 * The engine builds this from the depth chart before every snap, skipping
 * tired and injured players. Offensive line order: left
 * tackle, right tackle, left guard, right guard, center. Defensive line:
 * edge, edge, tackle, tackle.
 */
export interface Lineup {
  qb: LineupPlayer;
  rb: LineupPlayer[];
  /** A fullback, if the team carries one (used in 21 and 22 personnel). */
  fb?: LineupPlayer;
  wr: LineupPlayer[];
  te: LineupPlayer[];
  ol: LineupPlayer[];
  dl: LineupPlayer[];
  lb: LineupPlayer[];
  cb: LineupPlayer[];
  s: LineupPlayer[];
  k: LineupPlayer;
  p: LineupPlayer;
  returner: LineupPlayer;
}

export interface TeamInput {
  id: string;
  depth: DepthChart;
  /** How this team's defense likes to play (coaches set this from Phase 10). */
  defenseStyle?: { extraBlitz?: number };
}

export interface GameInput {
  home: TeamInput;
  away: TeamInput;
  neutral: boolean;
  /** Playoff games use playoff overtime and can't end tied. */
  playoff: boolean;
  rules: GameRules;
}

export type Side = "home" | "away";

export type PlayKind =
  | "kickoff"
  | "run"
  | "pass"
  | "sack"
  | "scramble"
  | "punt"
  | "fieldGoal"
  | "extraPoint"
  | "twoPoint"
  | "kneel"
  | "spike"
  | "timeout"
  | "twoMinuteWarning"
  | "endOfPeriod"
  | "penalty";

/**
 * One play. Field position is `yardsToGoal`: how far the offense is from
 * scoring (75 = own 25, 10 = opponent's 10). Optional fields are left out
 * when they don't apply, to keep the play log small.
 */
export interface Play {
  quarter: number;
  /** Seconds left in the period when the ball was snapped. */
  clock: number;
  offense: Side;
  down: number;
  toGo: number;
  yardsToGoal: number;
  kind: PlayKind;
  yards: number;
  depth?: "short" | "medium" | "deep";
  direction?: "left" | "middle" | "right";
  complete?: boolean;
  intercepted?: boolean;
  /** Field goals, extra points, 2-point tries. */
  good?: boolean;
  touchback?: boolean;
  fairCatch?: boolean;
  outOfBounds?: boolean;
  airYards?: number;
  kickDistance?: number;
  returnYards?: number;
  passer?: number;
  rusher?: number;
  receiver?: number;
  tacklers?: number[];
  /** Sacker or interceptor. */
  defender?: number;
  kicker?: number;
  returner?: number;
  fumble?: { by: number; lost: boolean; recoveredBy?: number };
  /** Which team scored a touchdown on the play. */
  touchdown?: Side;
  safety?: boolean;
  turnover?: boolean;
  turnoverOnDowns?: boolean;
  firstDown?: boolean;
  /** Who called a timeout (timeout plays). */
  team?: Side;
  /** Home and away score after the play. */
  score: [number, number];
  /** Why a notable call was made (4th downs, 2-point tries, kneels, timeouts). */
  note?: string;
  // --- Matchup details (Phase 4) ---
  personnel?: string;
  formation?: string;
  coverage?: string;
  rushers?: number;
  playAction?: boolean;
  rpo?: boolean;
  sneak?: boolean;
  route?: string;
  /** The hole a run went through, in words. */
  gap?: string;
  /** Who got pressure on the quarterback. */
  pressure?: number;
  throwAway?: boolean;
  drop?: boolean;
  breakup?: boolean;
  missedTackles?: number[];
  /** A penalty on the play (accepted or declined). */
  penalty?: { type: string; team: Side; player?: number; yards: number; accepted: boolean };
  /** The play was wiped out by an accepted penalty (its stats don't count). */
  noPlay?: boolean;
  /** Players hurt on the play. */
  injured?: number[];
  /** Expected points added by the offense (Phase 4b; scrimmage plays only). */
  epa?: number;
}

export const STAT_KEYS = [
  "gp",
  "passAtt",
  "passCmp",
  "passYds",
  "passTd",
  "passInt",
  "sacked",
  "sackedYds",
  "passLong",
  "rushAtt",
  "rushYds",
  "rushTd",
  "rushLong",
  "targets",
  "rec",
  "recYds",
  "recTd",
  "recLong",
  "fumbles",
  "fumblesLost",
  "tackles",
  "sacks",
  "defInt",
  "intYds",
  "defTd",
  "fumRec",
  "fgm",
  "fga",
  "fgLong",
  "xpm",
  "xpa",
  "punts",
  "puntYds",
  "kr",
  "krYds",
  "krTd",
  "pr",
  "prYds",
  "prTd",
  "twoPt",
  "penalties",
  "penaltyYds",
  // Expanded and advanced stats (Phase 4b).
  "offSnaps",
  "defSnaps",
  "dropbacks",
  "airYds",
  "passEpa",
  "passSucc",
  "rushEpa",
  "rushSucc",
  "yac",
  "drops",
  "pressures",
  "passDef",
  "missedTkl",
] as const;

export type StatKey = (typeof STAT_KEYS)[number];

/** Stats where a season total is the best single value, not the sum. */
export const LONGEST_STATS: StatKey[] = ["passLong", "rushLong", "recLong", "fgLong"];

/** Only non-zero stats are stored. */
export type StatLine = Partial<Record<StatKey, number>>;

export interface TeamGameStats {
  points: number;
  firstDowns: number;
  plays: number;
  totalYards: number;
  passYards: number;
  rushYards: number;
  passAtt: number;
  passCmp: number;
  sacked: number;
  sackedYds: number;
  rushAtt: number;
  turnovers: number;
  thirdDownAtt: number;
  thirdDownConv: number;
  fourthDownAtt: number;
  fourthDownConv: number;
  punts: number;
  drives: number;
  possessionSeconds: number;
  penalties: number;
  penaltyYards: number;
  /** Advanced (Phase 4b): offense's expected points added on runs and dropbacks, how many of those plays, how many gained expected points. */
  epa: number;
  epaPlays: number;
  successPlays: number;
  dropbacks: number;
  /** Dropbacks with the quarterback under pressure. */
  pressured: number;
}

export interface BoxScore {
  /** Points per period (4 quarters, then overtime periods) for home and away. */
  periods: { home: number[]; away: number[] };
  home: TeamGameStats;
  away: TeamGameStats;
  players: { id: number; side: Side; line: StatLine }[];
}

/** A player hurt during a game. */
export interface GameInjury {
  playerId: number;
  side: Side;
  quarter: number;
  /** He came back later in the same game. */
  returned: boolean;
}

export interface GameOutput {
  homeScore: number;
  awayScore: number;
  homeTouchdowns: number;
  awayTouchdowns: number;
  overtime: boolean;
  plays: Play[];
  box: BoxScore;
  injuries: GameInjury[];
}
