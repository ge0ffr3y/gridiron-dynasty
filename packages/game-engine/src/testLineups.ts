/** Synthetic lineups for engine tests (the engine doesn't know about leagues). */
import { ATTRIBUTES, baseProfile, overallAt, type Position, type Ratings } from "@fgm/foundation";
import rules2026 from "../../../rules/2026.json";
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
    fb: player("FB", level),
    wr: many("WR", 5),
    te: many("TE", 3),
    ol: [...many("OT", 2), ...many("OG", 2), player("C", level)],
    dl: [...many("EDGE", 2), ...many("DT", 2)],
    lb: many("LB", 3),
    cb: many("CB", 4),
    s: many("S", 3),
    k: player("K", level),
    p: player("P", level),
    returner: player("WR", level),
  };
}

/** The real rules file's game rules (clock, kicks, overtime, penalties). */
export const TEST_RULES: GameRules = rules2026.game as GameRules;
