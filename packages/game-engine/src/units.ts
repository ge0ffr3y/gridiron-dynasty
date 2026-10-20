/**
 * Unit strengths: how good each part of a team is, on the rating scale
 * (a typical starter is 75). Plays are decided by one unit against another.
 */
import type { Lineup, LineupPlayer } from "./types";
import type { AttributeKey } from "@fgm/foundation";

export interface Units {
  passer: number;
  receivers: number;
  passProtection: number;
  runBlocking: number;
  rusher: number;
  passRush: number;
  runDefense: number;
  coverage: number;
  tackling: number;
  kickAccuracy: number;
  kickPower: number;
}

function avg(players: LineupPlayer[], value: (p: LineupPlayer) => number): number {
  return players.length === 0 ? 0 : players.reduce((s, p) => s + value(p), 0) / players.length;
}

function attr(key: AttributeKey) {
  return (p: LineupPlayer) => p.ratings[key];
}

export function unitsOf(lineup: Lineup): Units {
  const receivers = [...lineup.wr.slice(0, 3), ...lineup.te.slice(0, 1)];
  const edges = lineup.dl.filter((p) => p.position === "EDGE");
  const interior = lineup.dl.filter((p) => p.position !== "EDGE");
  const backs = [...lineup.cb, ...lineup.s];
  return {
    passer: lineup.qb.overall,
    receivers: avg(receivers, (p) => p.overall),
    passProtection: avg(lineup.ol, attr("passBlocking")),
    runBlocking:
      0.85 * avg(lineup.ol, attr("runBlocking")) +
      0.15 * avg(lineup.te.slice(0, 1), attr("runBlocking")),
    rusher: lineup.rb[0]?.overall ?? 50,
    passRush: 0.6 * avg(edges, attr("passRush")) + 0.4 * avg(interior, attr("passRush")),
    runDefense:
      0.5 * avg(lineup.dl, attr("blockShedding")) + 0.5 * avg(lineup.lb, attr("tackling")),
    coverage:
      0.65 * avg(lineup.cb, (p) => (p.ratings.manCoverage + p.ratings.zoneCoverage) / 2) +
      0.35 * avg(lineup.s, attr("zoneCoverage")),
    tackling: avg([...lineup.lb, ...backs], attr("tackling")),
    kickAccuracy: lineup.k.ratings.kickAccuracy,
    kickPower: lineup.k.ratings.kickPower,
  };
}
