/**
 * Jersey numbers on a team are unique (Phase 8b). Players who join a team
 * keep their number if it's free; otherwise they take the first free number
 * in their position's usual range (generate/config.ts). The longest-serving
 * player keeps a contested number. No randomness: the same roster always
 * gets the same numbers.
 */
import { JERSEY_RANGES } from "../generate/config";
import type { League, Player } from "../league/schema";

function firstFree(p: Player, taken: Set<number>): number {
  for (const [low, high] of JERSEY_RANGES[p.position])
    for (let n = low; n <= high; n++) if (!taken.has(n)) return n;
  for (let n = 0; n <= 99; n++) if (!taken.has(n)) return n;
  return p.jersey;
}

/** Gives every player who shares a number with a teammate a free one. Returns how many changed. */
export function assignJerseys(
  league: League,
  teamIds: string[] = league.teams.map((t) => t.id),
): number {
  const wanted = new Set(teamIds);
  const byTeam = new Map<string, Player[]>();
  for (const p of league.players) {
    if (!p.teamId || !wanted.has(p.teamId)) continue;
    const list = byTeam.get(p.teamId);
    if (list) list.push(p);
    else byTeam.set(p.teamId, [p]);
  }
  let changed = 0;
  for (const roster of byTeam.values()) {
    const taken = new Set<number>();
    // Veterans first, then by id: they keep their numbers.
    for (const p of roster.sort((a, b) => b.experience - a.experience || a.id - b.id)) {
      if (taken.has(p.jersey)) {
        p.jersey = firstFree(p, taken);
        changed += 1;
      }
      taken.add(p.jersey);
    }
  }
  return changed;
}
