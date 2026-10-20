/**
 * Play calling v1: a tendency table fitted to real NFL habits (how often
 * teams pass by down and distance, go for it on 4th down by field position),
 * nudged by the score and the clock. Coordinators take this over in Phase 10.
 */
import type { Rng } from "@fgm/foundation";
import { REAL, TUNING } from "./config";
import type { Side } from "./types";

export interface Situation {
  quarter: number;
  /** Seconds left in the period. */
  clock: number;
  down: number;
  toGo: number;
  yardsToGoal: number;
  /** Offense's score minus defense's score. */
  margin: number;
  offenseTimeouts: number;
  defenseTimeouts: number;
  clockRunning: boolean;
  overtime: boolean;
  /** Longest field goal this kicker will try. */
  fieldGoalRange: number;
  /** Punting would lose the game (trailing on the second overtime possession). */
  mustScore: boolean;
}

export type Call =
  | { kind: "run"; inside: boolean; note?: string }
  | { kind: "pass"; depth: "short" | "medium" | "deep"; note?: string }
  | { kind: "punt"; note?: string }
  | { kind: "fieldGoal"; note?: string }
  | { kind: "kneel"; note?: string }
  | { kind: "spike"; note?: string };

export function distanceBucket(toGo: number): string {
  return toGo <= 1 ? "1" : toGo <= 3 ? "2-3" : toGo <= 6 ? "4-6" : toGo <= 10 ? "7-10" : "11+";
}

export function fieldZone(yardsToGoal: number): string {
  return yardsToGoal > 60
    ? "own-deep"
    : yardsToGoal > 40
      ? "midfield"
      : yardsToGoal > 20
        ? "plus-territory"
        : "red-zone";
}

const late = (s: Situation) => s.quarter >= 4 || s.overtime;
const kickDistance = (s: Situation) => s.yardsToGoal + TUNING.fieldGoal.snapYards;
const inRange = (s: Situation) => kickDistance(s) <= s.fieldGoalRange;

/** Can the leading offense kneel out the clock? Each kneel burns a play clock unless the defense stops it. */
function canKneelOut(s: Situation): boolean {
  const kneelsLeft = 4 - s.down + 1;
  const stoppable = Math.min(s.defenseTimeouts, kneelsLeft - 1);
  return s.clock <= (kneelsLeft - stoppable) * 40 + 2;
}

export function twoMinuteDrill(
  s: Pick<Situation, "quarter" | "clock" | "margin" | "overtime">,
): boolean {
  if (s.quarter === 2) return s.clock <= 120;
  return (s.quarter >= 4 || s.overtime) && s.clock <= 120 && s.margin <= 0;
}

/** Pass rate for this down and distance, nudged by score and clock. */
export function passRate(s: Situation): number {
  const table = REAL.tendencies.passRateByDownDistance as Record<string, number>;
  let rate =
    (table[`${Math.min(3, s.down)}:${distanceBucket(s.toGo)}`] ?? 0.6) +
    TUNING.baseline.passRateShift;
  const a = TUNING.scoreAdjustment;
  if (s.quarter >= 3 || s.overtime) {
    const weight = late(s) ? a.fourthQuarterBoost : 1;
    if (s.margin < 0) rate += Math.min(a.maxShift, -s.margin * a.trailingPerPoint) * weight;
    if (s.margin > 0) rate -= Math.min(a.maxShift, s.margin * a.leadingPerPoint) * weight;
  }
  if (twoMinuteDrill(s)) rate = Math.max(rate, TUNING.twoMinuteDrillPassRate);
  return Math.min(0.97, Math.max(0.05, rate));
}

function passDepth(rng: Rng, s: Situation): "short" | "medium" | "deep" {
  const share = s.down >= 3 && s.toGo >= 8 ? TUNING.longYardageDepthShare : REAL.pass.depthShare;
  // Near the goal line there's no room to throw deep.
  const deep = s.yardsToGoal < 25 ? 0 : share.deep;
  const medium = s.yardsToGoal < 12 ? 0 : share.medium;
  const r = rng.next() * (share.short + medium + deep);
  return r < share.short ? "short" : r < share.short + medium ? "medium" : "deep";
}

function scrimmageCall(rng: Rng, s: Situation, note?: string): Call {
  if (rng.chance(passRate(s)))
    return { kind: "pass", depth: passDepth(rng, s), ...(note ? { note } : {}) };
  return { kind: "run", inside: rng.chance(TUNING.insideRunShare), ...(note ? { note } : {}) };
}

