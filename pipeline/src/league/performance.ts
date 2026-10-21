/**
 * Adjusting ratings by how players actually played in 2025 (Phase 6b).
 *
 * The Madden ratings are from the start of the 2025 season. For each
 * position we score every regular's 2025 production against the others at
 * his position, turn that score into the overall it implies (the overall at
 * the same rank among those players), and move his overall part of the way
 * there: more for full-time players, less for part-timers. Linemen,
 * kickers, punters and snappers have no individual production we can trust,
 * so they keep their ratings.
 *
 * Production depends on teammates and scheme too, so the move is partial
 * (`PERFORMANCE.maxWeight`).
 */
import {
  ATTRIBUTES,
  overallAt,
  OVERALL_WEIGHTS,
  type AttributeKey,
  type Position,
  type Ratings,
} from "@fgm/sim-core";
import type { Row } from "../matchups";
import { num } from "../matchups";
import type { RealPerson } from "./roster";

export const PERFORMANCE = {
  /**
   * The share of the gap to the performance-implied overall closed for a
   * full-time player. One season of production is noisy (and shared with
   * teammates), and coverage numbers are the noisiest of all.
   */
  maxWeight: {
    QB: 0.4,
    RB: 0.35,
    WR: 0.4,
    TE: 0.35,
    EDGE: 0.35,
    DT: 0.3,
    LB: 0.25,
    CB: 0.25,
    S: 0.2,
  } as Partial<Record<Position, number>>,
  /** Snap share at which a player counts as full-time. */
  fullTimeShare: 0.75,
  /** Minimum volume to be scored at all. */
  minimum: { dropbacks: 150, carries: 80, targets: 35, defenseShare: 0.3, coverageTargets: 25 },
};

/** The per-position production score: a weighted sum of z-scores (higher is better). */
type Metric = { weight: number; value: (p: Production) => number | null };

interface Production {
  person: RealPerson;
  stats?: Row;
  def?: Row;
  ngsRush?: Row;
}

const per = (a: number, b: number) => (b > 0 ? a / b : null);
const n = (r: Row | undefined, k: string) => (r ? num(r[k]) || 0 : 0);

const QB: Metric[] = [
  {
    weight: 0.65,
    value: ({ stats: s }) =>
      per(
        n(s, "passing_epa") + n(s, "rushing_epa"),
        n(s, "attempts") + n(s, "sacks_suffered") + n(s, "carries"),
      ),
  },
  {
    weight: 0.35,
    value: ({ stats: s }) => (s && s.passing_cpoe !== "" ? n(s, "passing_cpoe") : null),
  },
];
const RB: Metric[] = [
  {
    weight: 0.5,
    value: ({ stats: s, ngsRush }) =>
      ngsRush
        ? n(ngsRush, "rush_yards_over_expected_per_att")
        : per(n(s, "rushing_epa"), n(s, "carries")),
  },
  { weight: 0.25, value: ({ stats: s }) => per(n(s, "rushing_epa"), n(s, "carries")) },
  {
    weight: 0.25,
    value: ({ stats: s }) =>
      per(n(s, "rushing_yards") + n(s, "receiving_yards"), n(s, "carries") + n(s, "targets")),
  },
];
const RECEIVER: Metric[] = [
  { weight: 0.4, value: ({ stats: s }) => per(n(s, "receiving_yards"), n(s, "targets")) },
  { weight: 0.3, value: ({ stats: s }) => per(n(s, "receiving_epa"), n(s, "targets")) },
  { weight: 0.3, value: ({ stats: s }) => n(s, "target_share") },
];
const missedTackleRate = (d?: Row) => {
  const missed = n(d, "m_tkl");
  return missed + n(d, "comb") > 0 ? -missed / (missed + n(d, "comb")) : null;
};
const RUSHER: Metric[] = [
  {
    weight: 0.7,
    value: ({ def, person }) => per(n(def, "prss"), person.snapShare.defense),
  },
  { weight: 0.3, value: ({ def }) => missedTackleRate(def) },
];
const LINEBACKER: Metric[] = [
  { weight: 0.4, value: ({ def, person }) => per(n(def, "comb"), person.snapShare.defense) },
  { weight: 0.3, value: ({ def }) => missedTackleRate(def) },
  { weight: 0.3, value: ({ def }) => (n(def, "tgt") >= 15 ? -n(def, "rat") : null) },
];
const COVERAGE: Metric[] = [
  { weight: 0.45, value: ({ def }) => (n(def, "tgt") > 0 ? -n(def, "yds") / n(def, "tgt") : null) },
  { weight: 0.35, value: ({ def }) => (n(def, "tgt") > 0 ? -n(def, "rat") : null) },
  {
    weight: 0.2,
    value: ({ def, stats: s }) => per(n(def, "int") + n(s, "def_pass_defended"), n(def, "tgt")),
  },
];

