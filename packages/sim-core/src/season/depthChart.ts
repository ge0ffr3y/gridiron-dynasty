/**
 * Depth charts: who plays where, in what order.
 *
 * A team's chart is either automatic (rebuilt from the roster whenever it's
 * needed: best overall at each spot, counting players who know a second
 * position) or set by the person running the team. A custom chart keeps the
 * order the person chose; players who left drop off and new arrivals are
 * added at the bottom. Injured players stay on the chart but sit out games.
 *
 * Simulation uses TRUE ratings; the depth chart screen shows perceived ones.
 */
import { overallWithFamiliarity, type Position } from "@fgm/foundation";
import { DEPTH_SLOTS, type DepthChart, type DepthSlot, type LineupPlayer } from "@fgm/game-engine";
import type { League, Player, Team } from "../league/schema";
import { DEPTH_CHART, INJURY_RISK } from "./config";

export type DepthSlots = Record<DepthSlot, number[]>;

/** The position each spot plays (kick and punt returners are chosen by speed instead). */
export const SLOT_POSITION: Record<Exclude<DepthSlot, "KR" | "PR">, Position> = {
  QB: "QB",
  RB: "RB",
  FB: "FB",
  WR: "WR",
  TE: "TE",
  LT: "OT",
  LG: "OG",
  C: "C",
  RG: "OG",
  RT: "OT",
  EDGE: "EDGE",
  DT: "DT",
  LB: "LB",
  CB: "CB",
  S: "S",
  K: "K",
  P: "P",
};

const RETURNER_POSITIONS: Position[] = ["RB", "WR", "CB"];

/** How well a player plays a spot (null if he doesn't play that position at all). */
export function slotOverall(player: Player, slot: DepthSlot): number | null {
  if (slot === "KR" || slot === "PR") {
    return RETURNER_POSITIONS.includes(player.position) ? player.ratings.speed : null;
  }
  const position = SLOT_POSITION[slot];
  const familiarity = player.position === position ? 1 : player.familiarity[position];
  if (familiarity === undefined) return null;
  return overallWithFamiliarity(player.ratings, position, familiarity);
}

function ranked(roster: Player[], slot: DepthSlot): Player[] {
  return roster
    .map((p) => ({ p, score: slotOverall(p, slot) }))
    .filter((x): x is { p: Player; score: number } => x.score !== null)
    .sort((a, b) => b.score - a.score || a.p.id - b.p.id)
    .map((x) => x.p);
}

/**
 * The automatic chart. Starters are picked spot by spot (most important
 * first) so nobody starts at two spots on the same side of the ball; then
 * each spot lists its best remaining backups.
 */
export function autoDepthChart(roster: Player[]): DepthSlots {
  const chart = {} as DepthSlots;
  const rankings = new Map(DEPTH_SLOTS.map((slot) => [slot, ranked(roster, slot)]));
  // Kickers and punters do their own job: a punter who out-kicks a weak kicker would
  // otherwise take the kicking job and leave nobody to punt.
  for (const slot of ["K", "P"] as const) {
    const own = rankings.get(slot)!.filter((p) => p.position === slot);
    if (own.length > 0)
      rankings.set(slot, [...own, ...rankings.get(slot)!.filter((p) => p.position !== slot)]);
  }
  const starting = new Set<number>();
  const starters = new Map<DepthSlot, number[]>();
  for (const slot of DEPTH_CHART.fillOrder) {
    const picks = rankings
      .get(slot)!
      .filter((p) => !starting.has(p.id))
      .slice(0, DEPTH_CHART.starters[slot]);
    for (const p of picks) starting.add(p.id);
    starters.set(
      slot,
      picks.map((p) => p.id),
    );
  }
  // Returners: the fastest backs, receivers and corners who aren't top starters there.
  const returnStarters = new Set(
    (["RB", "WR", "CB"] as DepthSlot[]).flatMap((slot) =>
      (starters.get(slot) ?? []).slice(0, DEPTH_CHART.returnerSkipsStarters),
    ),
  );
  for (const slot of DEPTH_SLOTS) {
    const first = starters.get(slot) ?? [];
    const returner = slot === "KR" || slot === "PR";
    const backups = rankings
      .get(slot)!
      .filter((p) => !first.includes(p.id))
      .filter((p) => (returner ? !returnStarters.has(p.id) : !starting.has(p.id)))
      .map((p) => p.id);
    chart[slot] = [...first, ...backups].slice(0, DEPTH_CHART.length[slot]);
  }
  return chart;
}

/** A team's chart as it stands: automatic, or the custom order cleaned up for roster changes. */
export function resolveDepthChart(team: Team, roster: Player[]): DepthSlots {
  const auto = autoDepthChart(roster);
  if (team.depthChart.auto) return auto;
  const onTeam = new Map(roster.map((p) => [p.id, p]));
  const chart = {} as DepthSlots;
  for (const slot of DEPTH_SLOTS) {
    const kept = (team.depthChart.slots[slot] ?? []).filter((id) => {
      const p = onTeam.get(id);
      return p !== undefined && slotOverall(p, slot) !== null;
    });
    const added = auto[slot].filter((id) => !kept.includes(id));
    chart[slot] = [...kept, ...added];
  }
  return chart;
}

export function teamRoster(league: League, teamId: string): Player[] {
  return league.players.filter((p) => p.teamId === teamId);
}

/** How injury-prone a player is compared with a typical one (hidden traits). */
export function injuryRisk(p: Player): number {
  const R = INJURY_RISK;
  const risk =
    1 +
    (p.hidden.injuryProneness - R.typical) * R.pronenessEffect -
    (p.hidden.durability - R.typical) * R.durabilityEffect;
  return Math.max(R.min, Math.min(R.max, risk));
}

function asLineupPlayer(p: Player, slot: DepthSlot): LineupPlayer {
  const position = slot === "KR" || slot === "PR" ? p.position : SLOT_POSITION[slot];
  const familiarity = p.position === position ? 1 : (p.familiarity[position] ?? 0);
  return {
    id: p.id,
    position: p.position,
    ratings: p.ratings,
    overall: overallWithFamiliarity(p.ratings, position, familiarity),
    injuryRisk: injuryRisk(p),
  };
}

/** The depth chart a team takes into a game: injured players sit out. */
export function gameDepthChart(league: League, teamId: string): DepthChart {
  const team = league.teams.find((t) => t.id === teamId);
  if (!team) throw new Error(`no team ${teamId}`);
  const roster = teamRoster(league, teamId);
  const byId = new Map(roster.map((p) => [p.id, p]));
  const chart = resolveDepthChart(team, roster);
  const depth = {} as DepthChart;
  for (const slot of DEPTH_SLOTS) {
    depth[slot] = chart[slot]
      .map((id) => byId.get(id)!)
      .filter((p) => p.injury === null)
      .map((p) => asLineupPlayer(p, slot));
  }
  return depth;
}
