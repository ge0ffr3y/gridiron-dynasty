/**
 * Measures simulated games the same way the pipeline measured real NFL
 * seasons, and compares them to the real ranges (the scorecard).
 */
import type { Position } from "@fgm/foundation";
import { CALIBRATION_TARGETS, PEOPLE } from "./config";
import { GROUP_OF } from "./sideline";
import type { GameOutput, Play, StatKey } from "./types";

export interface MeasuredGame {
  homeId: string;
  awayId: string;
  output: GameOutput;
}

/** Real league-wide EPA per play and success rate, as scorecard targets (mean and range over the seasons). */
const ADVANCED_TARGETS = Object.fromEntries(
  (["epaPerPlay", "successRate"] as const).map((key) => {
    const seasons = PEOPLE.advanced[key];
    const real = seasons.reduce((a, b) => a + b, 0) / seasons.length;
    return [key, { real, range: [Math.min(...seasons), Math.max(...seasons)] }];
  }),
);

const DESIGNED = new Set(["run"]);

export function measureSeason(games: MeasuredGame[]): Record<string, number> {
  const c: Record<string, number> = {};
  const add = (key: string, n = 1) => (c[key] = (c[key] ?? 0) + n);
  const teamPoints = new Map<string, number[]>();
  let homeWins = 0;
  let ties = 0;
  for (const g of games) {
    const o = g.output;
    add("points", o.homeScore + o.awayScore);
    if (o.homeScore > o.awayScore) homeWins++;
    if (o.homeScore === o.awayScore) ties++;
    teamPoints.set(g.homeId, [...(teamPoints.get(g.homeId) ?? []), o.homeScore]);
    teamPoints.set(g.awayId, [...(teamPoints.get(g.awayId) ?? []), o.awayScore]);
    add("drives", o.box.home.drives + o.box.away.drives);
    for (const p of o.plays) measurePlay(p, add);
  }
  let injuries = 0;
  let epa = 0;
  let epaPlays = 0;
  let successes = 0;
  for (const g of games) {
    injuries += g.output.injuries.length;
    for (const side of ["home", "away"] as const) {
      epa += g.output.box[side].epa;
      epaPlays += g.output.box[side].epaPlays;
      successes += g.output.box[side].successPlays;
    }
  }
  const teamGames = games.length * 2;
  const ppg = [...teamPoints.values()].map((v) => v.reduce((a, b) => a + b, 0) / v.length);
  const ppgMean = ppg.reduce((a, b) => a + b, 0) / ppg.length;
  const spread = Math.sqrt(ppg.reduce((a, v) => a + (v - ppgMean) * (v - ppgMean), 0) / ppg.length);
  const v = (key: string) => c[key] ?? 0;
  const values: Record<string, number> = {
    pointsPerTeamGame: v("points") / teamGames,
    offensivePlaysPerTeamGame: v("offPlays") / teamGames,
    yardsPerPlay: v("offYards") / v("offPlays"),
    passRate: v("dropbacks") / (v("dropbacks") + v("designedRuns")),
    completionPct: v("completions") / v("attempts"),
    yardsPerAttempt: v("passYards") / v("attempts"),
    sackRate: v("sacks") / (v("attempts") + v("sacks")),
    interceptionRate: v("ints") / v("attempts"),
    fumblesLostPerTeamGame: v("fumblesLost") / teamGames,
    turnoversPerTeamGame: (v("fumblesLost") + v("ints")) / teamGames,
    yardsPerCarry: v("rushYards") / v("rushes"),
    puntsPerTeamGame: v("punts") / teamGames,
    fieldGoalPct: v("fgm") / v("fga"),
    extraPointPct: v("xpm") / v("xpa"),
    thirdDownPct: v("thirdConv") / v("thirdAtt"),
    drivesPerTeamGame: v("drives") / teamGames,
    pointsPerDrive: v("points") / v("drives"),
    fourthDownGoRate: v("fourthGo") / v("fourthDowns"),
    twoPointTriesPerTeamGame: v("twoPointTries") / teamGames,
    homeWinPct: homeWins / games.length,
    tiesPerSeason: (ties * 272) / games.length,
    teamPointsPerGameSpread: spread,
    penaltiesPerTeamGame: v("penalties") / teamGames,
    penaltyYardsPerTeamGame: v("penaltyYards") / teamGames,
    pressureRate: v("pressures") / v("chartedDropbacks"),
    blitzRate: v("blitzes") / v("chartedDropbacks"),
    personnel11Share: v("personnel11") / v("personnelPlays"),
    shotgunShare: v("shotgun") / v("personnelPlays"),
    manCoverageShare: v("manCoverage") / v("coverageKnown"),
    injuriesPerTeamGame: injuries / teamGames,
    epaPerPlay: epa / epaPlays,
    successRate: successes / epaPlays,
  };
  for (const band of ["18-29", "30-39", "40-49", "50-59"])
    values[`fieldGoalPct ${band}`] = v(`fgm:${band}`) / v(`fga:${band}`);
  return values;
}

