/** Synthetic lineups for engine tests (the engine doesn't know about leagues). */
import { ATTRIBUTES, baseProfile, overallAt, type Position, type Ratings } from "@fgm/foundation";
import rules2026 from "../../../rules/2026.json";
import type { DepthChart, GameRules, LineupPlayer } from "./types";

let nextId = 1;

function player(position: Position, level: number): LineupPlayer {
  const base = baseProfile(position);
  const ratings = {} as Ratings;
  for (const a of ATTRIBUTES)
    ratings[a.key] = Math.max(1, Math.min(99, Math.round(base[a.key] + level)));
  return { id: nextId++, position, ratings, overall: overallAt(ratings, position) };
}

/**
 * A full depth chart; `level` raises or lowers every rating (0 = a typical
 * starter). Player ids start at `firstId`, so the same call always builds
 * the same team.
 */
export function makeDepth(level = 0, firstId = 1): DepthChart {
  nextId = firstId;
  const many = (position: Position, n: number) =>
    Array.from({ length: n }, () => player(position, level));
  const [qb1, qb2] = many("QB", 2) as [LineupPlayer, LineupPlayer];
  const rbs = many("RB", 3);
  const fb = player("FB", level);
  const wrs = many("WR", 6);
  const tes = many("TE", 3);
  const [t1, t2, t3] = many("OT", 3) as [LineupPlayer, LineupPlayer, LineupPlayer];
  const [g1, g2, g3] = many("OG", 3) as [LineupPlayer, LineupPlayer, LineupPlayer];
  const center = player("C", level);
  return {
    QB: [qb1, qb2],
    RB: rbs,
    FB: [fb],
    WR: wrs,
    TE: tes,
    LT: [t1, t3],
    RT: [t2, t3],
    LG: [g1, g3],
    RG: [g2, g3],
    C: [center, g3],
    EDGE: many("EDGE", 4),
    DT: many("DT", 4),
    LB: many("LB", 4),
    CB: many("CB", 5),
    S: many("S", 4),
    K: [player("K", level)],
    P: [player("P", level)],
    KR: [wrs[5]!, rbs[2]!],
    PR: [wrs[5]!, wrs[4]!],
  };
}

/** The real rules file's game rules (clock, kicks, overtime, penalties). */
export const TEST_RULES: GameRules = rules2026.game as GameRules;
