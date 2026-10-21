/**
 * Game page charts, built from the play-by-play: the home team's win
 * probability over the game, every drive (where it started and ended, how
 * long it took, how it finished), and the time axis both use.
 */
import type { Play, Side } from "@fgm/game-engine";

export interface WinPoint {
  /** Seconds of game time since kickoff. */
  elapsed: number;
  /** The home team's chance of winning, 0-1. */
  home: number;
  quarter: number;
  clock: number;
  /** Index into the play-by-play (for the tooltip's play text); -1 for the final whistle. */
  play: number;
}

export type DriveResult =
  | "Touchdown"
  | "Field goal"
  | "Missed field goal"
  | "Punt"
  | "Interception"
  | "Fumble"
  | "Downs"
  | "Safety"
  | "End of half"
  | "End of game";

export interface Drive {
  team: Side;
  quarter: number;
  /** Clock (seconds left in the period) at the first snap. */
  clock: number;
  /** Yards to the goal at the start and end of the drive (100 = own goal line). */
  startYardsToGoal: number;
  endYardsToGoal: number;
  plays: number;
  yards: number;
  seconds: number;
  result: DriveResult;
}

export interface GameTime {
  quarterSeconds: number;
  overtimeSeconds: number;
}

/** Seconds of game time since kickoff at a moment in the game. */
export function elapsedAt(t: GameTime, quarter: number, clock: number): number {
  if (quarter <= 4) return (quarter - 1) * t.quarterSeconds + (t.quarterSeconds - clock);
  return 4 * t.quarterSeconds + (quarter - 5) * t.overtimeSeconds + (t.overtimeSeconds - clock);
}

/** The home team's win probability before each snap, ending at the final result. */
export function winProbabilitySeries(plays: Play[], t: GameTime): WinPoint[] {
  const points: WinPoint[] = [];
  plays.forEach((p, i) => {
    if (p.wp === undefined) return;
    points.push({
      elapsed: elapsedAt(t, p.quarter, p.clock),
      home: p.wp,
      quarter: p.quarter,
      clock: p.clock,
      play: i,
    });
  });
  const last = plays.at(-1);
  if (last) {
    const [home, away] = last.score;
    points.push({
      elapsed: elapsedAt(t, last.quarter, 0),
      home: home > away ? 1 : home < away ? 0 : 0.5,
      quarter: last.quarter,
      clock: 0,
      play: -1,
    });
  }
  return points;
}

/** Plays that belong to a drive (snaps and the kicks that end them). */
const DRIVE_KINDS = new Set([
  "run",
  "pass",
  "sack",
  "scramble",
  "penalty",
  "punt",
  "fieldGoal",
  "kneel",
  "spike",
]);
const SNAPS = new Set(["run", "pass", "sack", "scramble", "kneel", "spike"]);

function endsDrive(p: Play): DriveResult | null {
  if (p.touchdown !== undefined)
    return p.touchdown === p.offense ? "Touchdown" : p.intercepted ? "Interception" : "Fumble";
  if (p.safety) return "Safety";
  if (p.kind === "punt") return "Punt";
  if (p.kind === "fieldGoal") return p.good ? "Field goal" : "Missed field goal";
  if (p.noPlay) return null;
  if (p.intercepted) return "Interception";
  if (p.fumble?.lost) return "Fumble";
  if (p.turnoverOnDowns) return "Downs";
  return null;
}

/** Every drive in the game, in order. */
export function drives(plays: Play[], t: GameTime): Drive[] {
  const out: Drive[] = [];
  let current: { team: Side; first: Play; last: Play; snaps: number; startIndex: number } | null =
    null;

  const close = (result: DriveResult, nextIndex: number) => {
    if (!current) return;
    const { first, last } = current;
    const scored = result === "Touchdown";
    const endYardsToGoal = scored
      ? 0
      : ["Punt", "Field goal", "Missed field goal", "Downs"].includes(result) || last.noPlay
        ? last.yardsToGoal
        : Math.max(0, Math.min(100, last.yardsToGoal - last.yards));
    const next = plays[nextIndex];
    const endElapsed = next
      ? elapsedAt(t, next.quarter, next.clock)
      : elapsedAt(t, last.quarter, 0);
    out.push({
      team: current.team,
      quarter: first.quarter,
      clock: first.clock,
      startYardsToGoal: first.yardsToGoal,
      endYardsToGoal,
      plays: current.snaps,
      yards: first.yardsToGoal - endYardsToGoal,
      seconds: Math.max(0, endElapsed - elapsedAt(t, first.quarter, first.clock)),
      result,
    });
    current = null;
  };

  plays.forEach((p, i) => {
    if (p.kind === "endOfPeriod" && current) {
      const halfOver = p.quarter === 2 || p.quarter >= 4;
      if (halfOver) close(i === plays.length - 1 ? "End of game" : "End of half", i + 1);
      return;
    }
    if (!DRIVE_KINDS.has(p.kind)) return;
    if (current && current.team !== p.offense) close("Downs", i);
    if (!current) current = { team: p.offense, first: p, last: p, snaps: 0, startIndex: i };
    current.last = p;
    if (SNAPS.has(p.kind) && !p.noPlay) current.snaps += 1;
    const result = endsDrive(p);
    if (result) close(result, i + 1);
  });
  if (current) close("End of game", plays.length);
  return out;
}