const MAN = new Set(["cover0", "cover1", "2man"]);

function measurePlay(p: Play, add: (key: string, n?: number) => void): void {
  if (p.penalty?.accepted) {
    add("penalties");
    add("penaltyYards", p.penalty.yards);
  }
  // Plays wiped out by penalties don't count (the real data skips them too).
  if (p.noPlay) {
    // ...except that a third down converted by a defensive penalty counts as converted (as in the real data).
    if (p.down === 3 && p.firstDown) {
      add("thirdAtt");
      add("thirdConv");
    }
    return;
  }
  const dropback = p.kind === "pass" || p.kind === "sack" || p.kind === "scramble";
  if (dropback && p.rushers !== undefined) {
    add("chartedDropbacks");
    if (p.pressure !== undefined) add("pressures");
    if (p.rushers >= 5) add("blitzes");
    if (p.coverage && p.coverage !== "other") {
      add("coverageKnown");
      if (MAN.has(p.coverage)) add("manCoverage");
    }
  }
  if ((p.kind === "run" || dropback) && p.personnel) {
    add("personnelPlays");
    if (p.personnel === "11") add("personnel11");
    if (p.formation === "SHOTGUN") add("shotgun");
  }
  const scrimmage =
    p.kind === "run" ||
    p.kind === "pass" ||
    p.kind === "sack" ||
    p.kind === "scramble" ||
    p.kind === "kneel" ||
    p.kind === "spike";
  if (scrimmage) {
    add("offPlays");
    add("offYards", p.yards);
  }
  if (p.kind === "pass" || p.kind === "sack" || p.kind === "scramble") add("dropbacks");
  if (DESIGNED.has(p.kind)) add("designedRuns");
  if (p.kind === "pass") {
    add("attempts");
    if (p.complete) {
      add("completions");
      add("passYards", p.yards);
    }
    if (p.intercepted) add("ints");
  }
  if (p.kind === "sack") add("sacks");
  if (p.kind === "run" || p.kind === "scramble" || p.kind === "kneel") {
    add("rushes");
    add("rushYards", p.yards);
  }
  if (p.fumble?.lost) add("fumblesLost");
  if (p.kind === "punt") add("punts");
  if (p.kind === "fieldGoal") {
    const d = p.kickDistance ?? 0;
    const band = d < 30 ? "18-29" : d < 40 ? "30-39" : d < 50 ? "40-49" : d < 60 ? "50-59" : "60+";
    add("fga");
    add(`fga:${band}`);
    if (p.good) {
      add("fgm");
      add(`fgm:${band}`);
    }
  }
  if (p.kind === "extraPoint") {
    add("xpa");
    if (p.good) add("xpm");
  }
  if (p.kind === "twoPoint") add("twoPointTries");
  const play = p.kind === "run" || p.kind === "pass" || p.kind === "sack" || p.kind === "scramble";
  if (p.down === 3 && play) {
    add("thirdAtt");
    if (p.firstDown) add("thirdConv");
  }
  if (p.down === 4 && (play || p.kind === "punt" || p.kind === "fieldGoal")) {
    add("fourthDowns");
    if (play) add("fourthGo");
  }
}