const METRICS: Partial<Record<Position, Metric[]>> = {
  QB,
  RB,
  WR: RECEIVER,
  TE: RECEIVER,
  EDGE: RUSHER,
  DT: RUSHER,
  LB: LINEBACKER,
  CB: COVERAGE,
  S: COVERAGE,
};

function qualifies(p: Production): boolean {
  const m = PERFORMANCE.minimum;
  const s = p.stats;
  switch (p.person.position) {
    case "QB":
      return n(s, "attempts") + n(s, "sacks_suffered") >= m.dropbacks;
    case "RB":
      return n(s, "carries") >= m.carries;
    case "WR":
    case "TE":
      return n(s, "targets") >= m.targets;
    case "CB":
    case "S":
      return n(p.def, "tgt") >= m.coverageTargets;
    case "EDGE":
    case "DT":
    case "LB":
      return p.person.snapShare.defense >= m.defenseShare && p.def !== undefined;
    default:
      return false;
  }
}

/** PFR rows: one per player, using the combined row ("2TM") for players traded mid-season. */
export function defenseByPfr(rows: Row[], season: number): Map<string, Row> {
  const out = new Map<string, Row>();
  for (const r of rows) {
    if (Number(r.season) !== season || !r.pfr_id) continue;
    const combined = /^\dTM$/.test(r.tm ?? "");
    if (!out.has(r.pfr_id) || combined) out.set(r.pfr_id, r);
  }
  return out;
}

export interface Adjustment {
  gsis: string;
  position: Position;
  before: number;
  implied: number;
  after: number;
}

/** Overall points to add to the attributes that count for a position, spread so the overall moves by `delta`. */
export function shiftOverall(ratings: Ratings, position: Position, delta: number): Ratings {
  const weights = OVERALL_WEIGHTS[position];
  const physical = new Set<string>(
    ATTRIBUTES.filter((a) => a.group === "physical").map((a) => a.key),
  );
  let total = 0;
  let skill = 0;
  for (const [key, w] of Object.entries(weights) as [AttributeKey, number][]) {
    total += w;
    if (!physical.has(key)) skill += w;
  }
  // Performance says nothing new about speed or strength: only skills move.
  const perSkill = skill > 0 ? (delta * total) / skill : 0;
  const out = { ...ratings };
  for (const [key, w] of Object.entries(weights) as [AttributeKey, number][])
    if (w > 0 && !physical.has(key))
      out[key] = Math.round(Math.min(99, Math.max(1, out[key] + perSkill)));
  return out;
}

/**
 * The performance-implied overall for each qualified player, and the
 * adjusted ratings (or target overall, for players without a rating source).
 */
