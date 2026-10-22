/**
 * Scouting screens (Phase 11): the draft class list, a prospect's page, a
 * team's scouting department, and the league office's scouting moves. Every
 * number is what the viewer's scouts believe (perception.ts); drills show only
 * once measured.
 */
import {
  ageOn,
  ATTRIBUTES,
  dmath,
  OVERALL_WEIGHTS,
  POSITION_INFO,
  type AttributeGroup,
  type Position,
} from "@fgm/foundation";
import draftData from "../../../../calibration/draft.json";
import type { League, Measurables, Prospect, Team } from "../league/schema";
import { perceiveProspect, type PerceivedPlayer, type Viewer } from "../perception";
import { seasonDates } from "../season/calendar";
import { SCOUTING_BUDGETS } from "../league/schema";
import { draftClass, proDayDate, upcomingDraftYear } from "./classes";
import { REGIONS, SCOUT_GROUPS } from "./config";
import { DRILLS, estimatedForty } from "./measurables";
import { draftValue } from "./value";

export interface ProspectRow {
  id: number;
  name: string;
  position: Position;
  college: string;
  region: string;
  age: number;
  heightIn: number;
  weightLb: number;
  overall: number;
  range: [number, number];
  potential: { estimate: number; range: [number, number] };
  confidence: number;
  /** Where the league office's consensus ranks him, and where the viewer's scouts do. */
  consensusRank: number;
  viewerRank: number;
  /** His 40 time once measured. */
  forty: number | null;
  invited: boolean;
  tested: boolean;
}

export interface DraftClassView {
  draftYear: number;
  combineDate: string;
  draftDate: string;
  /** Whose read this is. */
  viewer: string;
  /** Who ranked the list, in words ("the Buffalo Blizzard's scouts"). */
  rankedBy: string;
  rows: ProspectRow[];
}

function name(p: { firstName: string; lastName: string }): string {
  return `${p.firstName} ${p.lastName}`;
}

function viewerName(league: League, viewer: Viewer): string {
  if (viewer.kind === "league") return "the league office";
  const t = league.teams.find((x) => x.id === viewer.teamId);
  return t ? `the ${t.city} ${t.nickname}` : viewer.teamId;
}

/** Rank of each prospect by draft value as one viewer sees him (1 = best). */
function ranks(league: League, prospects: Prospect[], viewer: Viewer): Map<number, number> {
  const valued = prospects
    .map((p) => ({ id: p.id, v: draftValue(perceiveProspect(league, p, viewer), p.position) }))
    .sort((a, b) => b.v - a.v || a.id - b.id);
  return new Map(valued.map((x, i) => [x.id, i + 1]));
}

/** The upcoming draft class, as the viewer's scouts rank it. */
export function draftClassView(league: League, viewer: Viewer): DraftClassView {
  const draftYear = upcomingDraftYear(league);
  const dates = seasonDates(league.rules, draftYear);
  const prospects = draftClass(league, draftYear);
  const office: Viewer = { kind: "league" };
  const consensus = ranks(league, prospects, office);
  const mine = viewer.kind === "league" ? consensus : ranks(league, prospects, viewer);
  const rows = prospects.map((p): ProspectRow => {
    const seen = perceiveProspect(league, p, viewer);
    return {
      id: p.id,
      name: name(p),
      position: p.position,
      college: p.college,
      region: p.region,
      age: ageOn(p.birthDate, dates.draft),
      heightIn: p.heightIn,
      weightLb: p.weightLb,
      overall: seen.overall,
      range: seen.range,
      potential: seen.potential,
      confidence: seen.confidence,
      consensusRank: consensus.get(p.id)!,
      viewerRank: mine.get(p.id)!,
      forty: p.tested ? p.measurables.forty : null,
      invited: p.invited,
      tested: p.tested,
    };
  });
  rows.sort((a, b) => a.viewerRank - b.viewerRank);
  return {
    draftYear,
    combineDate: dates.combine,
    draftDate: dates.draft,
    viewer: viewerName(league, viewer),
    rankedBy:
      viewer.kind === "league"
        ? "the league office's consensus (an average scouting department)"
        : `${viewerName(league, viewer)}'s scouts`,
    rows,
  };
}

