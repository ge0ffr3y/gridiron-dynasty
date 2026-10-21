/**
 * Win probability: the chance the team with the ball wins, from a logistic
 * model fitted to real NFL outcomes (calibration/situations.json). It knows
 * the score, the time left, field position, down and distance (through
 * expected points), timeouts, home field and who gets the ball after halftime.
 */
import { dmath } from "@fgm/foundation";
import { SITUATIONS } from "./config";
import { smoothExpectedPoints } from "./epa";

export interface WinState {
  /** The offense's score minus the defense's. */
  margin: number;
  minutesLeft: number;
  down: number;
  toGo: number;
  yardsToGoal: number;
  /** Offense's timeouts minus the defense's. */
  timeoutEdge: number;
  /** 1 = the offense is at home, -1 = on the road, 0 = neutral site. */
  home: number;
  /** In the first half: 1 if the offense gets the ball after halftime, -1 if not; 0 after halftime. */
  receivesSecondHalf: number;
}

const WEIGHTS = SITUATIONS.winProbability.weights;

/** The chance the offense wins. Order of features matches the pipeline's fit. */
export function winProbability(s: WinState): number {
  const late = 1 / Math.sqrt(Math.max(0, s.minutesLeft) + 1);
  const ep = smoothExpectedPoints(s.down, s.toGo, s.yardsToGoal);
  const features = [
    s.margin,
    s.margin * late,
    ep,
    ep * late,
    s.timeoutEdge,
    s.timeoutEdge * late,
    s.home,
    s.receivesSecondHalf,
  ];
  let z = 0;
  for (let i = 0; i < features.length; i++) z += (features[i] as number) * (WEIGHTS[i] as number);
  // With no time left the result is settled, whatever the formula says.
  if (s.minutesLeft <= 0) return s.margin > 0 ? 1 : s.margin < 0 ? 0 : 0.5;
  return dmath.logistic(z);
}
