/**
 * The play-by-play game engine. It lives in its own package so it can be
 * tested and calibrated on its own; sim-core feeds it lineups and stores
 * what it returns.
 */
export { simulateGame, GameError } from "./engine";
export { unitsOf, type Units } from "./units";
export {
  measureSeason,
  measurePlayers,
  playerScorecard,
  scorecard,
  CORE_STATS,
  type MeasuredGame,
  type ScorecardLine,
} from "./calibrate";
export { CALIBRATION_TARGETS, ELEMENTS, PEOPLE, REAL, SITUATIONS, TUNING } from "./config";
export { smoothExpectedPoints } from "./epa";
export { RULING_NAMES } from "./review";
export { winProbability } from "./winprob";
export type * from "./types";
export { STAT_KEYS, LONGEST_STATS, DEPTH_SLOTS } from "./types";

/** Bumped when the engine changes how games play out. */
export const GAME_ENGINE_VERSION = "0.5.1";