export interface ProspectView {
  id: number;
  name: string;
  position: Position;
  positionName: string;
  college: string;
  region: string;
  age: number;
  birthDate: string;
  heightIn: number;
  weightLb: number;
  draftYear: number;
  viewer: string;
  overall: number;
  range: [number, number];
  potential: { estimate: number; range: [number, number] };
  confidence: number;
  consensusRank: number;
  viewerRank: number;
  classSize: number;
  /** The scouting report, sentence by sentence. */
  report: string[];
  /** Where he's measured: the combine, his pro day (with its date), or not yet. */
  testing: { invited: boolean; tested: boolean; proDay: string | null; combine: string };
  /** Drill results once measured (null: skipped), with how they compare at his position. */
  drills: {
    key: string;
    label: string;
    value: number | null;
    unit: string;
    /** Percentile among real combine prospects at his position (higher = better). */
    percentile: number | null;
  }[];
  /** An estimate of his 40 before he runs it, from what scouts see on tape. */
  estimatedForty: number;
  attributeGroups: {
    group: AttributeGroup;
    attributes: { key: string; label: string; value: number; plusMinus: number; counts: boolean }[];
  }[];
  /** The viewer team's study on him (points), if a team. */
  study: number | null;
}

const DRILL_LABELS: Record<(typeof DRILLS)[number], [string, string]> = {
  forty: ["40-yard dash", "s"],
  bench: ["Bench press (225 lb)", "reps"],
  vertical: ["Vertical jump", "in"],
  broadJump: ["Broad jump", "in"],
  cone: ["3-cone drill", "s"],
  shuttle: ["20-yard shuttle", "s"],
};
const LOWER_IS_BETTER = new Set(["forty", "cone", "shuttle"]);
const DATA_KEY: Record<string, string> = { broadJump: "broad_jump" };

/** Normal CDF (Abramowitz-Stegun 26.2.17), with the exact-arithmetic exp. */
function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const density = 0.3989423 * dmath.exp((-z * z) / 2);
  const tail =
    density * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z >= 0 ? 1 - tail : tail;
}

function percentile(position: Position, drill: string, value: number | null): number | null {
  if (value === null) return null;
  const rows = draftData.combine.measurables as unknown as Record<
    string,
    Record<string, { mean: number; spread: number }>
  >;
  const real = (rows[position] ?? rows["C"])?.[DATA_KEY[drill] ?? drill];
  if (!real || real.spread <= 0) return null;
  const z = ((value - real.mean) / real.spread) * (LOWER_IS_BETTER.has(drill) ? -1 : 1);
  return Math.round(normalCdf(z) * 100);
}

const ROUND_WORDS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh"];

function projection(rank: number, teams: number, rounds: number): string {
  const round = Math.ceil(rank / teams);
  if (round <= rounds) return `projects as a ${ROUND_WORDS[round - 1]}-round pick`;
  return "projects to go undrafted (a camp invitation)";
}

function ceilingWords(potential: number): string {
  if (potential >= 88) return "a star";
  if (potential >= 80) return "a quality starter";
  if (potential >= 74) return "a starter";
  if (potential >= 66) return "a backup";
  return "a camp body";
}

function sureWords(confidence: number): string {
  if (confidence >= 0.75) return "confident";
  if (confidence >= 0.55) return "fairly sure";
  return "unsure";
}

