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
}

/** Who plays where for one team. */
export interface Lineup {
  qb: LineupPlayer;
  rb: LineupPlayer[];
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
  lineup: Lineup;
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
  | "endOfPeriod";

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
}

export interface BoxScore {
  /** Points per period (4 quarters, then overtime periods) for home and away. */
  periods: { home: number[]; away: number[] };
  home: TeamGameStats;
  away: TeamGameStats;
  players: { id: number; side: Side; line: StatLine }[];
}

export interface GameOutput {
  homeScore: number;
  awayScore: number;
  homeTouchdowns: number;
  awayTouchdowns: number;
  overtime: boolean;
  plays: Play[];
  box: BoxScore;
}
