/**
 * Game-day lineups: who starts where. Phase 3 simply takes the best players
 * by overall at each position; the real depth chart arrives in Phase 4.
 * Simulation uses TRUE ratings.
 */
import { overallAt, type Position } from "@fgm/foundation";
import type { Lineup, LineupPlayer } from "@fgm/game-engine";
import type { League, Player } from "../league/schema";

/**
 * How many players dress at each spot: enough for every package (three tight
 * ends, five receivers, a fullback; base, nickel and dime defenses). The
 * offensive line is ordered left tackle, right tackle, left guard, right
 * guard, center; the defensive line edge, edge, tackle, tackle.
 */
const SLOTS = {
  QB: 1,
  RB: 2,
  FB: 1,
  WR: 5,
  TE: 3,
  OT: 2,
  OG: 2,
  C: 1,
  EDGE: 2,
  DT: 2,
  LB: 3,
  CB: 4,
  S: 3,
  K: 1,
  P: 1,
} as const;

function asLineupPlayer(p: Player): LineupPlayer {
  return {
    id: p.id,
    position: p.position,
    ratings: p.ratings,
    overall: overallAt(p.ratings, p.position),
  };
}

export function buildLineup(roster: Player[]): Lineup {
  const byPosition = new Map<Position, LineupPlayer[]>();
  for (const p of roster) {
    const list = byPosition.get(p.position) ?? [];
    list.push(asLineupPlayer(p));
    byPosition.set(p.position, list);
  }
  for (const list of byPosition.values()) list.sort((a, b) => b.overall - a.overall || a.id - b.id);
  const take = (position: Position, n: number) => (byPosition.get(position) ?? []).slice(0, n);
  const one = (position: Position) => {
    const p = take(position, 1)[0];
    if (!p) throw new Error(`no ${position} on the roster`);
    return p;
  };
  const starters = new Set<number>();
  const pick = (position: keyof typeof SLOTS) => {
    const players = take(position, SLOTS[position]);
    players.forEach((p) => starters.add(p.id));
    return players;
  };
  const lineup: Lineup = {
    qb: pick("QB")[0] ?? one("QB"),
    rb: pick("RB"),
    ...(take("FB", 1)[0] ? { fb: pick("FB")[0] } : {}),
    wr: pick("WR"),
    te: pick("TE"),
    ol: [...pick("OT"), ...pick("OG"), ...pick("C")],
    dl: [...pick("EDGE"), ...pick("DT")],
    lb: pick("LB"),
    cb: pick("CB"),
    s: pick("S"),
    k: one("K"),
    p: one("P"),
    returner: one("RB"),
  };
  // The returner: the fastest back or receiver who isn't a top starter.
  const candidates = [
    ...(byPosition.get("RB") ?? []).slice(1),
    ...(byPosition.get("WR") ?? []).slice(2),
    ...(byPosition.get("CB") ?? []).slice(2),
  ];
  lineup.returner =
    candidates.sort((a, b) => b.ratings.speed - a.ratings.speed || a.id - b.id)[0] ??
    lineup.rb[0] ??
    lineup.qb;
  return lineup;
}

export function teamLineup(league: League, teamId: string): Lineup {
  return buildLineup(league.players.filter((p) => p.teamId === teamId));
}