/** The scouting report in words, from the viewer's read. */
function report(
  league: League,
  p: Prospect,
  seen: PerceivedPlayer,
  viewerRank: number,
  viewer: string,
): string[] {
  const weights = OVERALL_WEIGHTS[p.position];
  const counted = ATTRIBUTES.filter((a) => (weights[a.key] ?? 0) > 0).map((a) => ({
    label: a.label.toLowerCase(),
    value: seen.ratings[a.key],
    weight: weights[a.key] ?? 0,
  }));
  const byValue = [...counted].sort((a, b) => b.value - a.value || b.weight - a.weight);
  const best = byValue.slice(0, 3).map((x) => x.label);
  const worst = byValue
    .slice(-2)
    .reverse()
    .map((x) => x.label);
  const lines = [
    `${POSITION_INFO[p.position].name} from ${p.college} (${p.region}); ${projection(viewerRank, league.teams.length, league.rules.draft.rounds)} on ${viewer}'s board.`,
    `Best traits: ${best.join(", ")}. Needs work: ${worst.join(" and ")}.`,
    `Could become ${ceilingWords(seen.potential.estimate)} (potential likely ${seen.potential.range[0]}–${seen.potential.range[1]}).`,
    `The scouts are ${sureWords(seen.confidence)} of their read: likely ${seen.range[0]}–${seen.range[1]} today.`,
  ];
  if (p.tested && p.measurables.forty !== null) {
    const pct = percentile(p.position, "forty", p.measurables.forty)!;
    const speed = pct >= 80 ? "fast" : pct >= 40 ? "an average" : "a slow";
    lines.push(
      `Ran ${speed === "fast" ? "a fast" : speed} 40 for his position (${p.measurables.forty.toFixed(2)} s, better than ${pct}% of real prospects).`,
    );
  } else if (!p.tested)
    lines.push("Not yet measured: his drills come at the combine or his pro day.");
  return lines;
}

export function prospectView(league: League, id: number, viewer: Viewer): ProspectView {
  const p = league.prospects.find((x) => x.id === id);
  if (!p) throw new Error(`no prospect ${id}`);
  const seen = perceiveProspect(league, p, viewer);
  const prospects = draftClass(league, p.draftYear);
  const consensus = ranks(league, prospects, { kind: "league" });
  const mine = viewer.kind === "league" ? consensus : ranks(league, prospects, viewer);
  const dates = seasonDates(league.rules, p.draftYear);
  const who = viewerName(league, viewer);
  const groups: AttributeGroup[] = ["physical", "technical", "mental"];
  const weights = OVERALL_WEIGHTS[p.position];
  return {
    id: p.id,
    name: name(p),
    position: p.position,
    positionName: POSITION_INFO[p.position].name,
    college: p.college,
    region: p.region,
    age: ageOn(p.birthDate, league.date),
    birthDate: p.birthDate,
    heightIn: p.heightIn,
    weightLb: p.weightLb,
    draftYear: p.draftYear,
    viewer: who,
    overall: seen.overall,
    range: seen.range,
    potential: seen.potential,
    confidence: seen.confidence,
    consensusRank: consensus.get(p.id)!,
    viewerRank: mine.get(p.id)!,
    classSize: prospects.length,
    report: report(league, p, seen, mine.get(p.id)!, who),
    testing: {
      invited: p.invited,
      tested: p.tested,
      proDay: p.invited ? null : proDayDate(league, p),
      combine: dates.combine,
    },
    drills: DRILLS.map((d) => {
      const value = p.tested ? (p.measurables as Measurables)[d] : null;
      return {
        key: d,
        label: DRILL_LABELS[d][0],
        unit: DRILL_LABELS[d][1],
        value,
        percentile: percentile(p.position, d, value),
      };
    }),
    estimatedForty: estimatedForty(seen.ratings, p.position),
    attributeGroups: groups.map((group) => ({
      group,
      attributes: ATTRIBUTES.filter((a) => a.group === group).map((a) => ({
        key: a.key,
        label: a.label,
        value: seen.ratings[a.key],
        plusMinus: group === "physical" ? seen.plusMinus.physical : seen.plusMinus.skills,
        counts: (weights[a.key] ?? 0) > 0,
      })),
    })),
    study:
      viewer.kind === "team"
        ? (league.teams.find((t) => t.id === viewer.teamId)?.scouting.points[String(p.id)] ?? 0)
        : null,
  };
}

