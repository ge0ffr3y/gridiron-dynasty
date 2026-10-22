/**
 * Real coaches' styles (Phase 10, private): each 2025 coordinator's side of the ball as his
 * team played it in 2025, and each head coach's 4th-down and 2-point habits over every season
 * he was a head coach (pipeline/private/out/coach-tendencies.json, from `npm run pipeline --
 * coaching`). Each is pulled toward the league average by how noisy its sample is, so one odd
 * season doesn't make a coach extreme.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Coach } from "@fgm/sim-core";
import coaching from "../../../calibration/coaching.json";
import { ROOT } from "../matchups";

type Measure = { value: number | null; n: number };
interface Tendencies {
  teams2025: Record<string, Record<string, Measure>>;
  headCoaches: Record<string, Record<string, Measure>>;
}

const FILE = join(ROOT, "pipeline", "private", "out", "coach-tendencies.json");
const T = coaching.tendencies as Record<string, { mean: number; trueSpread: number }>;

/** Offense keys the offensive coordinator carries, defense keys the defensive coordinator. */
const OFFENSE: [keyof Coach["style"], string][] = [
  ["passOverExpected", "passOverExpected"],
  ["noHuddle", "noHuddle"],
  ["deepShare", "deepShare"],
  ["personnel11", "personnel11"],
];
const DEFENSE: [keyof Coach["style"], string][] = [
  ["blitz", "blitz"],
  ["manCoverage", "manCoverage"],
  ["stackedBox", "stackedBox"],
];
const HEAD: [keyof Coach["style"], string][] = [
  ["fourthDown", "fourthDownGoOverExpected"],
  ["twoPoint", "twoPointRate"],
];

/** The real value as a style: its distance from the mean, shrunk by its sample's noise. */
function shrunk(key: string, m: Measure | undefined): number | undefined {
  const t = T[key];
  if (!t || !m || m.value === null || m.n <= 0) return undefined;
  const noise =
    key === "passOverExpected" || key === "fourthDownGoOverExpected"
      ? 0.22 / m.n
      : (Math.max(0.01, t.mean) * Math.max(0.01, 1 - t.mean)) / m.n;
  const trueVar = t.trueSpread * t.trueSpread;
  const reliability = trueVar / (trueVar + noise);
  return (m.value - t.mean) * reliability;
}

let loaded: Tendencies | null | undefined;
function tendencies(): Tendencies | null {
  if (loaded === undefined)
    loaded = existsSync(FILE) ? (JSON.parse(readFileSync(FILE, "utf8")) as Tendencies) : null;
  return loaded;
}

/** A real coach's measured style (undefined where there's no data: generated as usual). */
export function realCoachStyle(
  role: string,
  team: string,
  name: string,
): Partial<Coach["style"]> | undefined {
  const t = tendencies();
  if (!t) return undefined;
  const pairs = role === "OC" ? OFFENSE : role === "DC" ? DEFENSE : role === "HC" ? HEAD : [];
  const source = role === "HC" ? t.headCoaches[name] : t.teams2025[team];
  if (!source || pairs.length === 0) return undefined;
  const style: Partial<Coach["style"]> = {};
  for (const [styleKey, key] of pairs) {
    const v = shrunk(key, source[key]);
    if (v !== undefined) style[styleKey] = v;
  }
  return Object.keys(style).length ? style : undefined;
}
