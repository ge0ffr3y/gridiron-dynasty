/**
 * Play calling v1: a tendency table fitted to real NFL habits (how often
 * teams pass by down and distance, go for it on 4th down by field position),
 * nudged by the score and the clock. Coordinators take this over in Phase 10.
 */
import type { Rng } from "@fgm/foundation";
import { REAL, TUNING } from "./config";
import { decideFourthDown, type Evaluator, type FourthDownChoice } from "./decisions";
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
  /** Win-probability look-ahead and the coach's style, for 4th-down calls. */
  evaluator: Evaluator;
  /** Halftime adjustment to the pass rate (leaning toward what worked). */
  passRateAdjustment: number;
}

export type Call =
  | { kind: "run"; inside: boolean; note?: string }
  | { kind: "pass"; depth: "short" | "medium" | "deep"; note?: string }
  | { kind: "punt"; note?: string }
  | { kind: "fieldGoal"; note?: string }
  | { kind: "kneel"; note?: string }
  | { kind: "spike"; note?: string };

/** Situation groups for pass-rate tuning (and the scorecard). */
export function passGroup(down: number, toGo: number): string {
  if (down === 1) return "1st down";
  if (down === 2) return toGo <= 3 ? "2nd & short" : toGo >= 7 ? "2nd & long" : "2nd & medium";
  return toGo <= 3 ? "3rd & short" : toGo >= 7 ? "3rd & long" : "3rd & medium";
}

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

const TWO_MINUTES = 120;
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
    (TUNING.baseline.passRateShift[passGroup(s.down, s.toGo)] ?? 0);
  const a = TUNING.scoreAdjustment;
  if (s.quarter >= 3 || s.overtime) {
    const weight = late(s) ? a.fourthQuarterBoost : 1;
    if (s.margin < 0) rate += Math.min(a.maxShift, -s.margin * a.trailingPerPoint) * weight;
    if (s.margin > 0) rate -= Math.min(a.maxShift, s.margin * a.leadingPerPoint) * weight;
  }
  rate += s.passRateAdjustment;
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

const pct = (p: number) => `${Math.round(p * 100)}%`;
const OPTION_NAMES: Record<FourthDownChoice, string> = {
  go: "going for it",
  punt: "punting",
  fieldGoal: "a field goal",
};

function fourthDown(rng: Rng, s: Situation): Call {
  if (s.mustScore) {
    if (s.margin >= -3 && inRange(s))
      return { kind: "fieldGoal", note: "A field goal keeps the game going" };
    return scrimmageCall(rng, s, "Must score to stay alive, so they go for it");
  }
  if (s.quarter === 2 && s.clock <= 30 && inRange(s))
    return { kind: "fieldGoal", note: "Field goal to end the half" };

  // Win probability of each option, then the coach's call.
  const { choice, options } = decideFourthDown(rng, s, s.evaluator);
  const ranked = (Object.entries(options) as [FourthDownChoice, number | null][])
    .filter((o): o is [FourthDownChoice, number] => o[1] !== null)
    .sort((a, b) => b[1] - a[1]);
  const chosen = options[choice] as number;
  const best = ranked[0]!;
  const followed = best[0] === choice;
  // "going for it (win chance 54% vs. 51% punting)" or "punting, though going for it rated higher (41% vs. 40%)".
  const detail = followed
    ? ` (win chance ${pct(chosen)}${ranked[1] ? ` vs. ${pct(ranked[1][1])} ${OPTION_NAMES[ranked[1][0]]}` : ""})`
    : `, though ${OPTION_NAMES[best[0]]} rated higher (${pct(best[1])} vs. ${pct(chosen)})`;
  if (choice === "go") return scrimmageCall(rng, s, `4th & ${s.toGo}: going for it${detail}`);
  // Ordinary kicks only get a note when the coach went against the numbers.
  const note = followed ? undefined : `4th & ${s.toGo}: ${OPTION_NAMES[choice]}${detail}`;
  return choice === "fieldGoal"
    ? { kind: "fieldGoal", ...(note ? { note } : {}) }
    : { kind: "punt", ...(note ? { note } : {}) };
}

export function callPlay(rng: Rng, s: Situation): Call {
  if (late(s) && s.margin > 0 && canKneelOut(s))
    return { kind: "kneel", note: "Kneeling to run out the clock" };
  // Deep in their own end with little time before halftime, most teams run out the clock.
  const C = TUNING.clock;
  if (s.quarter === 2 && s.yardsToGoal >= C.runOutHalfYardsToGoal) {
    if (s.clock <= C.kneelHalfSeconds) return { kind: "kneel", note: "Kneeling to end the half" };
    if (s.clock <= C.runOutHalfSeconds && s.down < 4)
      return { kind: "run", inside: true, note: "Running out the clock before halftime" };
  }
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

/** A timeout early in a half, to beat the play clock or regroup (only with timeouts to spare). */
export function regroupTimeout(
  rng: Rng,
  s: Pick<Situation, "quarter" | "clock" | "overtime">,
  timeoutsLeft: number,
): boolean {
  const C = TUNING.clock;
  if (s.overtime || timeoutsLeft < C.regroupKeepAtLeast) return false;
  // The last two minutes of each half belong to clock management.
  if ((s.quarter === 2 || s.quarter === 4) && s.clock <= TWO_MINUTES) return false;
  return rng.chance(s.quarter <= 2 ? C.regroupPerSnap.firstHalf : C.regroupPerSnap.secondHalf);
}