export interface ScorecardLine {
  key: string;
  sim: number;
  real: number;
  range: [number, number];
  pass: boolean;
  /** Not simulated yet (e.g. injuries before Phase 4b). */
  pending?: boolean;
}

export function scorecard(values: Record<string, number>): ScorecardLine[] {
  return Object.entries({ ...CALIBRATION_TARGETS, ...ADVANCED_TARGETS }).map(([key, t]) => {
    const sim = values[key] ?? NaN;
    const range = t.range as [number, number];
    if (values[key] === undefined)
      return { key, sim, real: t.real, range, pass: true, pending: true };
    return { key, sim, real: t.real, range, pass: sim >= range[0] && sim <= range[1] };
  });
}

/** The core stats the CI test holds to the real ranges. */
export const CORE_STATS = [
  "pointsPerTeamGame",
  "yardsPerPlay",
  "completionPct",
  "sackRate",
  "turnoversPerTeamGame",
  "offensivePlaysPerTeamGame",
];

// --- Player level (Phase 4b) --------------------------------------------------

/** Leaderboard categories and ranks the player scorecard checks. */
const BOARD_KEYS = ["passYds", "passTd", "rushYds", "recYds", "rec", "sacks", "defInt"] as const;
const BOARD_RANKS = [1, 5, 10, 20];
/** Snap shares are checked within this many points of the real share (the real data has no season ranges). */
const SNAP_TOLERANCE = 0.06;
/**
 * Depth ranks whose snap share is compared, per position group. Front-seven
 * depth beyond the starters isn't compared: real rosters list 3-4 outside
 * linebackers (who rush the passer) as linebackers, while the sim always
 * plays a four-man line, so EDGE3, DT2 and linebacker shares don't line up.
 */
const SNAP_RANKS: Record<string, number> = { RB: 2, WR: 4, TE: 2, EDGE: 2, DT: 1, CB: 3, S: 2 };
const RATING_QUALIFIER = 14 * 17;

function passerRating(att: number, cmp: number, yds: number, td: number, int: number): number {
  const clamp = (v: number) => Math.max(0, Math.min(2.375, v));
  const a = clamp((cmp / att - 0.3) * 5);
  const b = clamp((yds / att - 3) * 0.25);
  const c = clamp((td / att) * 20);
  const d = clamp(2.375 - (int / att) * 25);
  return ((a + b + c + d) / 6) * 100;
}

/**
 * One regular season's player-level numbers: leaderboard values at fixed
 * ranks, the spread of passer ratings, and how snaps split down the depth
 * chart. `positionOf` gives each player's position (for snap shares).
 */
