/**
 * Truth vs. perception (CLAUDE.md, rule 7).
 *
 * Players' true ratings are never shown. Everything a screen shows is what the
 * viewer's staff BELIEVES. In Phase 1 the belief is perfect; Phase 11 adds
 * scouting noise here, and nothing else has to change.
 */
import type { League, Player } from "./league/schema";
import { POSITIONS, type Position, type Ratings } from "./players/positions";
import { overallWithFamiliarity } from "./players/ratings";

/** Who is looking: a team's staff, or the neutral league office (Simulation Mode). */
export type Viewer = { kind: "league" } | { kind: "team"; teamId: string };

export interface PerceivedPlayer {
  ratings: Ratings;
  /** Overall at the player's listed position. */
  overall: number;
  /** Overall at every position the player knows, best first. */
  positionOveralls: { position: Position; overall: number; familiarity: number }[];
  /** How sure the viewer's staff is, 0-1 (always 1 until scouting arrives in Phase 11). */
  confidence: number;
}

export function perceivePlayer(_league: League, player: Player, _viewer: Viewer): PerceivedPlayer {
  const ratings = { ...player.ratings };
  const positionOveralls = POSITIONS.flatMap((position) => {
    const familiarity = player.familiarity[position];
    return familiarity === undefined
      ? []
      : [
          {
            position,
            overall: overallWithFamiliarity(ratings, position, familiarity),
            familiarity,
          },
        ];
  }).sort(
    (a, b) =>
      b.overall - a.overall || POSITIONS.indexOf(a.position) - POSITIONS.indexOf(b.position),
  );
  const overall = overallWithFamiliarity(ratings, player.position, 1);
  return { ratings, overall, positionOveralls, confidence: 1 };
}
