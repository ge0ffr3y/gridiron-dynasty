/** What every kind of experiment needs: a league copy, stepping with levers held, and a summary shape. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  advance,
  advanceUntil,
  createLeague,
  parseLeague,
  startRealLeague,
  tInterval,
  pairedDifference,
  type Interval,
  type League,
} from "@fgm/sim-core";
import type { Spec } from "../spec";

/** The repository's root folder (the runner's files are two levels down). */
export const ROOT = resolve(import.meta.dirname, "..", "..", "..", "..", "..");

/** A league to copy for each run: parsed (and, for the real league, started) once per worker. */
export interface Base {
  /** A JSON string every run copies; undefined when each run makes its own league from its seed. */
  text?: string;
}

export function prepareBase(spec: Spec): Base {
  if (spec.start.type === "generated") return {};
  const file = resolve(ROOT, spec.start.file);
  const real = parseLeague(readFileSync(file, "utf8"));
  const started = startRealLeague(real, { name: spec.id, seed: spec.start.seed });
  // Some experiments start from the first week of the season, after one shared offseason.
  if (spec.params.advanceTo === "regular")
    advanceUntil(started, (l) => l.calendar.stage === "regular");
  return { text: JSON.stringify(started) };
}

/** A fresh league for one run, on the run's own seed. */
export function leagueFor(spec: Spec, base: Base, seed: number): League {
  if (base.text === undefined) return createLeague({ seed, name: `${spec.id} ${seed}` });
  const league = JSON.parse(base.text) as League;
  league.meta.seed = seed;
  // The saved streams belong to the start, not to this run.
  league.rng = {};
  return league;
}

/**
 * Steps the league until `stop`, calling `after` after every step: held levers are re-applied there,
 * so a newly hired general manager or coach never decides anything on his own profile.
 */
export function stepUntil(
  league: League,
  stop: (l: League) => boolean,
  after: (l: League) => void = () => {},
): void {
  for (let i = 0; i < 500; i++) {
    if (stop(league)) return;
    advance(league);
    after(league);
  }
  throw new Error(`the league never reached the stopping point (${league.calendar.stage})`);
}

/** A metric across runs: its mean and interval. */
export function across(values: number[]): Interval {
  return tInterval(values);
}

/** The difference between two groups' metric over matched runs (same run, same league). */
export function difference(a: number[], b: number[]): Interval {
  return pairedDifference(a, b);
}

/** What every result file starts with. */
export interface ResultHeader {
  id: string;
  title: string;
  question: string;
  kind: Spec["kind"];
  visibility: Spec["visibility"];
  runs: number;
  seasons: number;
  conclusion: string;
}

export function header(spec: Spec, runs: number): ResultHeader {
  return {
    id: spec.id,
    title: spec.title,
    question: spec.question,
    kind: spec.kind,
    visibility: spec.visibility,
    runs,
    seasons: spec.seasons,
    conclusion: spec.conclusion,
  };
}

/** An independent copy of a league (plain JSON, no classes), on a new seed with no saved streams. */
export function cloneLeague(league: League, seed?: number): League {
  const copy = JSON.parse(JSON.stringify(league)) as League;
  if (seed !== undefined) {
    copy.meta.seed = seed;
    copy.rng = {};
  }
  return copy;
}

/** A whole number from a label, for seeds that must be the same wherever they are asked for. */
export function seedFrom(hash: (label: string) => number, label: string): number {
  return Math.floor(hash(label) * 2_147_483_647);
}