export function measurePlayers(
  games: MeasuredGame[],
  positionOf: (id: number) => Position | undefined,
): Record<string, number> {
  const totals = new Map<number, Partial<Record<StatKey, number>>>();
  const shareSum = new Map<string, number>();
  let teamGames = 0;
  for (const g of games) {
    for (const entry of g.output.box.players) {
      const t = totals.get(entry.id) ?? {};
      for (const [k, v] of Object.entries(entry.line) as [StatKey, number][])
        t[k] = (t[k] ?? 0) + v;
      totals.set(entry.id, t);
    }
    // Snap shares: each team-game's players at a position, most snaps first.
    for (const side of ["home", "away"] as const) {
      const snaps = { off: 0, def: 0 };
      for (const p of g.output.plays) {
        if (p.kind !== "run" && p.kind !== "pass" && p.kind !== "sack" && p.kind !== "scramble")
          continue;
        if (p.offense === side) snaps.off += 1;
        else snaps.def += 1;
      }
      if (snaps.off === 0 || snaps.def === 0) continue;
      teamGames += 1;
      const byGroup = new Map<string, number[]>();
      for (const entry of g.output.box.players) {
        if (entry.side !== side) continue;
        const position = positionOf(entry.id);
        const group = position ? GROUP_OF[position] : undefined;
        if (!group || !(group in SNAP_RANKS)) continue;
        const defense = ["EDGE", "DT", "LB", "CB", "S"].includes(group);
        const n = defense ? (entry.line.defSnaps ?? 0) : (entry.line.offSnaps ?? 0);
        if (n === 0) continue;
        const list = byGroup.get(group) ?? [];
        list.push(n / (defense ? snaps.def : snaps.off));
        byGroup.set(group, list);
      }
      for (const [group, list] of byGroup) {
        list.sort((a, b) => b - a);
        list.slice(0, SNAP_RANKS[group]).forEach((share, rank) => {
          const key = `${group}${rank + 1}`;
          shareSum.set(key, (shareSum.get(key) ?? 0) + share);
        });
      }
    }
  }
  const values: Record<string, number> = {};
  const lines = [...totals.values()];
  for (const key of BOARD_KEYS) {
    const sorted = lines.map((l) => l[key] ?? 0).sort((a, b) => b - a);
    for (const rank of BOARD_RANKS) values[`${key} #${rank}`] = sorted[rank - 1] ?? 0;
  }
  const ratings = lines
    .filter((l) => (l.passAtt ?? 0) >= RATING_QUALIFIER)
    .map((l) =>
      passerRating(l.passAtt!, l.passCmp ?? 0, l.passYds ?? 0, l.passTd ?? 0, l.passInt ?? 0),
    )
    .sort((a, b) => b - a);
  values["passer rating: qualifiers"] = ratings.length;
  values["passer rating: best"] = ratings[0] ?? 0;
  values["passer rating: median"] = ratings[Math.floor(ratings.length / 2)] ?? 0;
  values["passer rating: worst"] = ratings[ratings.length - 1] ?? 0;
  for (const [group, depth] of Object.entries(SNAP_RANKS))
    for (let r = 1; r <= depth; r++)
      values[`snap share ${group}${r}`] =
        (shareSum.get(`${group}${r}`) ?? 0) / Math.max(1, teamGames);
  return values;
}

/** Real targets for the player-level lines. */
function playerTargets(): Record<string, { real: number; range: [number, number] }> {
  const t: Record<string, { real: number; range: [number, number] }> = {};
  const boards = PEOPLE.leaderboards as unknown as Record<
    string,
    Record<string, { real: number; range: [number, number] }>
  >;
  for (const key of BOARD_KEYS)
    for (const rank of BOARD_RANKS) {
      const b = boards[key]![String(rank)]!;
      t[`${key} #${rank}`] = { real: b.real, range: b.range };
    }
  const pr = PEOPLE.leaderboards.passerRating;
  t["passer rating: qualifiers"] = {
    real: pr.qualifiers.real,
    range: pr.qualifiers.range as [number, number],
  };
  t["passer rating: best"] = { real: pr.best.real, range: pr.best.range as [number, number] };
  t["passer rating: median"] = { real: pr.median.real, range: pr.median.range as [number, number] };
  t["passer rating: worst"] = { real: pr.worst.real, range: pr.worst.range as [number, number] };
  const shares = PEOPLE.snapShares as unknown as Record<string, number[]>;
  for (const [group, depth] of Object.entries(SNAP_RANKS))
    for (let r = 1; r <= depth; r++) {
      const real = shares[group]![r - 1]!;
      t[`snap share ${group}${r}`] = {
        real,
        range: [real - SNAP_TOLERANCE, real + SNAP_TOLERANCE],
      };
    }
  return t;
}

export function playerScorecard(values: Record<string, number>): ScorecardLine[] {
  return Object.entries(playerTargets()).map(([key, t]) => {
    const sim = values[key] ?? NaN;
    return { key, sim, real: t.real, range: t.range, pass: sim >= t.range[0] && sim <= t.range[1] };
  });
}
