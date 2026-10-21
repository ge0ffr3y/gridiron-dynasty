/**
 * Expected points added (EPA): how much a play changed the offense's
 * expected points, using the expected-points table measured from real NFL
 * play-by-play (calibration/matchups.json). Conventions follow nflverse, so
 * league averages compare directly: a touchdown is worth 7, a safety -2, a
 * change of possession is the other team's expected points (negative), and
 * the end of a half resets to 0.
 */
import { expectedPoints } from "./penalties";
import type { Play } from "./types";

/** Plays that get an EPA (the offense's scrimmage snaps, including ones wiped out by penalties). */
const RATED = new Set(["run", "pass", "sack", "scramble", "penalty"]);
/** Plays that show where the next down stands. */
const STATE = new Set([
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

const TOUCHDOWN = 7;
const SAFETY = -2;
/** The table is measured in 5-yard bands; each band's value sits at its middle. */
const BAND = 5;
const BAND_MIDDLE = 3;

/** Expected points, blended between the 5-yard bands so every yard counts. */
export function smoothExpectedPoints(down: number, toGo: number, yardsToGoal: number): number {
  const ytg = Math.max(1, Math.min(99, yardsToGoal));
  const band = Math.floor((ytg - 1) / BAND);
  const middle = band * BAND + BAND_MIDDLE;
  const neighbor = ytg >= middle ? middle + BAND : middle - BAND;
  if (neighbor < 1 || neighbor > 99) return expectedPoints(down, toGo, ytg);
  const here = expectedPoints(down, toGo, middle);
  const there = expectedPoints(down, toGo, neighbor);
  return here + ((there - here) * Math.abs(ytg - middle)) / BAND;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Writes each scrimmage play's EPA onto it. */
export function addExpectedPoints(plays: Play[]): void {
  for (let i = 0; i < plays.length; i++) {
    const p = plays[i]!;
    if (!RATED.has(p.kind)) continue;
    const before = smoothExpectedPoints(p.down, p.toGo, p.yardsToGoal);
    let after: number;
    if (p.touchdown !== undefined) after = p.touchdown === p.offense ? TOUCHDOWN : -TOUCHDOWN;
    else if (p.safety) after = SAFETY;
    else after = nextState(plays, i);
    p.epa = round2(after - before);
  }
}

/** The offense's expected points at the next snap (0 if the half ended first). */
function nextState(plays: Play[], i: number): number {
  const p = plays[i]!;
  for (let j = i + 1; j < plays.length; j++) {
    const q = plays[j]!;
    // Halftime and the end of the game wipe the slate clean.
    if (q.kind === "endOfPeriod" && (q.quarter === 2 || q.quarter >= 4)) return 0;
    if (!STATE.has(q.kind)) continue;
    const ep = smoothExpectedPoints(q.down, q.toGo, q.yardsToGoal);
    return q.offense === p.offense ? ep : -ep;
  }
  return 0;
}