export function adjustForPerformance(
  people: RealPerson[],
  ratings: Map<string, Ratings | { targetOverall: number }>,
  sources: { stats: Row[]; defense: Map<string, Row>; ngsRushing: Row[] },
): Adjustment[] {
  const stats = new Map(sources.stats.map((s) => [s.player_id ?? "", s]));
  const ngsRush = new Map(sources.ngsRushing.map((r) => [r.player_gsis_id ?? "", r]));
  const overallOf = (p: RealPerson) => {
    const r = ratings.get(p.gsis)!;
    return "targetOverall" in r ? r.targetOverall : overallAt(r, p.position);
  };
  const adjustments: Adjustment[] = [];

  for (const [position, metrics] of Object.entries(METRICS) as [Position, Metric[]][]) {
    const group: Production[] = people
      .filter((p) => p.position === position)
      .map((person) => ({
        person,
        stats: stats.get(person.gsis),
        def: sources.defense.get(person.pfr),
        ngsRush: ngsRush.get(person.gsis),
      }))
      .filter(qualifies);
    if (group.length < 8) continue;

    // Each metric as a z-score within the position; missing values count as average.
    const scores = new Map<string, number>(group.map((g) => [g.person.gsis, 0]));
    for (const metric of metrics) {
      const values = group
        .map((g) => metric.value(g))
        .filter((v): v is number => v !== null && Number.isFinite(v));
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const sd =
        Math.sqrt(values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / values.length) || 1;
      for (const g of group) {
        const v = metric.value(g);
        if (v !== null && Number.isFinite(v))
          scores.set(g.person.gsis, scores.get(g.person.gsis)! + (metric.weight * (v - mean)) / sd);
      }
    }

    // The implied overall: the overall at the same rank among these players.
    const byScore = [...group].sort(
      (a, b) => scores.get(b.person.gsis)! - scores.get(a.person.gsis)!,
    );
    const overalls = group.map((g) => overallOf(g.person)).sort((a, b) => b - a);
    byScore.forEach((g, rank) => {
      const p = g.person;
      const before = overallOf(p);
      const implied = overalls[rank]!;
      const share = Math.max(p.snapShare.offense, p.snapShare.defense);
      const weight =
        (PERFORMANCE.maxWeight[position] ?? 0) * Math.min(1, share / PERFORMANCE.fullTimeShare);
      const delta = weight * (implied - before);
      const r = ratings.get(p.gsis)!;
      if ("targetOverall" in r)
        ratings.set(p.gsis, { targetOverall: Math.round(r.targetOverall + delta) });
      else ratings.set(p.gsis, shiftOverall(r, position, delta));
      adjustments.push({ gsis: p.gsis, position, before, implied, after: overallOf(p) });
    });
  }
  return adjustments;
}

/**
 * Team results (Phase 6b). Real teams come out far more evenly matched on
 * Madden's start-of-season numbers than real 2025 results say, so each
 * team's regulars move with how the team actually did: points per game
 * scored minus allowed, as a z-score across the league. The size is set so
 * team strength spreads about as much as in our generated leagues.
 */
export const TEAM_RESULTS = {
  /** Overall points per standard deviation of 2025 point differential per game. */
  overallPerSd: 2,
  /** Who counts as a regular for his 2025 team (snap share on his side of the ball). */
  minShare: 0.25,
};

export function adjustForTeamResults(
  people: RealPerson[],
  ratings: Map<string, Ratings | { targetOverall: number }>,
  differentialPerGame: Map<string, number>,
): Map<string, number> {
  const values = [...differentialPerGame.values()];
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd =
    Math.sqrt(values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / values.length) || 1;
  const shift = new Map<string, number>();
  for (const [team, v] of differentialPerGame)
    shift.set(team, (TEAM_RESULTS.overallPerSd * (v - mean)) / sd);
  for (const p of people) {
    // Kickers, punters and snappers don't make a team good or bad.
    if (p.teamId === null || p.position === "K" || p.position === "P" || p.position === "LS")
      continue;
    const share = Math.max(p.snapShare.offense, p.snapShare.defense);
    if (share < TEAM_RESULTS.minShare) continue;
    const delta = shift.get(p.teamId) ?? 0;
    const r = ratings.get(p.gsis)!;
    if ("targetOverall" in r)
      ratings.set(p.gsis, { targetOverall: Math.round(r.targetOverall + delta) });
    else ratings.set(p.gsis, shiftOverall(r, p.position, delta));
  }
  return shift;
}
