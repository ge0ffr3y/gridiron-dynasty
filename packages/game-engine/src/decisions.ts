/**
 * 4th-down and 2-point decisions. The analytics baseline compares the
 * win probability of each option, using real conversion rates, real punt
 * results and the kicker's real make chance. Real coaches are more cautious
 * than that baseline, so a coach goes for it with a chance that rises with
 * the win-probability gain, shifted by a league-wide lean (tuned to real go
 * rates) and by the team's own aggressiveness.
 */
import { dmath, type Rng } from "@fgm/foundation";
import { CALIBRATION_TARGETS, REAL, SITUATIONS, TUNING } from "./config";

export interface NextState {
  /** The deciding team has the ball (true) or the other team does. */
  ourBall: boolean;
  /** The deciding team's lead. */
  margin: number;
  down: number;
  toGo: number;
  /** For whichever team has the ball. */
  yardsToGoal: number;
  secondsUsed: number;
}

/** What a decision needs from the game. */
export interface Evaluator {
  /** Chance the deciding team wins from a next state. */
  winChance(next: NextState): number;
  /** Chance its kicker makes a kick of this distance. */
  makeChance(distance: number): number;
  /** 0 (cautious) to 1 (bold); 0.5 is a typical coach. */
  aggressiveness: number;
  twoPointAggressiveness: number;
}

const D = TUNING.decisions;
const RED_ZONE = 20;
/** Where the other team starts after a kickoff, on average (yards to goal). */
const KICKOFF_YARDS_TO_GOAL = 100 - REAL.kicking.kickoffStartMean;

function conversionChance(toGo: number, yardsToGoal: number): number {
  // Inside the 20 the field is compressed and conversions are harder.
  const table = (
    yardsToGoal <= RED_ZONE ? SITUATIONS.conversion.redZone : SITUATIONS.conversion.fourth
  ) as Record<string, number>;
  const key = toGo <= 10 ? String(Math.max(1, toGo)) : toGo <= 15 ? "11-15" : "16+";
  return table[key] ?? 0.1;
}

/** Where a punt from here leaves the other team (its yards to goal), from real punts. */
export function puntResult(yardsToGoal: number): number {
  const byBand = SITUATIONS.puntResult.byBand as Record<string, number>;
  const bands = Object.keys(byBand)
    .map(Number)
    .sort((a, b) => a - b);
  const band = Math.min(bands.at(-1)!, Math.max(bands[0]!, Math.floor((yardsToGoal - 1) / 5)));
  return byBand[String(band)]!;
}

/** The deciding team's chance after scoring `points` and kicking off. */
function afterScore(e: Evaluator, margin: number, points: number, secondsUsed: number): number {
  return e.winChance({
    ourBall: false,
    margin: margin + points,
    down: 1,
    toGo: 10,
    yardsToGoal: KICKOFF_YARDS_TO_GOAL,
    secondsUsed,
  });
}

export interface FourthDownOptions {
  go: number;
  punt: number | null;
  fieldGoal: number | null;
}

/** Win probability of each 4th-down option. */
export function fourthDownOptions(
  s: { margin: number; toGo: number; yardsToGoal: number; fieldGoalRange: number },
  e: Evaluator,
): FourthDownOptions {
  const secs = D.secondsPerPlay;
  // Go for it: convert (maybe score) or turn it over on downs.
  const p = conversionChance(s.toGo, s.yardsToGoal);
  const past = s.yardsToGoal - s.toGo - D.conversionExtraYards;
  const success =
    s.toGo >= s.yardsToGoal || past <= 0
      ? afterScore(e, s.margin, 7, secs)
      : e.winChance({
          ourBall: true,
          margin: s.margin,
          down: 1,
          toGo: 10,
          yardsToGoal: past,
          secondsUsed: secs,
        });
  const failure = e.winChance({
    ourBall: false,
    margin: s.margin,
    down: 1,
    toGo: 10,
    yardsToGoal: 100 - s.yardsToGoal,
    secondsUsed: secs,
  });
  const go = p * success + (1 - p) * failure;
  // Punt.
  const punt =
    s.yardsToGoal < D.noPuntInside
      ? null
      : e.winChance({
          ourBall: false,
          margin: s.margin,
          down: 1,
          toGo: 10,
          yardsToGoal: puntResult(s.yardsToGoal),
          secondsUsed: D.secondsPerPunt,
        });
  // Field goal: a miss gives the ball back at the spot of the kick (or the 20).
  const distance = s.yardsToGoal + TUNING.fieldGoal.snapYards;
  let fieldGoal: number | null = null;
  if (distance <= s.fieldGoalRange) {
    const make = e.makeChance(distance);
    const miss = e.winChance({
      ourBall: false,
      margin: s.margin,
      down: 1,
      toGo: 10,
      yardsToGoal: Math.min(80, 100 - s.yardsToGoal - (TUNING.fieldGoal.snapYards - 10)),
      secondsUsed: secs,
    });
    fieldGoal = make * afterScore(e, s.margin, 3, secs) + (1 - make) * miss;
  }
  return { go, punt, fieldGoal };
}

export type FourthDownChoice = "go" | "punt" | "fieldGoal";

/** The coach's call, and the win-probability numbers behind it. */
export function decideFourthDown(
  rng: Rng,
  s: { margin: number; toGo: number; yardsToGoal: number; fieldGoalRange: number },
  e: Evaluator,
): { choice: FourthDownChoice; options: FourthDownOptions } {
  const options = fourthDownOptions(s, e);
  const kick =
    options.fieldGoal !== null && (options.punt === null || options.fieldGoal >= options.punt)
      ? "fieldGoal"
      : options.punt !== null
        ? "punt"
        : null;
  if (kick === null) return { choice: "go", options };
  const alternative = (kick === "fieldGoal" ? options.fieldGoal : options.punt) as number;
  const kickDistance = s.yardsToGoal + TUNING.fieldGoal.snapYards;
  const lean =
    (kick === "fieldGoal"
      ? D.goLeanVsFieldGoal + Math.max(0, kickDistance - D.trustedKick) * D.longKickDoubt
      : D.goLeanVsPunt) +
    (e.aggressiveness - 0.5) * D.aggressivenessRange;
  const goChance = dmath.logistic(D.goSlope * (options.go - alternative) + lean);
  return { choice: rng.chance(goChance) ? "go" : kick, options };
}

/** Go for two? `margin` is the scoring team's lead after the touchdown. */
export function decideTwoPoint(
  rng: Rng,
  margin: number,
  e: Evaluator,
): { go: boolean; gain: number } {
  const xp = CALIBRATION_TARGETS.extraPointPct.real;
  const two = REAL.kicking.twoPointSuccessRate;
  const at = (points: number) => afterScore(e, margin, points, 0);
  const kick = xp * at(1) + (1 - xp) * at(0);
  const goForTwo = two * at(2) + (1 - two) * at(0);
  const gain = goForTwo - kick;
  const lean = D.twoPointLean + (e.twoPointAggressiveness - 0.5) * D.aggressivenessRange;
  return { go: rng.chance(dmath.logistic(D.twoPointSlope * gain + lean)), gain };
}
