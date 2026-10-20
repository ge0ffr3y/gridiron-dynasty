/** Synthetic lineups for engine tests (the engine doesn't know about leagues). */
import { ATTRIBUTES, baseProfile, overallAt, type Position, type Ratings } from "@fgm/foundation";
import type { GameRules, Lineup, LineupPlayer } from "./types";

let nextId = 1;

function player(position: Position, level: number): LineupPlayer {
  const base = baseProfile(position);
  const ratings = {} as Ratings;
  for (const a of ATTRIBUTES)
    ratings[a.key] = Math.max(1, Math.min(99, Math.round(base[a.key] + level)));
  return { id: nextId++, position, ratings, overall: overallAt(ratings, position) };
}

/**
 * A full lineup; `level` raises or lowers every rating (0 = a typical starter).
 * Player ids start at `firstId`, so the same call always builds the same lineup.
 */
export function makeLineup(level = 0, firstId = 1): Lineup {
  nextId = firstId;
  const many = (position: Position, n: number) =>
    Array.from({ length: n }, () => player(position, level));
  return {
    qb: player("QB", level),
    rb: many("RB", 2),
    wr: many("WR", 4),
    te: many("TE", 2),
    ol: [...many("OT", 2), ...many("OG", 2), player("C", level)],
    dl: [...many("EDGE", 2), ...many("DT", 2)],
    lb: many("LB", 2),
    cb: many("CB", 3),
    s: many("S", 2),
    k: player("K", level),
    p: player("P", level),
    returner: player("WR", level),
  };
}

export const TEST_RULES: GameRules = {
  quarterMinutes: 15,
  timeoutsPerHalf: 3,
  twoMinuteWarning: true,
  playClockSeconds: 40,
  outOfBoundsStopsClockLastSeconds: { firstHalf: 120, secondHalf: 300 },
  extraPointSpot: 15,
  twoPointSpot: 2,
  kickoff: { touchbackSpot: 35, landingZoneTouchbackSpot: 20, shortOrOutOfBoundsSpot: 40 },
  puntTouchbackSpot: 20,
  safetyFreeKickFrom: 20,
  overtime: {
    regularSeason: { periodMinutes: 10, maxPeriods: 1, timeouts: 2, bothTeamsPossess: true },
    playoffs: { periodMinutes: 15, maxPeriods: null, timeouts: 3, bothTeamsPossess: true },
  },
};
