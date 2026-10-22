/**
 * Coaching styles (Phase 10): what a coach leans toward, drawn from how much
 * real teams differ (calibration/coaching.json), and turned into the engine's
 * team input.
 */
import { Rng } from "@fgm/foundation";
import type { OffenseStyle, DefenseStyle, TeamInput } from "@fgm/game-engine";
import coachingData from "../../../../calibration/coaching.json";
import type { Coach, League } from "../league/schema";
import {
  STAFF_EFFECTS,
  STYLE_MAPPING,
  SKILL_POINTS_PER_STEP,
  TYPICAL_FOCUS,
  COACH_SKILL,
} from "./config";

type Style = Coach["style"];
const T = coachingData.tendencies;

/** The real spread of each tendency between teams, with one season's sampling noise taken out. */
export const STYLE_SPREAD = {
  passOverExpected: T.passOverExpected.trueSpread,
  noHuddle: T.noHuddle.trueSpread,
  deepShare: T.deepShare.trueSpread,
  personnel11: T.personnel11.trueSpread,
  blitz: T.blitz.trueSpread,
  manCoverage: T.manCoverage.trueSpread,
  stackedBox: T.stackedBox.trueSpread,
  fourthDown: T.fourthDownGoOverExpected.trueSpread,
  twoPoint: T.twoPointRate.trueSpread,
};
/** League means, so a style can't push a share below zero or above one. */
const MEANS: Partial<Record<keyof Style, number>> = {
  noHuddle: T.noHuddle.mean,
  deepShare: T.deepShare.mean,
  personnel11: T.personnel11.mean,
  blitz: T.blitz.mean,
  manCoverage: T.manCoverage.mean,
  stackedBox: T.stackedBox.mean,
  twoPoint: T.twoPointRate.mean,
};

/** Keeps a share-type style inside what's possible (a share between 1% and 95%). */
function bounded(key: keyof Style, value: number): number {
  const mean = MEANS[key];
  if (mean === undefined) return value;
  return Math.max(0.01 - mean, Math.min(0.95 - mean, value));
}

/** A coach's style drawn from the real spread between teams. */
export function drawStyle(rng: Rng): Style {
  const style = {} as Style;
  for (const key of Object.keys(STYLE_SPREAD) as (keyof typeof STYLE_SPREAD)[])
    style[key] = bounded(key, rng.gaussian(0, STYLE_SPREAD[key]));
  style.adaptability = Math.max(
    0,
    Math.min(1, rng.gaussian(0.5, STYLE_MAPPING.adaptabilitySpread)),
  );
  return style;
}

/** A skill (0-100) as the engine's -1..1 step, relative to a typical coach at his job. */
export function skillStep(rating: number, typical = TYPICAL_FOCUS): number {
  return Math.max(-1, Math.min(1, (rating - typical) / SKILL_POINTS_PER_STEP));
}

/** A multiplier of 1 for a typical coach, moved by `range` per skill step (lower is better if `invert`). */
export function staffMultiplier(
  rating: number | undefined,
  range: number,
  invert = false,
  typical = TYPICAL_FOCUS,
): number {
  if (rating === undefined) return 1;
  const step = skillStep(rating, typical);
  return 1 + (invert ? -1 : 1) * step * range;
}

/** The coach in a job on a team (the first, for jobs with more than one). */
export function coachIn(league: League, teamId: string, role: Coach["role"]): Coach | undefined {
  return league.coaches.find((c) => c.teamId === teamId && c.role === role);
}

/**
 * What a team's staff hands the engine: the offensive coordinator's offense, the defensive
 * coordinator's defense, the head coach's game management and discipline. A missing coordinator
 * falls back to the head coach.
 */
export function staffInput(
  league: League,
  teamId: string,
): Pick<TeamInput, "offenseStyle" | "defenseStyle" | "gameStyle" | "discipline"> {
  const hc = coachIn(league, teamId, "HC");
  const oc = coachIn(league, teamId, "OC") ?? hc;
  const dc = coachIn(league, teamId, "DC") ?? hc;
  if (!hc || !oc || !dc) return {};
  const offenseStyle: OffenseStyle = {
    passOverExpected: oc.style.passOverExpected,
    noHuddle: oc.style.noHuddle,
    deepShare: oc.style.deepShare,
    personnel11: oc.style.personnel11,
    skill: skillStep(oc.ratings.offense),
  };
  const defenseStyle: DefenseStyle = {
    extraBlitz: dc.style.blitz,
    manCoverage: dc.style.manCoverage,
    stackedBox: dc.style.stackedBox,
    skill: skillStep(dc.ratings.defense),
  };
  const M = STYLE_MAPPING;
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
  return {
    offenseStyle,
    defenseStyle,
    gameStyle: {
      aggressiveness: clamp01(0.5 + hc.style.fourthDown * M.fourthDownAggressivenessPerUnit),
      twoPointAggressiveness: clamp01(0.5 + hc.style.twoPoint * M.twoPointAggressivenessPerUnit),
      adaptability: hc.style.adaptability,
    },
    discipline: staffMultiplier(hc.ratings.leadership, STAFF_EFFECTS.disciplinePenalties, true),
  };
}

export { COACH_SKILL };