function fourthDown(rng: Rng, s: Situation): Call {
  const key = `${fieldZone(s.yardsToGoal)}:${distanceBucket(s.toGo)}`;
  let go = (REAL.tendencies.fourthDownGoRate as Record<string, number>)[key] ?? 0.1;
  const fg = (REAL.tendencies.fourthDownFieldGoalRate as Record<string, number>)[key] ?? 0;

  if (s.mustScore) {
    if (s.margin >= -3 && inRange(s))
      return { kind: "fieldGoal", note: "A field goal keeps the game going" };
    return scrimmageCall(rng, s, "Must score to stay alive, so they go for it");
  }
  if (late(s)) {
    if (s.margin < 0 && s.clock <= 300) {
      // Trailing late: kick if a field goal ties or wins, otherwise go for it.
      if (s.margin >= -3 && inRange(s))
        return { kind: "fieldGoal", note: "A field goal ties or wins it" };
      // Under two minutes there may be no next possession; otherwise only short or plus-territory tries.
      if (
        s.clock <= 120 ||
        (s.toGo <= 3 && s.yardsToGoal <= 65) ||
        (s.margin < -8 && s.yardsToGoal <= 50)
      ) {
        return scrimmageCall(rng, s, "Trailing late, so they go for it");
      }
      go = Math.min(0.9, go * 1.5);
    } else if (s.margin > 0 && s.clock <= 300) go *= 0.4;
  }
  if (s.quarter === 2 && s.clock <= 30 && inRange(s))
    return { kind: "fieldGoal", note: "Field goal to end the half" };

  const r = rng.next();
  if (r < go) return scrimmageCall(rng, s, `4th & ${s.toGo}: going for it`);
  if (r < go + fg && inRange(s)) return { kind: "fieldGoal" };
  if (inRange(s) && s.yardsToGoal <= 30) return { kind: "fieldGoal" };
  return { kind: "punt" };
}

export function callPlay(rng: Rng, s: Situation): Call {
  if (late(s) && s.margin > 0 && canKneelOut(s))
    return { kind: "kneel", note: "Kneeling to run out the clock" };
  if (s.quarter === 2 && s.clock <= 25 && s.yardsToGoal >= 70)
    return { kind: "kneel", note: "Kneeling to end the half" };
  // Last-second kicks.
  if (
    s.clock <= 8 &&
    inRange(s) &&
    (s.quarter === 2 || (late(s) && s.margin >= -3 && s.margin <= 0))
  ) {
    return {
      kind: "fieldGoal",
      note: s.quarter === 2 ? "Field goal to end the half" : "Field goal with time running out",
    };
  }
  // Spike to stop the clock in a two-minute drill with no timeouts left.
  if (
    s.clockRunning &&
    twoMinuteDrill(s) &&
    s.offenseTimeouts === 0 &&
    s.clock <= 30 &&
    s.clock > 4 &&
    s.down <= 2
  ) {
    return { kind: "spike", note: "Spiking the ball to stop the clock" };
  }
  if (s.down === 4) return fourthDown(rng, s);
  return scrimmageCall(rng, s);
}

/** Go for two after a touchdown? `margin` is the scoring team's lead after the touchdown. */
export function goForTwo(
  rng: Rng,
  quarter: number,
  clock: number,
  margin: number,
): { go: boolean; note?: string } {
  const lateGame = quarter >= 4 || (quarter === 3 && clock <= 300);
  if (lateGame && TUNING.twoPoint.lateChart.includes(margin)) {
    const where = margin > 0 ? `Up ${margin}` : margin < 0 ? `Down ${-margin}` : "Tied";
    return { go: true, note: `${where} after the score, so they go for two` };
  }
  return { go: rng.chance(TUNING.twoPoint.baseRate) };
}

/** Seconds that run off before the next snap while the clock is running. */
export function tempo(s: Pick<Situation, "quarter" | "clock" | "margin" | "overtime">): number {
  if (twoMinuteDrill(s) || ((s.quarter >= 4 || s.overtime) && s.margin < -8 && s.clock <= 360))
    return TUNING.tempo.hurry;
  if ((s.quarter >= 4 || s.overtime) && s.margin > 0 && s.clock <= 360) return TUNING.tempo.milk;
  return TUNING.tempo.normal;
}

/** Does a team call timeout to stop the running clock? */
export function wantsTimeout(
  side: "offense" | "defense",
  s: Pick<Situation, "quarter" | "clock" | "margin" | "overtime" | "yardsToGoal">,
): boolean {
  if (side === "offense") {
    if (s.quarter === 2) return s.clock <= 60 && s.yardsToGoal <= 70;
    return (s.quarter >= 4 || s.overtime) && s.clock <= 120 && s.margin <= 0;
  }
  // The defense stops the clock when it's behind late and still has time to come back.
  return (s.quarter >= 4 || s.overtime) && s.margin > 0 && s.margin <= 16 && s.clock <= 180;
}

export const otherSide = (side: Side): Side => (side === "home" ? "away" : "home");
