/**
 * The real age curves (calibration/lifecycle.json): each position's average
 * change per year, in standard deviations of a real measure, by age.
 */
import type { Position } from "@fgm/foundation";
import lifecycle from "../../../../calibration/lifecycle.json";
import { DEVELOPMENT, SPECIALIST_CURVE } from "./config";

type Curve = { age: number; change: number }[];

/** The sim's positions -> the measured groups. */
const GROUP: Record<Position, string | null> = {
  QB: "QB",
  RB: "RB",
  FB: "FB",
  WR: "WR",
  TE: "TE",
  OT: "OL",
  OG: "OL",
  C: "OL",
  EDGE: "EDGE",
  DT: "DT",
  LB: "LB",
  CB: "CB",
  S: "S",
  K: null,
  P: null,
  LS: null,
};

const measured = lifecycle.aging as Record<string, { peakAge: number; curve: Curve }>;

/**
 * A group with too few real players for its own curve (fullbacks) uses the average of the
 * others' curves at each age.
 */
function averageCurve(): Curve {
  const byAge = new Map<number, number[]>();
  for (const g of Object.values(measured))
    for (const c of g.curve) byAge.set(c.age, [...(byAge.get(c.age) ?? []), c.change]);
  return [...byAge]
    .filter(([, xs]) => xs.length >= 3)
    .sort((a, b) => a[0] - b[0])
    .map(([age, xs]) => ({ age, change: xs.reduce((a, b) => a + b, 0) / xs.length }));
}

const curves: Record<string, { peakAge: number; curve: Curve }> = Object.fromEntries(
  Object.entries(measured).map(([g, c]) => [
    g,
    c.curve.length > 0 ? c : { peakAge: c.peakAge, curve: averageCurve() },
  ]),
);
const careers = lifecycle.careers as Record<string, { lastSeasonAgeQuantiles: number[] }>;

function interpolate(points: [number, number][], age: number): number {
  if (age <= points[0]![0]) return points[0]![1];
  for (let i = 0; i < points.length - 1; i++) {
    const [a0, v0] = points[i]!;
    const [a1, v1] = points[i + 1]!;
    if (age <= a1) return v0 + ((v1 - v0) * (age - a0)) / (a1 - a0);
  }
  return points.at(-1)![1];
}

/** A position's average change for a player of this age, in standard deviations per year. */
export function ageCurve(position: Position, age: number): number {
  const group = GROUP[position];
  if (!group || !curves[group]) return interpolate(SPECIALIST_CURVE, age);
  const curve = curves[group]!.curve;
  const first = curve[0]!;
  const last = curve.at(-1)!;
  if (age <= first.age) return first.change;
  if (age > last.age) {
    // Past the measured ages, decline keeps getting a little steeper.
    const tail = curve.slice(-3);
    const base = tail.reduce((a, c) => a + c.change, 0) / tail.length;
    return Math.min(base, 0) - DEVELOPMENT.lateDeclineStep * (age - last.age);
  }
  return (
    curve.find((c) => c.age === age)?.change ??
    interpolate(
      curve.map((c) => [c.age, c.change]),
      age,
    )
  );
}

/** The age a position peaks at (where its curve turns from growth to decline). */
export function peakAge(position: Position): number {
  const group = GROUP[position];
  return group && curves[group] ? curves[group]!.peakAge : 30;
}

/** Real retirement ages for a position: [10th, 25th, 50th, 75th, 90th] percentiles of a career's last season. */
export function retirementAges(position: Position): number[] {
  const group = GROUP[position] ?? (position === "LS" ? "LS" : position);
  return careers[group]?.lastSeasonAgeQuantiles ?? careers["QB"]!.lastSeasonAgeQuantiles;
}

/**
 * The share of a young player's remaining growth that comes this year: half from the real
 * curve's timing (this age's growth over the growth still to come), half spread evenly over
 * the years to his peak (the real curves are lumpy year to year). 0 at or past the peak.
 */
export function growthShare(position: Position, age: number): number {
  const now = ageCurve(position, age);
  if (now <= 0) return 0;
  let ahead = 0;
  let years = 0;
  for (let a = age; a < age + 20; a++) {
    const c = ageCurve(position, a);
    if (c <= 0) break;
    ahead += c;
    years += 1;
  }
  return 0.5 * (now / ahead) + 0.5 * (1 / years);
}
