/**
 * Scouting (Phase 11; CLAUDE.md rule 4). How uncertain a team's read of a
 * player is, in overall points (one standard deviation), and what shrinks it.
 * Judgment-sized, then tuned so drafts hit at real rates by round
 * (calibration/draft.json); `npm run sim -- --draft` measures it.
 */
import type { Position } from "@fgm/foundation";

export const SCOUTING = {
  /** A college prospect nobody has studied: skills, physical traits, and potential. */
  prospect: { skills: 7, physical: 5, potential: 9 },
  /** Physical traits once measured at the combine or a pro day. */
  measured: 0.6,
  /** NFL tape: the read sharpens with snaps (this many snaps halve the uncertainty's square). */
  snapsToHalve: 400,
  /** ...and with seasons in the league, even as a backup (counted as this many snaps each). */
  snapsPerSeason: 150,
  /** A team sees its own players more clearly (it coaches them every day). */
  ownTeam: 0.5,
  /** Prospects: study points that halve the uncertainty's square. */
  pointsToHalve: 40,
  /** A scouting department one skill step (see SKILL_POINTS_PER_STEP) better is this much clearer. */
  skillEffect: 0.2,
  /** Budget: how much clearer (or blurrier) a low, normal or high budget makes everything. */
  budget: { low: 1.15, normal: 1, high: 0.88 } as Record<"low" | "normal" | "high", number>,
  /** Each scout's weekly study points: on prospects in his region and position group, in one, and anyone. */
  weeklyPoints: { both: 3, one: 1.5, general: 0.4 },
  /** A scout whose specialty covers the prospect's position learns this much more each week. */
  specialtyBoost: 1.5,
  /** When scouts start on a class: the September before its draft (month-day). */
  studyStarts: "09-01",
  /** The combine and pro days: every team's study points on each tested prospect. */
  testingPoints: { combine: 8, proDay: 4 },
  /**
   * How a read's error splits. Most of it is shared by the whole league (everyone sees the same
   * tape and hears the same buzz); the rest is each team's own. A prospect's shared read starts
   * at what his rank's prospects usually are (`weight`: the share of his hidden difference the
   * league misses), and moves toward the truth as he's studied.
   */
  consensus: { weight: 1.6, teamShare: 0.5, sharedShare: 0.6 },
  /** Of a skill's error: the part common to the whole player, and each skill's own. */
  wholeShare: 0.8,
  ownShare: 0.6,
  /** A confidence range covers about this many standard deviations each way (~80%). */
  rangeWidth: 1.3,
};

/** Fictional colleges' regions (scouts are assigned by region). */
export const REGIONS = ["West", "Southwest", "Midwest", "Southeast", "Northeast"] as const;

/** Position groups scouts specialize in (as coaches' `specialty`). */
export const SCOUT_GROUPS: Record<string, Position[]> = {
  QB: ["QB"],
  "RB/WR/TE": ["RB", "FB", "WR", "TE"],
  OL: ["OT", "OG", "C"],
  "DL/EDGE": ["EDGE", "DT"],
  LB: ["LB"],
  DB: ["CB", "S"],
  All: [],
};

/** A team's scouting department before anyone is assigned. */
export function emptyScouting(): {
  budget: "normal";
  assignments: never[];
  points: Record<string, number>;
} {
  return { budget: "normal", assignments: [], points: {} };
}