export interface ScoutingDepartmentView {
  teamId: string;
  team: string;
  budget: Team["scouting"]["budget"];
  budgets: readonly string[];
  regions: readonly string[];
  groups: string[];
  scouts: {
    id: number;
    name: string;
    specialty: string | null;
    region: string | null;
    group: string | null;
  }[];
}

/** A team's scouting department: budget, scouts and their assignments. */
export function scoutingDepartmentView(league: League, teamId: string): ScoutingDepartmentView {
  const team = league.teams.find((t) => t.id === teamId);
  if (!team) throw new Error(`no team ${teamId}`);
  return {
    teamId,
    team: `${team.city} ${team.nickname}`,
    budget: team.scouting.budget,
    budgets: SCOUTING_BUDGETS,
    regions: REGIONS,
    groups: Object.keys(SCOUT_GROUPS),
    scouts: league.coaches
      .filter((c) => c.teamId === teamId && c.role === "SCOUT")
      .sort((a, b) => a.id - b.id)
      .map((c) => {
        const a = team.scouting.assignments.find((x) => x.scoutId === c.id);
        return {
          id: c.id,
          name: name(c),
          specialty: c.specialty,
          region: a?.region ?? null,
          group: a?.group ?? null,
        };
      }),
  };
}

export type ScoutingMove =
  | { kind: "budget"; teamId: string; budget: Team["scouting"]["budget"] }
  | {
      kind: "assign";
      teamId: string;
      scoutId: number;
      region: string | null;
      group: string | null;
    };

/** A league-office scouting move (until GM Mode: any team's). Returns what happened. */
export function makeScoutingMove(league: League, move: ScoutingMove): string {
  const team = league.teams.find((t) => t.id === move.teamId);
  if (!team) throw new Error(`no team ${move.teamId}`);
  if (move.kind === "budget") {
    if (!SCOUTING_BUDGETS.includes(move.budget)) throw new Error(`no budget "${move.budget}"`);
    team.scouting.budget = move.budget;
    return `${team.city} ${team.nickname}: scouting budget set to ${move.budget}.`;
  }
  const scout = league.coaches.find(
    (c) => c.id === move.scoutId && c.teamId === team.id && c.role === "SCOUT",
  );
  if (!scout) throw new Error("That scout isn't on this team.");
  if (move.region !== null && !(REGIONS as readonly string[]).includes(move.region))
    throw new Error(`no region "${move.region}"`);
  if (move.group !== null && !(move.group in SCOUT_GROUPS))
    throw new Error(`no position group "${move.group}"`);
  team.scouting.assignments = [
    ...team.scouting.assignments.filter((a) => a.scoutId !== scout.id),
    { scoutId: scout.id, region: move.region, group: move.group },
  ].sort((a, b) => a.scoutId - b.scoutId);
  return `${name(scout)} now scouts ${move.group ?? "every position"} in ${move.region ?? "every region"}.`;
}

/** Who the screens can view as: the league office or any team. */
export function viewingOptions(league: League): {
  current: string | null;
  teams: { id: string; name: string }[];
} {
  return {
    current: league.settings.viewingAs,
    teams: [...league.teams]
      .sort((a, b) => a.city.localeCompare(b.city) || a.nickname.localeCompare(b.nickname))
      .map((t) => ({ id: t.id, name: `${t.city} ${t.nickname}` })),
  };
}

/** Sets whose eyes the screens see through (null: the league office). */
export function setViewingAs(league: League, teamId: string | null): void {
  if (teamId !== null && !league.teams.some((t) => t.id === teamId))
    throw new Error(`no team ${teamId}`);
  league.settings.viewingAs = teamId;
}
