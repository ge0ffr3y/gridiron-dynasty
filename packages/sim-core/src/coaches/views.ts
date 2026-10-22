/**
 * Coach screens (Phase 10): a coach's philosophy against the league average,
 * a one-line summary of his style, what his job does for his team, and
 * players' scheme fit as a team's staff sees it.
 */
import type { Coach, CoachRole, League, Player } from "../league/schema";
import { perceivePlayer, type Viewer } from "../perception";
import { COACH_SKILL, POSITION_COACH, ROLE_FOCUS, STAFF_EFFECTS } from "./config";
import { fitLabel, fitScore, teamScheme } from "./fit";
import { skillStep, STYLE_SPREAD, staffMultiplier } from "./style";

type StyleKey = keyof typeof STYLE_SPREAD;

/** Each tendency: its name, its side, how to show it, and the words for leaning each way. */
const TENDENCIES: {
  key: StyleKey;
  label: string;
  side: "offense" | "defense" | "game";
  /** Shown as points of a percentage. */
  unit: string;
  more: string;
  less: string;
}[] = [
  {
    key: "passOverExpected",
    label: "Pass rate",
    side: "offense",
    unit: "pts",
    more: "pass-heavy",
    less: "run-first",
  },
  {
    key: "noHuddle",
    label: "No-huddle",
    side: "offense",
    unit: "pts",
    more: "up-tempo",
    less: "deliberate",
  },
  {
    key: "deepShare",
    label: "Deep passes",
    side: "offense",
    unit: "pts",
    more: "takes deep shots",
    less: "short passing game",
  },
  {
    key: "personnel11",
    label: "Three-receiver sets",
    side: "offense",
    unit: "pts",
    more: "spreads it out",
    less: "heavy personnel",
  },
  {
    key: "blitz",
    label: "Blitzes",
    side: "defense",
    unit: "pts",
    more: "blitz-happy",
    less: "rushes four",
  },
  {
    key: "manCoverage",
    label: "Man coverage",
    side: "defense",
    unit: "pts",
    more: "man coverage",
    less: "zone coverage",
  },
  {
    key: "stackedBox",
    label: "Stacked boxes",
    side: "defense",
    unit: "pts",
    more: "stacks the box",
    less: "light boxes",
  },
  {
    key: "fourthDown",
    label: "Goes for it on 4th down",
    side: "game",
    unit: "pts",
    more: "aggressive on 4th down",
    less: "conservative on 4th down",
  },
  {
    key: "twoPoint",
    label: "2-point tries",
    side: "game",
    unit: "pts",
    more: "goes for two",
    less: "kicks the extra point",
  },
];

/** A lean this many spreads from average gets a word in the summary. */
const NOTABLE = 0.7;

/** Which side of a coach's style reaches the field in his job. */
function activeSide(role: CoachRole): "offense" | "defense" | "game" | null {
  return role === "OC" ? "offense" : role === "DC" ? "defense" : role === "HC" ? "game" : null;
}

export interface PhilosophyLine {
  key: string;
  label: string;
  side: "offense" | "defense" | "game";
  /** Difference from the league average, in points of the real rate (e.g. +4.1). */
  points: number;
  /** The same in spreads between teams (for the chart), within -2.5 to 2.5. */
  standard: number;
  /** In his current job this reaches the field. */
  active: boolean;
}

/** A coach's leanings against the league average, his job's side first. */
export function philosophy(coach: Coach): PhilosophyLine[] {
  const side = activeSide(coach.role);
  return TENDENCIES.map((t) => ({
    key: t.key,
    label: t.label,
    side: t.side,
    points: Math.round(coach.style[t.key] * 1000) / 10,
    standard: Math.max(-2.5, Math.min(2.5, coach.style[t.key] / STYLE_SPREAD[t.key])),
    active: t.side === side,
  })).sort((a, b) => Number(b.active) - Number(a.active));
}

/** A few words on how he coaches (his job's side; empty for a typical coach). */
export function styleSummary(coach: Coach): string {
  const side = activeSide(coach.role);
  if (!side) return "";
  const words = TENDENCIES.filter((t) => t.side === side)
    .map((t) => ({ t, z: coach.style[t.key] / STYLE_SPREAD[t.key] }))
    .filter((x) => Math.abs(x.z) >= NOTABLE)
    .sort((a, b) => Math.abs(b.z) - Math.abs(a.z))
    .slice(0, 3)
    .map((x) => (x.z > 0 ? x.t.more : x.t.less));
  return words.length ? words.join(", ") : "balanced";
}

/** What his job does for his team, in plain English (multipliers against a typical staff). */
export function jobEffects(coach: Coach): string[] {
  const pct = (m: number) => `${m >= 1 ? "+" : "−"}${Math.abs(Math.round((m - 1) * 100))}%`;
  const out: string[] = [];
  const r = coach.ratings;
  switch (coach.role) {
    case "HC":
      out.push(`Manages games: 4th-down, 2-point and clock calls, and in-game adjustments.`);
      out.push(
        `Pre-snap penalties ${pct(staffMultiplier(r.leadership, STAFF_EFFECTS.disciplinePenalties, true))} (discipline).`,
      );
      out.push(
        `Development for the whole roster ${pct(staffMultiplier(r.development, STAFF_EFFECTS.headCoachDevelopment, false, COACH_SKILL.mean))}.`,
      );
      break;
    case "OC":
    case "DC": {
      const skill = coach.role === "OC" ? r.offense : r.defense;
      const edge = Math.round(skillStep(skill) * 10) / 10;
      out.push(
        `Calls the ${coach.role === "OC" ? "offense" : "defense"} and sets its scheme; play-calling edge ${edge >= 0 ? "+" : ""}${edge} (−1 to +1).`,
      );
      break;
    }
    case "STR":
      out.push(
        `Injury risk ${pct(staffMultiplier(r.health, STAFF_EFFECTS.strengthInjuryRisk, true))}.`,
      );
      break;
    case "MED":
      out.push(
        `Recovery time ${pct(staffMultiplier(r.health, STAFF_EFFECTS.trainerRecovery, true))}.`,
      );
      break;
    case "SCOUT":
      out.push(`Scouting (used from Phase 11's draft).`);
      break;
    default: {
      const positions = Object.entries(POSITION_COACH)
        .filter(([, role]) => role === coach.role)
        .map(([pos]) => pos);
      out.push(
        `Development for ${positions.join(", ")} ${pct(staffMultiplier(r.development, STAFF_EFFECTS.positionCoachDevelopment))}.`,
      );
    }
  }
  return out;
}

/** The skill that matters most in his job, and its value. */
export function mainSkill(coach: Coach): { key: string; value: number } {
  const key = ROLE_FOCUS[coach.role];
  return { key, value: coach.ratings[key] };
}

/** A player's fit in his team's scheme, as the viewer's staff sees him (null when it doesn't apply). */
export function perceivedFit(
  league: League,
  p: Player,
  viewer: Viewer,
): { scheme: string; score: number; label: string } | null {
  if (p.teamId === null) return null;
  const scheme = teamScheme(league, p.teamId, p.position);
  if (!scheme) return null;
  const score = fitScore(perceivePlayer(league, p, viewer).ratings, p.position, scheme);
  return { scheme, score: Math.round(score * 100) / 100, label: fitLabel(score) };
}
